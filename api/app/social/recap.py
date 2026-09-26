"""Recap for GET /walks/{id} and RecapSummary for the feed/profile (§6), masked per viewer (§7.9).

precise (owner or mutual follow): route, per-species/photo locations, static map.
otherwise: public_area_label only. Clips, spectrograms and photos carry no location, so everyone gets them.
summary=True drops clip/spectrogram URLs and photos beyond the first 3, and thins the route to at most
SUMMARY_ROUTE_POINTS points (feed cards draw it as a sketch; see docs/CONTRACT_CHANGES.md).
"""

import psycopg

from app import schemas as s
from app import storage

TIER_ORDER = "case ws.rarity_tier when 'rare' then 0 when 'uncommon' then 1 else 2 end"
SUMMARY_ROUTE_POINTS = 80


def build_recap(conn: psycopg.Connection, walk_id: str, viewer_id: str, summary: bool = False) -> s.Recap | None:
    w = conn.execute(
        """
        select w.id, w.user_id, w.status, w.started_at, w.ended_at, w.distance_m, w.duration_s, w.species_count,
               w.points, w.recap_text, w.static_map_path, w.public_area_label,
               p.username, p.display_name, p.avatar_url,
               (w.user_id = %(v)s or are_friends(w.user_id, %(v)s)) as precise,
               (select count(*) from chirps where walk_id = w.id) as chirp_count,
               (select count(*) from comments where walk_id = w.id) as comment_count,
               exists (select 1 from chirps where walk_id = w.id and user_id = %(v)s) as viewer_chirped
          from walks w join profiles p on p.id = w.user_id
         where w.id = %(w)s
        """,
        {"w": walk_id, "v": viewer_id},
    ).fetchone()
    if not w:
        return None
    precise = w["precise"]

    species = conn.execute(
        f"""
        select ws.*, ST_Y(ws.geog::geometry) lat, ST_X(ws.geog::geometry) lng, ph.storage_path photo_path
          from walk_species ws left join photos ph on ph.id = ws.photo_id
         where ws.walk_id = %s
         order by {TIER_ORDER}, ws.first_detected_at nulls last
        """,
        (walk_id,),
    ).fetchall()
    photos = conn.execute(
        "select id, storage_path, species_code, status, ST_Y(geog::geometry) lat, ST_X(geog::geometry) lng"
        " from photos where walk_id = %s order by captured_at",
        (walk_id,),
    ).fetchall()
    if summary:
        photos = photos[:3]
    route = None
    if precise:
        route = [
            [r["lng"], r["lat"]]
            for r in conn.execute(
                "select ST_X(geog::geometry) lng, ST_Y(geog::geometry) lat from track_points"
                " where walk_id = %s order by recorded_at",
                (walk_id,),
            )
        ]
        if summary and len(route) > SUMMARY_ROUTE_POINTS:
            step = (len(route) - 1) / (SUMMARY_ROUTE_POINTS - 1)
            route = [route[round(i * step)] for i in range(SUMMARY_ROUTE_POINTS)]

    photo_urls = storage.signed_urls("photos", [p["storage_path"] for p in photos] + [r["photo_path"] for r in species])
    clip_urls = {} if summary else storage.signed_urls("clips", [r["clip_path"] for r in species])
    spec_urls = {} if summary else storage.signed_urls("spectrograms", [r["spectrogram_path"] for r in species])
    static_map_url = storage.signed_url("static-maps", w["static_map_path"]) if precise else None

    def loc(r) -> s.LatLng | None:
        return s.LatLng(lat=r["lat"], lng=r["lng"]) if precise and r["lat"] is not None else None

    return s.Recap(
        walk_id=str(w["id"]),
        user=s.UserRef(id=str(w["user_id"]), username=w["username"], display_name=w["display_name"],
                       avatar_url=w["avatar_url"]),
        status=w["status"],
        started_at=w["started_at"],
        ended_at=w["ended_at"],
        distance_m=w["distance_m"],
        duration_s=w["duration_s"],
        species_count=w["species_count"],
        points=w["points"],
        precise=precise,
        public_area_label=w["public_area_label"],
        route=route,
        static_map_url=static_map_url,
        species=[
            s.RecapSpecies(
                species_code=r["species_code"], common_name=r["common_name"], sci_name=r["sci_name"],
                family_com_name=r["family_com_name"], rarity_tier=r["rarity_tier"], heard=r["heard"],
                photographed=r["photographed"], detection_count=r["detection_count"],
                first_detected_at=r["first_detected_at"], location=loc(r), best_confidence=r["best_confidence"],
                clip_url=clip_urls.get(r["clip_path"]), spectrogram_url=spec_urls.get(r["spectrogram_path"]),
                photo_url=photo_urls.get(r["photo_path"]), points=r["points"], is_anomaly=r["is_anomaly"],
                summary=r.get("summary"),  # .get: the column may not be migrated yet on every database
            )
            for r in species
        ],
        photos=[
            s.RecapPhoto(photo_id=str(p["id"]), url=photo_urls.get(p["storage_path"]), species_code=p["species_code"],
                         status=p["status"], location=loc(p))
            for p in photos
        ],
        recap_text=w["recap_text"],
        quests_progressed=[],  # TODO (C, §7.7): needs per-walk quest progress
        bounties_claimed=[],   # TODO (C, §7.6)
        bounties_created=[],   # TODO (C, §7.6)
        chirp_count=w["chirp_count"],
        comment_count=w["comment_count"],
        viewer_chirped=w["viewer_chirped"],
    )
