from fastapi import APIRouter, Depends

from app import schemas as s
from app import stubs
from app.auth import CurrentUser, get_current_user

router = APIRouter(tags=["map"])


@router.get("/map/community", response_model=s.CommunityMap)
async def community_map(bbox: str, user: CurrentUser = Depends(get_current_user)):
    # bbox = minLng,minLat,maxLng,maxLat
    return s.CommunityMap(  # STUB (C: §7.13)
        trails=[
            s.MapTrail(
                trail_id="00000000-0000-0000-0000-00000000a001", name="Piedmont Park Loop",
                geometry={"type": "LineString", "coordinates": [[-84.3738, 33.7851], [-84.3705, 33.7880], [-84.3719, 33.7897]]},
                species_total=23,
            )
        ],
        bounties=stubs.bounties(),
        anomalies=[],
        heat=[s.HeatPoint(lat=33.7866, lng=-84.3722, weight=3), s.HeatPoint(lat=33.7880, lng=-84.3705, weight=5)],
    )


@router.get("/trails/{trail_id}/species", response_model=s.TrailSpecies)
async def trail_species(trail_id: str, user: CurrentUser = Depends(get_current_user)):
    return s.TrailSpecies(  # STUB
        name="Piedmont Park Loop",
        top_species=[
            s.TrailTopSpecies(species_code="carwre", common_name="Carolina Wren", rarity_tier="common", walks=18, users=9),
            s.TrailTopSpecies(species_code="pilwoo", common_name="Pileated Woodpecker", rarity_tier="uncommon", walks=4, users=3),
        ],
    )
