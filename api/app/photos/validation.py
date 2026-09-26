"""Use nearby, date-matched eBird reports as positive evidence after vision ID.

Absence from eBird is not evidence of absence. Never discard a visual candidate
because it was not reported, and never describe the ranking score as confidence.
"""

import logging
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from math import asin, cos, isfinite, radians, sin, sqrt

from app import db
from app.birds import ebird
from app.config import get_settings

log = logging.getLogger(__name__)
RADIUS_KM = 25
MAX_HOTSPOTS = 20
RECENT_BOOST = 0.10
SEASON_BOOST = 0.05


def distance_km(lat: float, lng: float, other_lat: float, other_lng: float) -> float:
    a, b = radians(lat), radians(other_lat)
    h = sin((b - a) / 2) ** 2 + cos(a) * cos(b) * sin(radians(other_lng - lng) / 2) ** 2
    return 6371 * 2 * asin(sqrt(min(1, max(0, h))))


def _nearby(row: dict, lat: float, lng: float) -> bool:
    try:
        a, b = float(row["lat"]), float(row["lng"])
        return -90 <= a <= 90 and -180 <= b <= 180 and distance_km(lat, lng, a, b) <= RADIUS_KM
    except (KeyError, TypeError, ValueError):
        return False


def _codes(rows: list[dict], lat: float, lng: float, start: date, end: date) -> set[str]:
    codes = set()
    for row in rows:
        try:
            observed = date.fromisoformat(row["obsDt"][:10])
        except (KeyError, TypeError, ValueError):
            continue
        if start <= observed <= end and _nearby(row, lat, lng) and row.get("speciesCode"):
            codes.add(row["speciesCode"])
    return codes


def seasonal_dates(on: date) -> list[date]:
    """Three bounded samples around the same calendar date in the prior year."""
    year = on.year - 1
    anchor = date(year, on.month, min(on.day, monthrange(year, on.month)[1]))
    return [anchor + timedelta(days=offset) for offset in (-7, 0, 7)
            if (anchor + timedelta(days=offset)).year >= 1800]


def rerank_candidates(
    candidates: list[dict], lat: float | None, lng: float | None, captured_at: datetime | None,
    *, today: date | None = None,
) -> list[dict]:
    """Return the same suggestions in evidence-weighted order; preserve confidence.

    Missing metadata/key, future dates, unsupported historical dates, and eBird
    failures keep the original ranking. `today` is injectable for deterministic
    tests. Dates use the supplied timestamp's calendar date (UTC after DB storage).
    """
    if not candidates or not get_settings().ebird_api_key or captured_at is None:
        return candidates
    if lat is None or lng is None or not (isfinite(lat) and isfinite(lng)):
        return candidates
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return candidates
    on = captured_at.date()
    today = today or datetime.now(timezone.utc).date()
    if on > today or on.year <= 1800:
        return candidates
    try:
        # Separate transaction from taxonomy/persistence: an eBird/cache failure
        # must not leave the caller's DB transaction aborted.
        with db.connect() as conn:
            recent = set()
            if (today - on).days < 30:
                rows = ebird.nearby_photo_observations(conn, lat, lng, RADIUS_KM)
                recent = _codes(rows, lat, lng, on - timedelta(days=29), on)
            hotspots = ebird.nearby_hotspots(conn, lat, lng, RADIUS_KM)
            hotspots = sorted(
                (h for h in hotspots if h.get("locId") and _nearby(h, lat, lng)),
                key=lambda h: distance_km(lat, lng, float(h["lat"]), float(h["lng"])),
            )[:MAX_HOTSPOTS]
            locations = [h["locId"] for h in hotspots]
            seasonal = set()
            if locations:
                # Old uploads need evidence from their capture date, not today.
                if (today - on).days >= 30:
                    recent = _codes(ebird.historic_photo_observations(conn, locations, on), lat, lng, on, on)
                for day in seasonal_dates(on):
                    rows = ebird.historic_photo_observations(conn, locations, day)
                    seasonal.update(_codes(rows, lat, lng, day, day))
    except Exception:
        log.warning("eBird photo validation unavailable; retaining visual ranking", exc_info=True)
        return candidates

    def score(candidate: dict) -> float:
        confidence = candidate.get("confidence")
        if confidence is None:  # Walk-audio fallback has no visual confidence.
            return 0
        code = candidate["species_code"]
        return confidence + RECENT_BOOST * (code in recent) + SEASON_BOOST * (code in seasonal)

    ranked = sorted(candidates, key=score, reverse=True)
    log.info("Photo eBird check: %d recent and %d seasonal candidate matches",
             sum(c["species_code"] in recent for c in candidates),
             sum(c["species_code"] in seasonal for c in candidates))
    return ranked
