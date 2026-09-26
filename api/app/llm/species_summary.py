"""AI species summaries: one paragraph per bird on a walk (what it is, how to recognize it, and how rare it is at that
place, season and time), stored in walk_species.summary. One LLM call per walk, only for rows without a summary, so
re-running it (rescore after a late photo confirm) only writes the new species.
"""

import json
import logging
import threading
import time
from datetime import datetime, timedelta

import psycopg

from app import db
from app.config import get_settings
from app.llm.provider import complete_json

log = logging.getLogger(__name__)

# How rarity tiers are assigned (§7.4), so the model can explain them instead of guessing.
TIER_MEANING = {
    "rare": "flagged as a notable (unusual) sighting by eBird reviewers within 50 km in the last 14 days, "
            "or detected outside its expected range/season",
    "uncommon": "not reported by eBird birders within 25 km in the last 30 days",
    "common": "reported by eBird birders within 25 km in the last 30 days",
}

SYSTEM = """You write the short field-guide note a birding app shows next to each bird a walker found.
For every bird in the input, write ONE paragraph of 3-5 sentences (at most 110 words):
1. What the bird is and how to recognize it: look, song or call, typical behavior or habitat.
2. How rare it is right here, right now: use its rarity_tier and tier_meaning, the season, and the time_of_day it
   was found (e.g. "a classic dawn singer", "less often heard at midday"). If is_anomaly is true, say it is outside
   its expected range or season and worth documenting with a photo.
Use well-established species knowledge. For anything local, use only the data given: never invent sighting counts,
named places, or events. Never quote clock times. Warm, vivid, plain language; vary the sentence openings between
birds; no headings, lists, or emoji.
Return JSON: {"summaries": {"<species_code>": "<paragraph>", ...}} with every species_code from the input."""


def _season(month: int, lat: float) -> str:
    seasons = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "fall", "fall", "fall",
               "winter"]
    s = seasons[month - 1]
    if lat < 0:
        s = {"winter": "summer", "summer": "winter", "spring": "fall", "fall": "spring"}[s]
    return s


def _time_of_day(t: datetime | None, lng: float) -> str | None:
    """Local hour estimated from longitude (can be off by an hour or two, fine for a dawn/midday/night hint)."""
    if not t:
        return None
    h = (t + timedelta(hours=round(lng / 15))).hour
    return ("night" if h < 5 else "dawn" if h < 7 else "morning" if h < 11 else "midday" if h < 14
            else "afternoon" if h < 17 else "evening" if h < 20 else "night")


def write_species_summaries(conn: psycopg.Connection, walk_id: str) -> int:
    """Returns how many summaries were written. Raises on LLM failure; callers treat this step as optional."""
    walk = conn.execute(
        """
        select w.started_at, w.public_area_label,
               coalesce(ST_Y(w.public_area_geog::geometry), p.last_lat) lat,
               coalesce(ST_X(w.public_area_geog::geometry), p.last_lng) lng
          from walks w join profiles p on p.id = w.user_id where w.id = %s
        """,
        (walk_id,),
    ).fetchone()
    rows = conn.execute(
        "select species_code, common_name, sci_name, family_com_name, rarity_tier, heard, photographed,"
        " detection_count, first_detected_at, is_anomaly from walk_species where walk_id = %s and summary is null",
        (walk_id,),
    ).fetchall()
    if not walk or not rows:
        return 0

    s = get_settings()
    lat = walk["lat"] if walk["lat"] is not None else s.default_lat
    lng = walk["lng"] if walk["lng"] is not None else s.default_lng
    started = walk["started_at"]
    payload = {
        "location": walk["public_area_label"] or f"near {lat:.1f}, {lng:.1f}",
        "date": started.date().isoformat(),
        "season": _season(started.month, lat),
        "birds": [
            {
                "species_code": r["species_code"],
                "common_name": r["common_name"],
                "scientific_name": r["sci_name"],
                "family": r["family_com_name"],
                "rarity_tier": r["rarity_tier"],
                "tier_meaning": TIER_MEANING[r["rarity_tier"]],
                "is_anomaly": r["is_anomaly"],
                "heard": r["heard"],
                "times_heard": r["detection_count"],
                "photographed": r["photographed"],
                "time_of_day": _time_of_day(r["first_detected_at"], lng),
            }
            for r in rows
        ],
    }
    summaries = complete_json(SYSTEM, json.dumps(payload)).get("summaries") or {}
    written = [(text.strip(), walk_id, code) for code, text in summaries.items()
               if isinstance(text, str) and text.strip() and any(r["species_code"] == code for r in rows)]
    with conn.cursor() as cur:
        cur.executemany("update walk_species set summary = %s where walk_id = %s and species_code = %s", written)
    if len(written) < len(rows):
        log.warning("walk %s: LLM returned %d of %d species summaries", walk_id, len(written), len(rows))
    return len(written)


# Walks finished before summaries existed (or whose LLM call failed) get them when their recap is first viewed.
# One attempt per walk at a time, and at most one every RETRY_S, so a failing LLM isn't hammered by polling clients.
RETRY_S = 300
_lock = threading.Lock()
_last_attempt: dict[str, float] = {}


def fill_missing_summaries(walk_id: str) -> None:
    with _lock:
        now = time.monotonic()
        if now - _last_attempt.get(walk_id, -RETRY_S) < RETRY_S:
            return
        _last_attempt[walk_id] = now
    try:
        with db.connect() as conn:
            write_species_summaries(conn, walk_id)
    except Exception:
        log.exception("species summaries failed for walk %s", walk_id)
