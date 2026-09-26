from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app import db, stubs
from app import schemas as s
from app.auth import CurrentUser, get_current_user
from app.game import quests

router = APIRouter(tags=["game"])


def _quest(row: dict) -> s.UserQuest:
    return s.UserQuest(**row | {"id": str(row["id"])})


@router.get("/quests/me", response_model=list[s.UserQuest])
def my_quests(user: CurrentUser = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    with db.connect() as conn:
        quests.ensure_weekly(conn, user.id, now)
        quests.refresh_progress(conn, user.id, now)
        return [_quest(r) for r in quests.open_quests(conn, user.id, now)]


@router.get("/quests/nests", response_model=s.NestStatus)
def my_nests(user: CurrentUser = Depends(get_current_user)):
    with db.connect() as conn:
        return quests.nest_status(conn, user.id, datetime.now(timezone.utc))


@router.post("/quests/nests/hatch", response_model=s.NestHatched)
def hatch_nest(user: CurrentUser = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    with db.connect() as conn:
        err = quests.hatch(conn, user.id, now)
        if err:
            raise HTTPException(409, err)
        return s.NestHatched(points_awarded=quests.NEST_HATCH_POINTS, nests=quests.nest_status(conn, user.id, now))


@router.post("/quests/{quest_id}/claim", response_model=s.QuestClaimed)
def claim_quest(quest_id: UUID, user: CurrentUser = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    with db.connect() as conn:
        q = conn.execute(
            "select id, reward_points, completed_at, claimed_at from user_quests"
            " where id = %s and user_id = %s for update",
            (quest_id, user.id),
        ).fetchone()
        if not q:
            raise HTTPException(404, "Quest not found")
        if q["claimed_at"]:
            raise HTTPException(409, "Already claimed")
        if not q["completed_at"]:
            raise HTTPException(409, "Quest isn't complete yet")
        egg = quests.claim(conn, user.id, q, now)
        return s.QuestClaimed(points_awarded=q["reward_points"], egg_laid=egg,
                              nests=quests.nest_status(conn, user.id, now))


@router.get("/bounties/nearby", response_model=list[s.NearbyBounty])
async def nearby_bounties(lat: float, lng: float, user: CurrentUser = Depends(get_current_user)):
    return stubs.bounties()  # STUB (C: §7.6)


@router.get("/leaderboards", response_model=list[s.LeaderboardRow])
async def leaderboards(
    scope: Literal["local", "friends"] = "local",
    lat: float | None = None,
    lng: float | None = None,
    user: CurrentUser = Depends(get_current_user),
):
    return stubs.leaderboard()  # STUB
