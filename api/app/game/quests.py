"""Quests (§7.7, Pokémon GO field-research style) and monthly nests.

For now every user gets the same three example quests each local week (Monday to Monday); LLM/eBird-driven
generation can replace WEEKLY_QUESTS later. Progress counts the user's complete walks started inside the quest's
week. A quest pays out only when claimed; the first claim of a week lays an egg in the next of 5 monthly nests.

Local time uses the longitude offset from scoring.local_day_bounds (profile's last_lng, else the default).
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import psycopg
from psycopg.types.json import Jsonb

from app.config import get_settings

NEST_COUNT = 5
TRAIL_BUFFER_M = 40      # a track point this close to a trail is "on" it
NO_TRAIL_DATA_M = 1000   # no cached trail within this distance → no data for the area, so count the distance

WEEKLY_QUESTS = [
    # trail_distance target/progress are meters; the client shows miles
    {"template": "trail_distance", "params": {"miles": 5}, "title": "Walk 5 miles on a nature trail",
     "target": 8047, "reward_points": 150},
    {"template": "discover_family", "params": {"family_com_name": "Woodpeckers", "n": 3},
     "title": "Discover 3 species of woodpecker", "target": 3, "reward_points": 100},
    {"template": "photo_species", "params": {"species_code": "brnthr", "common_name": "Brown Thrasher"},
     "title": "Photograph a Brown Thrasher", "target": 1, "reward_points": 75},
]

QUEST_COLUMNS = ("id, template, params, title, flavor_text, target, progress, reward_points,"
                 " starts_at, ends_at, completed_at, claimed_at")


@dataclass(frozen=True)
class LocalWeek:
    start: datetime   # UTC instant of local Monday 00:00
    end: datetime
    week_start: date  # local Monday
    month: date       # local first of the month containing `now`


def local_week(now: datetime, lng: float | None) -> LocalWeek:
    offset = timedelta(hours=round((lng or 0) / 15))
    local = now.astimezone(timezone.utc) + offset
    monday = (local - timedelta(days=local.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    start = monday - offset
    return LocalWeek(start, start + timedelta(days=7), monday.date(), local.date().replace(day=1))


def _user_week(conn: psycopg.Connection, user_id: str, now: datetime) -> LocalWeek:
    row = conn.execute("select last_lng from profiles where id = %s", (user_id,)).fetchone()
    lng = row["last_lng"] if row and row["last_lng"] is not None else get_settings().default_lng
    return local_week(now, lng)


def ensure_weekly(conn: psycopg.Connection, user_id: str, now: datetime) -> None:
    week = _user_week(conn, user_id, now)
    with conn.cursor() as cur:
        cur.executemany(
            """
            insert into user_quests (user_id, template, params, title, target, reward_points, starts_at, ends_at)
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (user_id, template, starts_at) do nothing
            """,
            [(user_id, q["template"], Jsonb(q["params"]), q["title"], q["target"], q["reward_points"],
              week.start, week.end) for q in WEEKLY_QUESTS],
        )


def refresh_progress(conn: psycopg.Connection, user_id: str, now: datetime) -> None:
    """Recompute progress of the user's open quests from their walks; stamp completed_at on reaching target."""
    quests = conn.execute(
        "select id, template, params, target, starts_at, ends_at from user_quests"
        " where user_id = %s and completed_at is null and ends_at > %s",
        (user_id, now),
    ).fetchall()
    for q in quests:
        progress = _progress(conn, user_id, q)
        if progress is None:
            continue  # template without an evaluator yet
        conn.execute(
            "update user_quests set progress = %(p)s,"
            " completed_at = case when %(p)s >= target then now() else null end where id = %(id)s",
            {"p": min(progress, q["target"]), "id": q["id"]},
        )


def _progress(conn: psycopg.Connection, user_id: str, q: dict) -> int | None:
    args = {"u": user_id, "s": q["starts_at"], "e": q["ends_at"], **q["params"]}
    walks = "w.user_id = %(u)s and w.status = 'complete' and w.started_at >= %(s)s and w.started_at < %(e)s"
    if q["template"] == "discover_family":
        sql = f"""
            select count(distinct ws.species_code) as n from walk_species ws join walks w on w.id = ws.walk_id
             where {walks} and ws.family_com_name = %(family_com_name)s
        """
    elif q["template"] == "photo_species":
        sql = f"""
            select count(*) > 0 as n from walk_species ws join walks w on w.id = ws.walk_id
             where {walks} and ws.species_code = %(species_code)s and ws.photographed
        """
    elif q["template"] == "trail_distance":
        # track segments whose end point is on a trail (or in an area with no cached trails yet)
        sql = f"""
            with seg as (
                select tp.geog,
                       lag(tp.geog) over (partition by tp.walk_id order by tp.recorded_at) as prev
                  from track_points tp join walks w on w.id = tp.walk_id
                 where {walks}
            )
            select coalesce(sum(ST_Distance(prev, geog)), 0)::int as n from seg
             where prev is not null
               and (exists (select 1 from trails t where ST_DWithin(t.geom, seg.geog, {TRAIL_BUFFER_M}))
                    or not exists (select 1 from trails t where ST_DWithin(t.geom, seg.geog, {NO_TRAIL_DATA_M})))
        """
    else:
        return None
    return int(conn.execute(sql, args).fetchone()["n"])


def open_quests(conn: psycopg.Connection, user_id: str, now: datetime) -> list[dict]:
    """Unclaimed quests that are still running, plus completed ones waiting to be claimed."""
    return conn.execute(
        f"select {QUEST_COLUMNS} from user_quests where user_id = %s and claimed_at is null"
        " and (completed_at is not null or ends_at > %s) order by starts_at, created_at",
        (user_id, now),
    ).fetchall()


def nest_status(conn: psycopg.Connection, user_id: str, now: datetime) -> dict:
    week = _user_week(conn, user_id, now)
    row = conn.execute(
        "select count(*) filter (where month = %(m)s) as filled, bool_or(week_start = %(w)s) as this_week"
        " from quest_nests where user_id = %(u)s",
        {"u": user_id, "m": week.month, "w": week.week_start},
    ).fetchone()
    return {"month": week.month.strftime("%Y-%m"), "total": NEST_COUNT, "filled": min(row["filled"], NEST_COUNT),
            "laid_this_week": bool(row["this_week"])}


def claim(conn: psycopg.Connection, user_id: str, quest: dict, now: datetime) -> bool:
    """Pays out a completed, unclaimed quest (caller checks) and lays this week's egg if there's room.
    Returns whether an egg was laid."""
    conn.execute("update user_quests set claimed_at = %s where id = %s", (now, quest["id"]))
    conn.execute(
        """
        insert into points_ledger (user_id, amount, reason, ref_id, geog)
        select p.id, %s, 'quest_complete', %s,
               case when p.last_lng is not null
                    then ST_SetSRID(ST_MakePoint(p.last_lng, p.last_lat), 4326)::geography end
          from profiles p where p.id = %s
        """,
        (quest["reward_points"], quest["id"], user_id),
    )
    week = _user_week(conn, user_id, now)
    filled = conn.execute(
        "select count(*) as n from quest_nests where user_id = %s and month = %s", (user_id, week.month)
    ).fetchone()["n"]
    if filled >= NEST_COUNT:
        return False
    row = conn.execute(
        "insert into quest_nests (user_id, week_start, month, quest_id) values (%s, %s, %s, %s)"
        " on conflict (user_id, week_start) do nothing returning week_start",
        (user_id, week.week_start, week.month, quest["id"]),
    ).fetchone()
    return row is not None
