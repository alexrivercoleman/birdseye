"""Trails from OpenStreetMap via Overpass (§7.13), cached in `trails` per 0.05° grid cell.

Named ways with highway in (path, footway, track, bridleway, cycleway), minus sidewalks and no-foot ways, plus the
member ways of route=hiking relations (named after the route when the way has no name of its own). cycleway goes
beyond §7.13: multi-use trails like the BeltLine and PATH trails are tagged highway=cycleway in OSM. Query syntax
verified against the Overpass QL wiki 2026-09-26. Public Overpass is rate-limited, so the demo areas are prefetched
(scripts/prefetch_trails.py) and a map request never fetches more than MAX_FETCH_CELLS cells.

OSM splits one trail into many ways, so after each fetch ways with the same name (ignoring case: OSM has both
"BeltLine" and "Beltline") that touch are grouped: group_id is the smallest osm_id in the group.
"""

import logging
import math
import time

import httpx
import psycopg

log = logging.getLogger(__name__)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"  # mirrors (kumi, private.coffee) timed out when tried
CELL_DEG = 0.05          # ~5.5 km × 4.6 km at Atlanta
MAX_FETCH_CELLS = 6      # zoomed out further than this, serve what's cached instead of hitting Overpass
GROUP_TOUCH_DEG = 0.0005  # ~50 m: same-name ways this close are the same trail
BACKOFF_S = 60           # after a failed live fetch, don't make map requests wait on Overpass again for a while

_down_until = 0.0

QUERY = """[out:json][timeout:25];
(
  way["highway"~"^(path|footway|track|bridleway|cycleway)$"]["name"]["footway"!="sidewalk"]["foot"!="no"]({s},{w},{n},{e});
  relation["route"="hiking"]({s},{w},{n},{e});
);
out geom;"""


def cells_for_bbox(min_lng: float, min_lat: float, max_lng: float, max_lat: float) -> list[tuple[int, int]]:
    return [
        (i, j)
        for i in range(math.floor(min_lat / CELL_DEG), math.floor(max_lat / CELL_DEG) + 1)
        for j in range(math.floor(min_lng / CELL_DEG), math.floor(max_lng / CELL_DEG) + 1)
    ]


def ensure_trails(conn: psycopg.Connection, min_lng: float, min_lat: float, max_lng: float, max_lat: float,
                  max_cells: int = MAX_FETCH_CELLS, attempts: int = 1) -> None:
    """Fetches any cells of the bbox not cached yet (at most max_cells, else nothing). On Overpass errors the cells
    stay unfetched and the map shows what's cached; live requests then skip Overpass for BACKOFF_S. The prefetch
    script passes more attempts."""
    global _down_until
    cells = cells_for_bbox(min_lng, min_lat, max_lng, max_lat)
    keys = [f"{i}:{j}" for i, j in cells]
    done = {r["cell"] for r in conn.execute("select cell from trail_fetch_cells where cell = any(%s)", (keys,))}
    missing = [c for c, k in zip(cells, keys) if k not in done]
    if not missing or len(missing) > max_cells or (attempts == 1 and time.monotonic() < _down_until):
        return
    # one query over the missing cells' bounding box
    s, n = round(min(i for i, _ in missing) * CELL_DEG, 4), round((max(i for i, _ in missing) + 1) * CELL_DEG, 4)
    w, e = round(min(j for _, j in missing) * CELL_DEG, 4), round((max(j for _, j in missing) + 1) * CELL_DEG, 4)
    elements = _fetch(QUERY.format(s=s, w=w, n=n, e=e), attempts)
    if elements is None:
        log.warning("Overpass unavailable for cells %s; serving cached trails", missing)
        _down_until = time.monotonic() + BACKOFF_S
        return
    names = _store(conn, elements, f"{s},{w},{n},{e}")
    _regroup(conn, names)
    conn.cursor().executemany("insert into trail_fetch_cells (cell) values (%s) on conflict do nothing",
                              [(f"{i}:{j}",) for i, j in missing])
    log.info("Overpass: %d elements for cells %s", len(elements), missing)


def _fetch(query: str, attempts: int) -> list[dict] | None:
    """Overpass 504s under load (often several times in a row), so only the prefetch script retries."""
    for attempt in range(attempts):
        if attempt:
            time.sleep(5 * attempt)
        try:
            r = httpx.post(OVERPASS_URL, data={"data": query},
                           headers={"User-Agent": "Birdseye/0.1 (hackathon bird-walk app)"},
                           timeout=15 if attempts == 1 else 40)
            r.raise_for_status()
            return r.json()["elements"]
        except (httpx.HTTPError, ValueError, KeyError) as e:
            log.warning("Overpass attempt %d/%d failed: %s", attempt + 1, attempts, e)
    return None


def _store(conn: psycopg.Connection, elements: list[dict], bbox: str) -> set[str]:
    ways: dict[int, tuple[str, list[dict]]] = {}
    for el in elements:  # named ways first, so a way keeps its own name over its route's
        if el["type"] == "way" and el.get("tags", {}).get("name") and len(el.get("geometry") or []) >= 2:
            ways[el["id"]] = (el["tags"]["name"], el["geometry"])
    for el in elements:
        route_name = el.get("tags", {}).get("name")
        if el["type"] != "relation" or not route_name:
            continue
        for m in el.get("members", []):
            if m.get("type") == "way" and len(m.get("geometry") or []) >= 2:
                ways.setdefault(m["ref"], (route_name, m["geometry"]))
    rows = [
        (osm_id, name, "LINESTRING(" + ",".join(f"{p['lon']} {p['lat']}" for p in geom) + ")", bbox)
        for osm_id, (name, geom) in ways.items()
    ]
    conn.cursor().executemany(
        "insert into trails (osm_id, name, geom, fetched_bbox) values (%s, %s, ST_GeogFromText(%s), %s)"
        " on conflict (osm_id) do nothing",
        rows,
    )
    return {name for name, _ in ways.values()}


def _regroup(conn: psycopg.Connection, names: set[str]) -> None:
    if not names:
        return
    conn.execute(
        f"""
        with c as (
            select id, osm_id, name,
                   ST_ClusterDBSCAN(geom::geometry, eps := {GROUP_TOUCH_DEG}, minpoints := 1)
                       over (partition by lower(name)) as cid
              from trails where lower(name) = any(%(names)s)
        ), g as (
            select id, min(osm_id) over (partition by lower(name), cid) as group_id from c
        )
        update trails t set group_id = g.group_id from g where t.id = g.id
        """,
        {"names": [n.lower() for n in names]},
    )
