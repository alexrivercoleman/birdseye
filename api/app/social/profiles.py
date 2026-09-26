"""GET /users/search and GET /users/{username} (§6). Follows themselves go straight to Supabase from the client."""

import psycopg

from app import schemas as s
from app.social.recap import build_recap

SEARCH_LIMIT = 20
RECENT_WALKS = 10


def _like_prefix(q: str) -> str:
    """q as a LIKE prefix pattern, with LIKE's wildcards escaped (underscores are common in usernames)."""
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def search_users(conn: psycopg.Connection, viewer_id: str, q: str) -> list[s.UserSearchResult]:
    """Username prefix, or the start of any word of the display name. Username matches rank first."""
    pat = _like_prefix(q.strip().lower())
    rows = conn.execute(
        """
        select p.id, p.username, p.display_name, p.avatar_url, p.xp,
               exists (select 1 from follows f where f.follower_id = %(v)s and f.followee_id = p.id) as is_following
          from profiles p
         where p.id <> %(v)s
           and (p.username like %(pat)s or lower(p.display_name) like %(pat)s or lower(p.display_name) like '%% ' || %(pat)s)
         order by (p.username like %(pat)s) desc, p.username
         limit %(n)s
        """,
        {"v": viewer_id, "pat": pat, "n": SEARCH_LIMIT},
    ).fetchall()
    return [s.UserSearchResult(**r | {"id": str(r["id"])}) for r in rows]


def get_profile(conn: psycopg.Connection, viewer_id: str, username: str) -> s.UserProfile | None:
    p = conn.execute(
        """
        select p.id, p.username, p.display_name, p.avatar_url, p.xp, p.bio,
               (select count(*) from follows where followee_id = p.id) as follower_count,
               (select count(*) from follows where follower_id = p.id) as following_count,
               exists (select 1 from follows where follower_id = %(v)s and followee_id = p.id) as is_following,
               are_friends(p.id, %(v)s) as is_friend,
               (select count(*) from walks where user_id = p.id and status = 'complete') as walk_count,
               (select count(distinct ws.species_code)
                  from walk_species ws join walks w on w.id = ws.walk_id
                 where w.user_id = p.id and w.status = 'complete' and (not ws.is_anomaly or ws.photographed)
               ) as life_list_count
          from profiles p
         where p.username = %(u)s
        """,
        {"v": viewer_id, "u": username.lower()},
    ).fetchone()
    if not p:
        return None

    # Same rule as the feed: completed walks, plus the viewer's own walks still processing.
    walk_ids = conn.execute(
        """
        select id from walks
         where user_id = %(p)s and ended_at is not null
           and (status = 'complete' or (status = 'processing' and user_id = %(v)s))
         order by ended_at desc
         limit %(n)s
        """,
        {"p": p["id"], "v": viewer_id, "n": RECENT_WALKS},
    ).fetchall()
    walks = [r for r in (build_recap(conn, str(w["id"]), viewer_id, summary=True) for w in walk_ids) if r]

    return s.UserProfile(
        user=s.UserRef(id=str(p["id"]), username=p["username"], display_name=p["display_name"],
                       avatar_url=p["avatar_url"], xp=p["xp"]),
        bio=p["bio"],
        walk_count=p["walk_count"],
        life_list_count=p["life_list_count"],
        follower_count=p["follower_count"],
        following_count=p["following_count"],
        is_following=p["is_following"],
        is_friend=p["is_friend"],
        recent_walks=walks,
    )
