"""eBird API 2.0 client + Postgres cache (§7.4). Endpoints/params verified against the live API 2026-09-25.

Recent/notable lists are cached in ebird_cache per 0.1° cell for 24 h, as [{speciesCode, comName, sciName}].
Run `python -m app.birds.ebird` to (re)load ebird_taxonomy; the API also loads it at startup if empty.
"""

import hashlib
import json
import logging
from datetime import date

import httpx
import psycopg
from psycopg.types.json import Jsonb

from app import db
from app.config import get_settings

log = logging.getLogger(__name__)

BASE = "https://api.ebird.org/v2"
CACHE_TTL = "24 hours"


def _get(path: str, params: dict, *, timeout: float = 30) -> list:
    r = httpx.get(BASE + path, params=params, headers={"X-eBirdApiToken": get_settings().ebird_api_key}, timeout=timeout)
    r.raise_for_status()
    return r.json()


def _cell(lat: float, lng: float) -> tuple[float, float]:
    return round(lat, 1), round(lng, 1)


def _cached_obs(conn: psycopg.Connection, kind: str, path: str, lat: float, lng: float, params: dict) -> list[dict]:
    clat, clng = _cell(lat, lng)
    key = f"{kind}:{clat}:{clng}"
    row = conn.execute(
        f"select payload from ebird_cache where cache_key = %s and fetched_at > now() - interval '{CACHE_TTL}'", (key,)
    ).fetchone()
    if row:
        return row["payload"]
    obs = _get(path, {"lat": clat, "lng": clng, **params})
    seen, payload = set(), []
    for o in obs:
        if o["speciesCode"] not in seen:
            seen.add(o["speciesCode"])
            payload.append({"speciesCode": o["speciesCode"], "comName": o["comName"], "sciName": o["sciName"]})
    conn.execute(
        "insert into ebird_cache (cache_key, payload, fetched_at) values (%s, %s, now())"
        " on conflict (cache_key) do update set payload = excluded.payload, fetched_at = now()",
        (key, Jsonb(payload)),
    )
    return payload


def recent_species(conn: psycopg.Connection, lat: float, lng: float) -> list[dict]:
    """Set R: species reported within 25 km in the last 30 days."""
    return _cached_obs(conn, "recent", "/data/obs/geo/recent", lat, lng, {"dist": 25, "back": 30})


def notable_species(conn: psycopg.Connection, lat: float, lng: float) -> list[dict]:
    """Set N: eBird 'notable' (unusual for the area) within 50 km in the last 14 days."""
    return _cached_obs(conn, "notable", "/data/obs/geo/recent/notable", lat, lng, {"dist": 50, "back": 14})


def load_taxonomy() -> int:
    rows = _get("/ref/taxonomy/ebird", {"fmt": "json", "cat": "species"})
    with db.connect() as conn, conn.cursor() as cur:
        cur.executemany(
            """
            insert into ebird_taxonomy (species_code, common_name, sci_name, family_com_name, family_sci_name, order_name)
            values (%s, %s, %s, %s, %s, %s)
            on conflict (species_code) do update set
                common_name = excluded.common_name, sci_name = excluded.sci_name,
                family_com_name = excluded.family_com_name, family_sci_name = excluded.family_sci_name,
                order_name = excluded.order_name
            """,
            [(r["speciesCode"], r["comName"], r["sciName"], r.get("familyComName"), r.get("familySciName"), r.get("order"))
             for r in rows],
        )
    return len(rows)


def ensure_taxonomy() -> None:
    with db.connect() as conn:
        n = conn.execute("select count(*) n from ebird_taxonomy").fetchone()["n"]
    if n == 0:
        log.info("loaded %d eBird taxonomy rows", load_taxonomy())


def _cached_photo_data(conn: psycopg.Connection, path: str, params: dict) -> list[dict]:
    """Cache every query parameter and preserve dates/coordinates for photo checks.

    The rarity cache intentionally discards observation dates, so use a separate
    namespace. Store only fields needed for geographic/temporal validation.
    """
    query = json.dumps([path, params], sort_keys=True)
    key = "photo:v1:" + hashlib.sha256(query.encode()).hexdigest()
    row = conn.execute(
        "select payload from ebird_cache where cache_key = %s"
        " and fetched_at > now() - interval '24 hours'", (key,),
    ).fetchone()
    if row:
        return row["payload"]
    fields = {"speciesCode", "obsDt", "lat", "lng", "locId"}
    payload = [{k: v for k, v in o.items() if k in fields} for o in _get(path, params, timeout=8)]
    conn.execute(
        "insert into ebird_cache (cache_key, payload, fetched_at) values (%s, %s, now())"
        " on conflict (cache_key) do update set payload = excluded.payload, fetched_at = now()",
        (key, Jsonb(payload)),
    )
    return payload


def nearby_photo_observations(conn: psycopg.Connection, lat: float, lng: float, radius_km: float) -> list[dict]:
    """Most recent reviewed observation per species, at most 30 days old."""
    return _cached_photo_data(conn, "/data/obs/geo/recent", {
        "lat": round(lat, 2), "lng": round(lng, 2), "dist": radius_km,
        "back": 30, "cat": "species", "includeProvisional": "false",
    })


def nearby_hotspots(conn: psycopg.Connection, lat: float, lng: float, radius_km: float) -> list[dict]:
    return _cached_photo_data(conn, "/ref/hotspot/geo", {
        "lat": round(lat, 2), "lng": round(lng, 2), "dist": radius_km, "fmt": "json",
    })


def historic_photo_observations(conn: psycopg.Connection, location_ids: list[str], on: date) -> list[dict]:
    """Reviewed observations on a date at up to 50 explicit eBird locations.

    Endpoint and `r` parameter verified against the official API 2.0 collection:
    https://documenter.getpostman.com/view/664302/S1ENwy59
    """
    locations = sorted(set(location_ids))
    if not locations:
        return []
    if len(locations) > 50:
        raise ValueError("eBird supports at most 50 locations per historical query")
    return _cached_photo_data(conn, f"/data/obs/{locations[0]}/historic/{on.year}/{on.month}/{on.day}", {
        "r": ",".join(locations), "cat": "species", "includeProvisional": "false",
    })


if __name__ == "__main__":
    print(f"loaded {load_taxonomy()} species into ebird_taxonomy")
