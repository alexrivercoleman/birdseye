"""Community map (§7.13): trails ranked by species heard near them, active bounties, fuzzed anomalies, and a
detection heatmap on a ~250 m grid with no user attribution.

A detection counts if it has a location, is from the last 90 days, belongs to a complete walk, and isn't an
anomaly (anomalies are shown separately, fuzzed, so the heatmap and trail lists can't pinpoint them).
"""

import math
import random

import psycopg

TRAIL_BUFFER_M = 75
WINDOW = "90 days"
HEAT_GRID_DEG = 0.0025   # ~250 m
MAX_TRAILS = 300
TOP_SPECIES = 15

# joined as `detections d join walks w`
COUNTS = f"""d.geog is not null and not d.is_anomaly and d.detected_at > now() - interval '{WINDOW}'
             and w.status = 'complete'"""
ENVELOPE = "ST_MakeEnvelope(%(w)s, %(s)s, %(e)s, %(n)s, 4326)"


def _bbox(bbox: tuple[float, float, float, float]) -> dict:
    w, s, e, n = bbox
    return {"w": w, "s": s, "e": e, "n": n}


def trails(conn: psycopg.Connection, bbox: tuple[float, float, float, float]) -> list[dict]:
    """Every trail group touching the bbox, most species heard within 75 m first (0 = none yet: the map draws those
    grey, so people can see where nobody has listened)."""
    return conn.execute(
        f"""
        with vis as (
            select distinct group_id from trails where group_id is not null and geom && {ENVELOPE}::geography
        ), grp as (
            select t.group_id, min(t.name) as name, ST_Multi(ST_Collect(t.geom::geometry))::geography as geom
              from trails t join vis using (group_id) group by t.group_id
        ), counts as (
            select g.group_id, count(distinct d.species_code)::int as species_total
              from grp g
              join detections d on ST_DWithin(d.geog, g.geom, {TRAIL_BUFFER_M})
              join walks w on w.id = d.walk_id
             where {COUNTS}
             group by g.group_id
        )
        select g.group_id::text as trail_id, g.name, ST_AsGeoJSON(g.geom, 6)::json as geometry,
               coalesce(c.species_total, 0) as species_total
          from grp g left join counts c using (group_id)
         order by species_total desc
         limit {MAX_TRAILS}
        """,
        _bbox(bbox),
    ).fetchall()


def trail_species(conn: psycopg.Connection, group_id: int) -> dict | None:
    row = conn.execute("select min(name) as name from trails where group_id = %s having count(*) > 0",
                       (group_id,)).fetchone()
    if not row:
        return None
    top = conn.execute(
        f"""
        select d.species_code, min(d.common_name) as common_name,
               count(distinct d.walk_id)::int as walks, count(distinct w.user_id)::int as users,
               max(d.detected_at) as last_heard_at,
               coalesce((array_agg(ws.rarity_tier order by d.detected_at desc)
                         filter (where ws.rarity_tier is not null))[1], 'common') as rarity_tier
          from detections d
          join walks w on w.id = d.walk_id
          left join walk_species ws on ws.walk_id = d.walk_id and ws.species_code = d.species_code
         where {COUNTS}
           and exists (select 1 from trails t where t.group_id = %(g)s
                        and ST_DWithin(t.geom, d.geog, {TRAIL_BUFFER_M}))
         group by d.species_code
         order by walks desc, users desc, last_heard_at desc
         limit {TOP_SPECIES}
        """,
        {"g": group_id},
    ).fetchall()
    return {"name": row["name"], "top_species": top}


def heat(conn: psycopg.Connection, bbox: tuple[float, float, float, float]) -> list[dict]:
    """Weight = distinct (walk, species) encounters per cell, so one wren singing for an hour counts once."""
    return conn.execute(
        f"""
        select ST_Y(c) + {HEAT_GRID_DEG / 2} as lat, ST_X(c) + {HEAT_GRID_DEG / 2} as lng, count(*)::int as weight
          from (
            select distinct ST_SnapToGrid(d.geog::geometry, {HEAT_GRID_DEG}) as c, d.walk_id, d.species_code
              from detections d join walks w on w.id = d.walk_id
             where {COUNTS} and d.geog && {ENVELOPE}::geography
          ) x
         group by c
        """,
        _bbox(bbox),
    ).fetchall()


def bounties(conn: psycopg.Connection, bbox: tuple[float, float, float, float], user_id: str) -> list[dict]:
    rows = conn.execute(
        f"""
        select b.id::text as bounty_id, b.species_code, b.common_name, ST_Y(b.center_geog::geometry) as lat,
               ST_X(b.center_geog::geometry) as lng, b.radius_m, b.expires_at,
               exists (select 1 from bounty_claims c where c.bounty_id = b.id and c.user_id = %(u)s) as claimed_by_me
          from bounties b
         where b.status = 'active' and b.expires_at > now() and b.center_geog && {ENVELOPE}::geography
        """,
        _bbox(bbox) | {"u": user_id},
    ).fetchall()
    return [r | {"center": {"lat": r.pop("lat"), "lng": r.pop("lng")}} for r in rows]


def anomalies(conn: psycopg.Connection, bbox: tuple[float, float, float, float]) -> list[dict]:
    """One per (walk, species): the most confident anomalous detection, with its location fuzzed like a bounty."""
    rows = conn.execute(
        f"""
        select distinct on (d.walk_id, d.species_code)
               d.id::text as id, d.species_code, d.common_name, ST_Y(d.geog::geometry) as lat,
               ST_X(d.geog::geometry) as lng, d.detected_at, d.anomaly_reason as reason,
               exists (select 1 from photos p where p.walk_id = d.walk_id and p.species_code = d.species_code
                        and p.status = 'confirmed') as photo_confirmed
          from detections d join walks w on w.id = d.walk_id
         where d.is_anomaly and d.geog is not null and d.detected_at > now() - interval '{WINDOW}'
           and w.status = 'complete' and d.geog && {ENVELOPE}::geography
         order by d.walk_id, d.species_code, d.confidence desc
        """,
        _bbox(bbox),
    ).fetchall()
    out = []
    for r in rows:
        lat, lng = fuzz(r.pop("lat"), r.pop("lng"), seed=r.pop("id"))
        out.append(r | {"center": {"lat": lat, "lng": lng}, "radius_m": 300})
    return out


def fuzz(lat: float, lng: float, seed: str) -> tuple[float, float]:
    """§7.6: offset 100–200 m on a random bearing. Seeded so the same point always fuzzes the same way; a fresh
    offset per request would let anyone average the true location back out."""
    rng = random.Random(seed)
    bearing = rng.uniform(0, 2 * math.pi)
    dist = rng.uniform(100, 200)
    dlat = dist * math.cos(bearing) / 111_320
    dlng = dist * math.sin(bearing) / (111_320 * math.cos(math.radians(lat)))
    return lat + dlat, lng + dlng
