from fastapi import APIRouter, Depends, Query

from app import schemas as s
from app import stubs
from app.auth import CurrentUser, get_current_user

router = APIRouter(tags=["social"])


@router.get("/feed", response_model=s.FeedPage)
async def feed(cursor: str | None = None, user: CurrentUser = Depends(get_current_user)):
    return s.FeedPage(items=[stubs.recap()], next_cursor=None)  # STUB


# Declared before /users/{username} so "search" isn't captured as a username.
@router.get("/users/search", response_model=list[s.UserSearchResult])
async def search_users(q: str = Query(..., min_length=1), user: CurrentUser = Depends(get_current_user)):
    return [s.UserSearchResult(**stubs.DEMO_USER.model_dump(), is_following=False)]  # STUB


@router.get("/users/{username}", response_model=s.UserProfile)
async def get_user(username: str, user: CurrentUser = Depends(get_current_user)):
    return s.UserProfile(  # STUB
        user=stubs.DEMO_USER, follower_count=12, following_count=9,
        is_following=True, is_friend=True, recent_walks=[stubs.recap()],
    )
