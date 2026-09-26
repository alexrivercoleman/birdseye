"""Supabase Storage via the service-role key. All buckets are private; clients get signed URLs."""

import logging
from functools import lru_cache

from supabase import Client, create_client

from app.config import get_settings

log = logging.getLogger(__name__)

SIGNED_URL_TTL_S = 6 * 3600


@lru_cache
def client() -> Client:
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)


def upload(bucket: str, path: str, data: bytes, content_type: str) -> str:
    client().storage.from_(bucket).upload(path, data, {"content-type": content_type, "upsert": "true"})
    return path


def download(bucket: str, path: str) -> bytes:
    return client().storage.from_(bucket).download(path)


def signed_url(bucket: str, path: str | None) -> str | None:
    if not path:
        return None
    try:
        return client().storage.from_(bucket).create_signed_url(path, SIGNED_URL_TTL_S)["signedURL"]
    except Exception:
        log.exception("signed url failed for %s/%s", bucket, path)
        return None


def signed_urls(bucket: str, paths: list[str | None]) -> dict[str, str]:
    """One request for many files. Missing files are left out of the result."""
    wanted = sorted({p for p in paths if p})
    if not wanted:
        return {}
    try:
        items = client().storage.from_(bucket).create_signed_urls(wanted, SIGNED_URL_TTL_S)
    except Exception:
        log.exception("signed urls failed for %s", bucket)
        return {}
    return {i["path"]: i["signedURL"] for i in items if not i.get("error") and i.get("signedURL")}
