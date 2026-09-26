"""Direct Postgres access (psycopg 3) for SQL the Supabase REST client handles badly: PostGIS, aggregates,
multi-statement transactions. Connects as the postgres role, so RLS does NOT apply; callers enforce access.

Usage:
    with db.connect() as conn:
        row = conn.execute("select ... where id = %s", (walk_id,)).fetchone()   # rows are dicts
Commits when the block exits cleanly, rolls back on exception.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.config import get_settings


@lru_cache
def pool() -> ConnectionPool:
    return ConnectionPool(
        get_settings().database_url,
        min_size=1,
        max_size=10,
        # prepare_threshold=None: prepared statements break behind Supabase's transaction pooler.
        kwargs={"row_factory": dict_row, "prepare_threshold": None},
        open=True,
    )


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    with pool().connection() as conn:
        yield conn
