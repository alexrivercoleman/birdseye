"""Walk finish orchestrator (§7.10). Owned by C; calls B's modules for rarity tiers and clips.

Workstream B hooks (imported lazily; until they exist the step is skipped with a warning):
    app.birds.rarity.tiers_for_walk(lat: float, lng: float, on: date, species_codes: list[str]) -> dict[str, str]
        species_code -> "common" | "uncommon" | "rare". Must not raise when eBird is down (§7.4).
    app.audio.clips.render_clip(walk_id: str, detection_id: str, common_name: str) -> tuple[str | None, str | None]
        Returns (clip_path, spectrogram_path) Storage paths.

run_finish(walk_id) is called as a BackgroundTask by POST /walks/{id}/finish.
rescore_walk(walk_id) re-runs steps 3, 4, 6, 7, 8 when a photo is confirmed after finish.
"""

import logging
import shutil
import time
from collections.abc import Callable
from datetime import datetime, timezone

import httpx
import psycopg

from app import db
from app.audio.pipeline import forget_walk, walk_tmp_dir
from app.config import get_settings
from app.game.quests import refresh_progress
from app.game.scoring import apply_walk_scores

log = logging.getLogger(__name__)

PENDING_TIMEOUT_S = 60


def run_finish(walk_id: str) -> None:
    _wait_for_pending(walk_id)
    with db.connect() as conn:
        walk = _load_walk(conn, walk_id)
        try:
            stats = _compute_stats(conn, walk)                    # 2
            _build_walk_species(conn, walk_id)                    # 3
            _assign_tiers(conn, walk, stats)                      # 4
            conn.commit()
            _optional(conn, "clips", lambda: _make_clips(conn, walk_id))  # 5
            apply_walk_scores(conn, walk, stats["centroid"])     # 6
            # 7 bounties (§7.6): TODO (P1)
            _optional(conn, "public area", lambda: _public_area(conn, walk_id, stats))  # 9
            # 10 static map (P3), 11 AI recap (P2): TODO
            _complete(conn, walk, stats)                          # 12
            _optional(conn, "quests", lambda: _quests(conn, walk))  # 8: after 12, it only counts complete walks
        except Exception:
            # Never leave a walk stuck in "processing": the recap screen would spin forever.
            log.exception("finish pipeline failed for walk %s; marking complete with partial data", walk_id)
            conn.rollback()
            conn.execute("update walks set status = 'complete' where id = %s", (walk_id,))
    shutil.rmtree(walk_tmp_dir(walk_id), ignore_errors=True)
    forget_walk(walk_id)


def rescore_walk(walk_id: str) -> None:
    with db.connect() as conn:
        walk = _load_walk(conn, walk_id)
        if not walk or walk["status"] != "complete":
            return  # run_finish hasn't happened yet (or is running) and will pick the photo up
        stats = _compute_stats(conn, walk, update=False)
        _build_walk_species(conn, walk_id)
        _assign_tiers(conn, walk, stats)
        apply_walk_scores(conn, walk, stats["centroid"])
        # 7 bounties: TODO (P1)
        _update_walk_points(conn, walk_id)
        _optional(conn, "quests", lambda: _quests(conn, walk))


# ---- steps ----------------------------------------------------------------

def _wait_for_pending(walk_id: str) -> None:
    deadline = time.monotonic() + PENDING_TIMEOUT_S
    while True:
        with db.connect() as conn:
            n = conn.execute(
                """
                select (select count(*) from audio_chunks where walk_id = %(w)s and status = 'uploaded')
                     + (select count(*) from photos where walk_id = %(w)s and status = 'processing') as n
                """,
                {"w": walk_id},
            ).fetchone()["n"]
        if n == 0:
            return
        if time.monotonic() > deadline:
            log.warning("walk %s: finishing with %d chunks/photos still pending", walk_id, n)
            return
        time.sleep(2)


def _load_walk(conn: psycopg.Connection, walk_id: str) -> dict:
    return conn.execute("select id, user_id, status, started_at, ended_at from walks where id = %s", (walk_id,)).fetchone()


def _compute_stats(conn: psycopg.Connection, walk: dict, update: bool = True) -> dict:
    """distance_m = geodesic length of the track; centroid/start as (lng, lat) or None if no track."""
    row = conn.execute(
        """
        with pts as (select geog::geometry g, recorded_at from track_points where walk_id = %(w)s)
        select coalesce(ST_Length(ST_MakeLine(g order by recorded_at)::geography), 0) as distance_m,
               ST_X(ST_Centroid(ST_Collect(g))) as c_lng, ST_Y(ST_Centroid(ST_Collect(g))) as c_lat,
               ST_X((array_agg(g order by recorded_at))[1]) as s_lng,
               ST_Y((array_agg(g order by recorded_at))[1]) as s_lat
          from pts
        """,
        {"w": walk["id"]},
    ).fetchone()
    stats = {
        "distance_m": row["distance_m"],
        "centroid": (row["c_lng"], row["c_lat"]) if row["c_lng"] is not None else None,
        "start": (row["s_lng"], row["s_lat"]) if row["s_lng"] is not None else None,
    }
    if update:
        conn.execute(
            """
            update walks set distance_m = %s,
                   duration_s = extract(epoch from coalesce(ended_at, now()) - started_at)::int
             where id = %s
            """,
            (stats["distance_m"], walk["id"]),
        )
    return stats


def _build_walk_species(conn: psycopg.Connection, walk_id: str) -> None:
    """One row per species from detections + confirmed photos. Upsert keeps B's clip/spectrogram paths."""
    conn.execute(
        """
        with det as (
            select species_code,
                   count(*) as detection_count,
                   min(detected_at) as first_at,
                   bool_or(is_anomaly) as is_anomaly,
                   (array_agg(id order by confidence desc))[1] as best_id,
                   max(confidence) as best_conf,
                   (array_agg(geog order by detected_at) filter (where geog is not null))[1] as geog,
                   min(common_name) as common_name,
                   min(sci_name) as sci_name
              from detections where walk_id = %(w)s
             group by species_code
        ), pho as (
            select p.species_code,
                   (array_agg(p.id order by p.captured_at))[1] as photo_id,
                   min(p.captured_at) as first_at,
                   (array_agg(p.geog order by p.captured_at) filter (where p.geog is not null))[1] as geog,
                   min(s.value ->> 'common_name') as common_name
              from photos p
              left join lateral jsonb_array_elements(p.suggestions) s on s.value ->> 'species_code' = p.species_code
             where p.walk_id = %(w)s and p.status = 'confirmed' and p.species_code is not null
             group by p.species_code
        )
        insert into walk_species as ws (
            walk_id, species_code, common_name, sci_name, family_com_name, heard, photographed,
            detection_count, first_detected_at, geog, best_detection_id, best_confidence, photo_id, is_anomaly)
        select %(w)s, code,
               coalesce(t.common_name, d.common_name, p.common_name, code),
               coalesce(t.sci_name, d.sci_name),
               t.family_com_name,
               d.species_code is not null,
               p.species_code is not null,
               coalesce(d.detection_count, 0),
               coalesce(d.first_at, p.first_at),
               coalesce(d.geog, p.geog),
               d.best_id, d.best_conf, p.photo_id,
               coalesce(d.is_anomaly, false)
          from det d
          full join pho p using (species_code)
          cross join lateral (select coalesce(d.species_code, p.species_code) as code) c
          left join ebird_taxonomy t on t.species_code = c.code
        on conflict (walk_id, species_code) do update set
            common_name = excluded.common_name, sci_name = excluded.sci_name,
            family_com_name = excluded.family_com_name, heard = excluded.heard,
            photographed = excluded.photographed, detection_count = excluded.detection_count,
            first_detected_at = excluded.first_detected_at, geog = excluded.geog,
            best_detection_id = excluded.best_detection_id, best_confidence = excluded.best_confidence,
            photo_id = excluded.photo_id, is_anomaly = excluded.is_anomaly
        """,
        {"w": walk_id},
    )
    conn.execute(
        """
        delete from walk_species ws where walk_id = %(w)s
           and not exists (select 1 from detections d where d.walk_id = %(w)s and d.species_code = ws.species_code)
           and not exists (select 1 from photos p where p.walk_id = %(w)s and p.status = 'confirmed'
                                                  and p.species_code = ws.species_code)
        """,
        {"w": walk_id},
    )
    conn.execute(
        "update walks set species_count = (select count(*) from walk_species where walk_id = %(w)s) where id = %(w)s",
        {"w": walk_id},
    )


def _assign_tiers(conn: psycopg.Connection, walk: dict, stats: dict) -> None:
    rows = conn.execute("select species_code, is_anomaly from walk_species where walk_id = %s", (walk["id"],)).fetchall()
    tiers: dict[str, str] = {}
    try:
        from app.birds.rarity import tiers_for_walk  # Workstream B
        s = get_settings()
        lng, lat = stats["start"] or (s.default_lng, s.default_lat)
        tiers = tiers_for_walk(lat, lng, walk["started_at"].date(), [r["species_code"] for r in rows])
    except ImportError as e:
        log.warning("rarity tiers unavailable (%s); defaulting to common", e)
    except Exception:
        log.exception("rarity tiers failed for walk %s; defaulting to common", walk["id"])
    with conn.cursor() as cur:
        cur.executemany(
            "update walk_species set rarity_tier = %s where walk_id = %s and species_code = %s",
            [("rare" if r["is_anomaly"] else tiers.get(r["species_code"], "common"), walk["id"], r["species_code"])
             for r in rows],
        )


def _make_clips(conn: psycopg.Connection, walk_id: str) -> None:
    try:
        from app.audio.clips import render_clip  # Workstream B
    except ImportError as e:
        log.warning("clips unavailable (%s); skipping", e)
        return
    rows = conn.execute(
        "select species_code, common_name, best_detection_id from walk_species"
        " where walk_id = %s and heard and best_detection_id is not null",
        (walk_id,),
    ).fetchall()
    for r in rows:
        try:
            clip, spec = render_clip(walk_id, str(r["best_detection_id"]), r["common_name"])
        except Exception:
            log.exception("clip failed for %s on walk %s", r["species_code"], walk_id)
            continue
        conn.execute(
            "update walk_species set clip_path = %s, spectrogram_path = %s where walk_id = %s and species_code = %s",
            (clip, spec, walk_id, r["species_code"]),
        )


def _public_area(conn: psycopg.Connection, walk_id: str, stats: dict) -> None:
    """§7.9: centroid snapped to a 0.02° grid + Mapbox reverse-geocoded neighborhood/locality label."""
    if not stats["centroid"]:
        return
    lng, lat = stats["centroid"]
    conn.execute(
        """
        update walks set public_area_geog =
               ST_SnapToGrid(ST_SetSRID(ST_MakePoint(%s, %s), 4326), 0.02)::geography
         where id = %s
        """,
        (lng, lat, walk_id),
    )
    try:
        label = reverse_geocode_label(lat, lng)
    except httpx.HTTPError:
        log.exception("reverse geocode failed for walk %s", walk_id)
        label = None
    if label:
        conn.execute("update walks set public_area_label = %s where id = %s", (label, walk_id))


def reverse_geocode_label(lat: float, lng: float) -> str | None:
    """e.g. "Candler Park, Atlanta". Mapbox Geocoding v6 reverse (verified against docs 2026-09-25)."""
    token = get_settings().mapbox_token
    if not token:
        return None
    r = httpx.get(
        "https://api.mapbox.com/search/geocode/v6/reverse",
        params={"longitude": lng, "latitude": lat, "types": "neighborhood,locality,place", "access_token": token},
        timeout=10,
    )
    r.raise_for_status()
    features = r.json().get("features") or []
    if not features:
        return None
    props = features[0]["properties"]
    name = props.get("name")
    place = (props.get("context") or {}).get("place", {}).get("name")
    return f"{name}, {place}" if place and place != name else name


def _complete(conn: psycopg.Connection, walk: dict, stats: dict) -> None:
    _update_walk_points(conn, walk["id"])
    conn.execute("update walks set status = 'complete' where id = %s", (walk["id"],))
    # profiles are readable by every signed-in user, so store the coarse public point, not the centroid.
    conn.execute(
        """
        update profiles p set last_lat = ST_Y(w.public_area_geog::geometry), last_lng = ST_X(w.public_area_geog::geometry)
          from walks w where w.id = %s and p.id = w.user_id and w.public_area_geog is not null
        """,
        (walk["id"],),
    )


def _quests(conn: psycopg.Connection, walk: dict) -> None:
    now = datetime.now(timezone.utc)
    refresh_progress(conn, str(walk["user_id"]), now)


def _update_walk_points(conn: psycopg.Connection, walk_id: str) -> None:
    conn.execute(
        "update walks set points = (select coalesce(sum(amount), 0) from points_ledger where walk_id = %(w)s)"
        " where id = %(w)s",
        {"w": walk_id},
    )


def _optional(conn: psycopg.Connection, name: str, fn: Callable[[], None]) -> None:
    """Steps whose failure must not fail the walk (§7.10): commit what came before, isolate this one."""
    conn.commit()
    try:
        fn()
        conn.commit()
    except Exception:
        log.exception("finish step %r failed; leaving its fields null", name)
        conn.rollback()
