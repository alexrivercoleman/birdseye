from fastapi import APIRouter, Depends, HTTPException, Query

from app import db
from app import schemas as s
from app.auth import CurrentUser, get_current_user
from app.social.feed import build_feed, parse_cursor
from app.social.profiles import get_profile, search_users

router = APIRouter(tags=["social"])


@router.get("/feed", response_model=s.FeedPage)
def feed(cursor: str | None = None, user: CurrentUser = Depends(get_current_user)):
    try:
        after = parse_cursor(cursor) if cursor else None
    except ValueError:
        raise HTTPException(422, "Malformed cursor") from None
    with db.connect() as conn:
        return build_feed(conn, user.id, after)


# Declared before /users/{username} so "search" isn't captured as a username.
@router.get("/users/search", response_model=list[s.UserSearchResult])
def search(q: str = Query(..., min_length=1, max_length=40), user: CurrentUser = Depends(get_current_user)):
    with db.connect() as conn:
        return search_users(conn, user.id, q)


@router.get("/users/{username}", response_model=s.UserProfile)
def get_user(username: str, user: CurrentUser = Depends(get_current_user)):
    with db.connect() as conn:
        profile = get_profile(conn, user.id, username)
    if not profile:
        raise HTTPException(404, "No such user")
    return profile
