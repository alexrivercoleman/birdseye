"""Canned §6-shaped responses so the frontend can integrate before real logic lands.
Delete usages as each endpoint gets implemented."""

import uuid
from datetime import datetime, timedelta, timezone

from app import schemas as s

NOW = datetime.now(timezone.utc)
DEMO_USER = s.UserRef(id="00000000-0000-0000-0000-000000000001", username="demo_birder", display_name="Demo Birder")
PIEDMONT = s.LatLng(lat=33.7851, lng=-84.3738)


def recap(walk_id: str | None = None) -> s.Recap:
    started = NOW - timedelta(hours=2)
    return s.Recap(
        walk_id=walk_id or str(uuid.uuid4()),
        user=DEMO_USER,
        status="complete",
        started_at=started,
        ended_at=started + timedelta(minutes=70),
        distance_m=3120,
        duration_s=4210,
        species_count=3,
        points=95,
        precise=True,
        public_area_label="Piedmont Park, Atlanta",
        route=[[-84.3738, 33.7851], [-84.3722, 33.7866], [-84.3705, 33.7880], [-84.3719, 33.7897]],
        static_map_url=None,
        species=[
            s.RecapSpecies(
                species_code="pilwoo", common_name="Pileated Woodpecker", sci_name="Dryocopus pileatus",
                family_com_name="Woodpeckers", rarity_tier="uncommon", heard=True, photographed=False,
                detection_count=2, first_detected_at=started + timedelta(minutes=22),
                location=s.LatLng(lat=33.7866, lng=-84.3722), best_confidence=0.88, points=25, is_anomaly=False,
            ),
            s.RecapSpecies(
                species_code="carwre", common_name="Carolina Wren", sci_name="Thryothorus ludovicianus",
                family_com_name="Wrens", rarity_tier="common", heard=True, photographed=True,
                detection_count=7, first_detected_at=started + timedelta(minutes=3),
                location=s.LatLng(lat=33.7853, lng=-84.3736), best_confidence=0.93, points=20, is_anomaly=False,
            ),
            s.RecapSpecies(
                species_code="norcar", common_name="Northern Cardinal", sci_name="Cardinalis cardinalis",
                family_com_name="Cardinals, Grosbeaks, and Allies", rarity_tier="common", heard=True,
                photographed=False, detection_count=5, first_detected_at=started + timedelta(minutes=8),
                location=s.LatLng(lat=33.7880, lng=-84.3705), best_confidence=0.81, points=10, is_anomaly=False,
            ),
        ],
        photos=[],
        recap_text="A bright morning loop through Piedmont Park. A Carolina Wren kept you company from the first minute, "
                   "and a Pileated Woodpecker made an appearance near the lake.",
        quests_progressed=[s.QuestProgress(quest_id=str(uuid.uuid4()), title="Knock Knock", progress=1, target=3, completed=False)],
        bounties_claimed=[],
        bounties_created=[],
        chirp_count=4,
        comment_count=2,
        viewer_chirped=False,
    )


def bounties() -> list[s.NearbyBounty]:
    return [
        s.NearbyBounty(
            bounty_id=str(uuid.uuid4()), species_code="paibun", common_name="Painted Bunting",
            center=s.LatLng(lat=33.7702, lng=-84.3590), radius_m=300,
            expires_at=NOW + timedelta(days=5), claimed_by_me=False,
        )
    ]


def leaderboard() -> list[s.LeaderboardRow]:
    return [
        s.LeaderboardRow(rank=1, user=s.UserRef(id=str(uuid.uuid4()), username="wren_hunter", display_name="Wren Hunter"), points=640),
        s.LeaderboardRow(rank=2, user=DEMO_USER, points=415),
        s.LeaderboardRow(rank=3, user=s.UserRef(id=str(uuid.uuid4()), username="beltline_birds", display_name="BeltLine Birds"), points=290),
    ]
