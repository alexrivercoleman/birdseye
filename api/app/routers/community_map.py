from fastapi import APIRouter, Depends, HTTPException

from app import db
from app import schemas as s
from app.auth import CurrentUser, get_current_user
from app.trails import community, overpass

router = APIRouter(tags=["map"])


def _parse_bbox(bbox: str) -> tuple[float, float, float, float]:
    try:
        w, south, e, n = (float(x) for x in bbox.split(","))
    except ValueError:
        raise HTTPException(422, "bbox must be minLng,minLat,maxLng,maxLat")
    if not (-180 <= w < e <= 180 and -90 <= south < n <= 90):
        raise HTTPException(422, "bbox must be minLng,minLat,maxLng,maxLat")
    return w, south, e, n


@router.get("/map/community", response_model=s.CommunityMap)
def community_map(bbox: str, user: CurrentUser = Depends(get_current_user)):
    box = _parse_bbox(bbox)
    with db.connect() as conn:
        overpass.ensure_trails(conn, *box)
        return s.CommunityMap(
            trails=community.trails(conn, box),
            bounties=community.bounties(conn, box, user.id),
            anomalies=community.anomalies(conn, box),
            heat=community.heat(conn, box),
        )


@router.get("/trails/{trail_id}/species", response_model=s.TrailSpecies)
def trail_species(trail_id: str, user: CurrentUser = Depends(get_current_user)):
    if not trail_id.isdigit():
        raise HTTPException(404, "Trail not found")
    with db.connect() as conn:
        res = community.trail_species(conn, int(trail_id))
    if not res:
        raise HTTPException(404, "Trail not found")
    return res
