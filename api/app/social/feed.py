"""GET /feed: every user's finished walks, newest first, plus the viewer's own walks that are still processing
(so a just-finished walk shows up right away). Each item is a RecapSummary, masked per viewer (§7.9).

Cursor = "<ended_at ISO>|<walk_id>" of the last item (keyset pagination on ended_at desc, id desc).
"""

from datetime import datetime
from uuid import UUID

import psycopg

from app import schemas as s
from app.social.recap import build_recap

PAGE_SIZE = 10


def parse_cursor(cursor: str) -> tuple[datetime, UUID]:
    """Raises ValueError on a malformed cursor."""
    ended_at, walk_id = cursor.split("|", 1)
    return datetime.fromisoformat(ended_at), UUID(walk_id)


def build_feed(conn: psycopg.Connection, viewer_id: str, cursor: tuple[datetime, UUID] | None) -> s.FeedPage:
    where = "w.ended_at is not null and (w.status = 'complete' or (w.status = 'processing' and w.user_id = %(v)s))"
    params: dict = {"v": viewer_id, "n": PAGE_SIZE + 1}
    if cursor:
        where += " and (w.ended_at, w.id) < (%(c_at)s, %(c_id)s)"
        params |= {"c_at": cursor[0], "c_id": cursor[1]}
    rows = conn.execute(
        f"select w.id, w.ended_at from walks w where {where} order by w.ended_at desc, w.id desc limit %(n)s",
        params,
    ).fetchall()

    page, more = rows[:PAGE_SIZE], len(rows) > PAGE_SIZE
    items = [r for r in (build_recap(conn, str(row["id"]), viewer_id, summary=True) for row in page) if r]
    next_cursor = f"{page[-1]['ended_at'].isoformat()}|{page[-1]['id']}" if more else None
    return s.FeedPage(items=items, next_cursor=next_cursor)
