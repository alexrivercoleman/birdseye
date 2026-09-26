from typing import Literal

from fastapi import APIRouter, Depends

from app import schemas as s
from app import stubs
from app.auth import CurrentUser, get_current_user

router = APIRouter(tags=["game"])


@router.get("/quests/me", response_model=list[s.UserQuest])
async def my_quests(user: CurrentUser = Depends(get_current_user)):
    return stubs.quests()  # STUB (C: §7.7)


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
