"""Clips (§7.3, audio half): the few seconds around a species' best detection, as AAC .m4a (plays on iOS), in the
private clips bucket at {walk_id}/{detection_id}.m4a. Spectrograms aren't rendered yet; spectrogram_path stays null.

Source audio is the chunk WAV kept on disk until finish (§7.2 step 9). When it's gone (a rescore, an API restart,
or the backfill below) the archived original in audio-chunks is used instead.

Backfill every heard species that has no clip yet:  python -m app.audio.clips
"""

import logging
import subprocess
import tempfile
from pathlib import Path

from app import db, storage
from app.audio.pipeline import walk_tmp_dir
from app.config import get_settings

log = logging.getLogger(__name__)

WINDOW_S = 3.0  # BirdNET's analysis window, starting at detected_at
PAD_S = 1.0
MIN_CLIP_BYTES = 1024  # smaller means ffmpeg found no audio in the requested range


def render_clip(walk_id: str, detection_id: str, common_name: str) -> tuple[str | None, str | None]:
    """Returns (clip_path, spectrogram_path) Storage paths; (None, None) if there is no audio to cut."""
    with db.connect() as conn:
        d = conn.execute(
            """
            select d.detected_at, a.chunk_index, a.started_at, a.storage_path
              from detections d join audio_chunks a on a.id = d.chunk_id
             where d.id = %s
            """,
            (detection_id,),
        ).fetchone()
    if not d:
        return None, None
    offset = max(0.0, (d["detected_at"] - d["started_at"]).total_seconds())
    start = max(0.0, offset - PAD_S)
    duration = offset + WINDOW_S + PAD_S - start

    with tempfile.TemporaryDirectory() as tmp:
        src = walk_tmp_dir(walk_id) / f"{d['chunk_index']}.wav"
        if not src.exists():
            src = Path(tmp) / Path(d["storage_path"]).name
            src.write_bytes(storage.download("audio-chunks", d["storage_path"]))
        out = Path(tmp) / "clip.m4a"
        subprocess.run(
            [get_settings().ffmpeg_bin, "-v", "error", "-y", "-ss", f"{start:.2f}", "-t", f"{duration:.2f}",
             "-i", str(src), "-ac", "1", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", str(out)],
            check=True, capture_output=True,
        )
        if not out.exists() or out.stat().st_size < MIN_CLIP_BYTES:
            log.warning("no audio for %s clip (detection %s)", common_name, detection_id)
            return None, None
        path = f"{walk_id}/{detection_id}.m4a"
        storage.upload("clips", path, out.read_bytes(), "audio/mp4")
    return path, None


def backfill() -> int:
    with db.connect() as conn:
        rows = conn.execute(
            """
            select ws.walk_id, ws.species_code, ws.common_name, ws.best_detection_id
              from walk_species ws join walks w on w.id = ws.walk_id
             where w.status = 'complete' and ws.heard and ws.best_detection_id is not null and ws.clip_path is null
            """
        ).fetchall()
    done = 0
    for r in rows:
        try:
            clip, _ = render_clip(str(r["walk_id"]), str(r["best_detection_id"]), r["common_name"])
        except Exception:
            log.exception("clip failed for %s on walk %s", r["species_code"], r["walk_id"])
            continue
        if clip:
            with db.connect() as conn:
                conn.execute(
                    "update walk_species set clip_path = %s where walk_id = %s and species_code = %s",
                    (clip, r["walk_id"], r["species_code"]),
                )
            done += 1
    return done


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(f"wrote {backfill()} clips")
