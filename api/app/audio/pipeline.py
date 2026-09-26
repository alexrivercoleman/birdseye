"""Audio chunk pipeline (§7.2). process_chunk runs as a BackgroundTask per uploaded chunk.

1. original → Storage audio-chunks/{walk_id}/{chunk_index}.{ext} (done last, off the latency path)
2. ffmpeg → mono 48 kHz WAV at {AUDIO_TMP_DIR}/{walk_id}/{chunk_index}.wav (kept until finish, for clips)
3. BirdNET without location filter; 4. location/season list for the walk's start point (cached per walk)
5–6. map to eBird taxonomy + thresholds (app.audio.filtering)
7–8. detected_at = chunk start + offset; geog interpolated along the track; insert → realtime to the walk screen
"""

import logging
import subprocess
import threading
from datetime import timedelta
from functools import lru_cache
from pathlib import Path

from app import db, storage
from app.audio import birdnet
from app.audio.filtering import ANOMALY_REASON, Taxon, keep_detections
from app.config import get_settings

log = logging.getLogger(__name__)

MIME_EXT = {
    "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/webm": "webm",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
}

_expected_cache: dict[str, set[str]] = {}
_expected_lock = threading.Lock()


def ext_for(mime: str) -> str:
    return MIME_EXT.get(mime.split(";")[0].strip().lower(), "bin")


def walk_tmp_dir(walk_id: str) -> Path:
    return Path(get_settings().audio_tmp_dir) / walk_id


def process_chunk(chunk_id: str, raw_path: str, mime: str) -> None:
    with db.connect() as conn:
        chunk = conn.execute(
            "select id, walk_id, chunk_index, started_at, storage_path from audio_chunks where id = %s", (chunk_id,)
        ).fetchone()
    status = "failed"
    try:
        n = _process(chunk, Path(raw_path), mime)
        status = "processed"
        log.info("chunk %s/%s: %d detections", chunk["walk_id"], chunk["chunk_index"], n)
    except Exception:
        log.exception("chunk %s failed", chunk_id)
    finally:
        with db.connect() as conn:
            conn.execute("update audio_chunks set status = %s where id = %s", (status, chunk_id))
        Path(raw_path).unlink(missing_ok=True)


def _process(chunk: dict, raw: Path, mime: str) -> int:
    walk_id = str(chunk["walk_id"])
    wav = walk_tmp_dir(walk_id) / f"{chunk['chunk_index']}.wav"
    subprocess.run(
        [get_settings().ffmpeg_bin, "-v", "error", "-y", "-i", str(raw), "-ac", "1", "-ar", "48000", str(wav)],
        check=True, capture_output=True,
    )

    by_sci, by_common = _taxonomy()
    s = get_settings()
    kept = keep_detections(birdnet.analyze(str(wav)), by_sci, by_common, _expected_for_walk(walk_id),
                           s.min_conf, s.anomaly_conf)
    with db.connect() as conn, conn.cursor() as cur:
        cur.executemany(
                """
                insert into detections (walk_id, chunk_id, species_code, common_name, sci_name, confidence,
                                        detected_at, geog, is_anomaly, anomaly_reason)
                select %(w)s, %(c)s, %(code)s, %(name)s, %(sci)s, %(conf)s, %(t)s,
                       case when b.geog is null then a.geog
                            when a.geog is null or a.recorded_at = b.recorded_at then b.geog
                            else ST_LineInterpolatePoint(
                                   ST_MakeLine(b.geog::geometry, a.geog::geometry),
                                   extract(epoch from %(t)s - b.recorded_at)
                                     / extract(epoch from a.recorded_at - b.recorded_at))::geography
                       end,
                       %(anom)s, %(reason)s
                  from (select 1) one
                  left join lateral (select geog, recorded_at from track_points
                                      where walk_id = %(w)s and recorded_at <= %(t)s
                                      order by recorded_at desc limit 1) b on true
                  left join lateral (select geog, recorded_at from track_points
                                      where walk_id = %(w)s and recorded_at >= %(t)s
                                      order by recorded_at limit 1) a on true
                """,
                [{"w": walk_id, "c": chunk["id"], "code": k.taxon.species_code, "name": k.taxon.common_name,
                  "sci": k.taxon.sci_name, "conf": k.confidence,
                  "t": chunk["started_at"] + timedelta(seconds=k.start_time),
                  "anom": k.is_anomaly, "reason": ANOMALY_REASON if k.is_anomaly else None}
                 for k in kept],
            )

    # Archive the original after detections are live, so the upload isn't on the latency path.
    try:
        storage.upload("audio-chunks", chunk["storage_path"], raw.read_bytes(), mime.split(";")[0])
    except Exception:
        log.exception("storage upload failed for chunk %s", chunk["id"])
    return len(kept)


@lru_cache  # exceptions aren't cached, so an empty table is retried next chunk
def _taxonomy() -> tuple[dict[str, Taxon], dict[str, Taxon]]:
    with db.connect() as conn:
        rows = conn.execute("select species_code, common_name, sci_name from ebird_taxonomy").fetchall()
    if not rows:
        raise RuntimeError("ebird_taxonomy is empty; run `python -m app.birds.ebird`")
    taxa = [Taxon(r["species_code"], r["common_name"], r["sci_name"]) for r in rows]
    return {t.sci_name.lower(): t for t in taxa}, {t.common_name.lower(): t for t in taxa}


def _expected_for_walk(walk_id: str) -> set[str]:
    """BirdNET range list for the walk's start point + date. Only cached once a real GPS fix exists,
    so an early chunk that arrives before the first track batch doesn't pin the fallback location."""
    with _expected_lock:
        if walk_id in _expected_cache:
            return _expected_cache[walk_id]
    with db.connect() as conn:
        row = conn.execute(
            """
            select w.started_at,
                   (select ST_Y(geog::geometry) from track_points where walk_id = w.id order by recorded_at limit 1) lat,
                   (select ST_X(geog::geometry) from track_points where walk_id = w.id order by recorded_at limit 1) lng,
                   p.last_lat, p.last_lng
              from walks w join profiles p on p.id = w.user_id
             where w.id = %s
            """,
            (walk_id,),
        ).fetchone()
    s = get_settings()
    if row["lat"] is not None:
        lat, lng, final = row["lat"], row["lng"], True
    elif row["last_lat"] is not None:
        lat, lng, final = row["last_lat"], row["last_lng"], False
    else:
        lat, lng, final = s.default_lat, s.default_lng, False
    expected = birdnet.location_species(lat, lng, row["started_at"].date())
    if final:
        with _expected_lock:
            _expected_cache[walk_id] = expected
    return expected


def forget_walk(walk_id: str) -> None:
    with _expected_lock:
        _expected_cache.pop(walk_id, None)
