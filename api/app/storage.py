"""Supabase Storage via the service-role key. All buckets are private; clients get signed URLs."""

from functools import lru_cache

from supabase import Client, create_client

from app.config import get_settings

SIGNED_URL_TTL_S = 6 * 3600


@lru_cache
def client() -> Client:
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)


def upload(bucket: str, path: str, data: bytes, content_type: str) -> str:
    client().storage.from_(bucket).upload(path, data, {"content-type": content_type, "upsert": "true"})
    return path


def signed_url(bucket: str, path: str | None) -> str | None:
    if not path:
        return None
    return client().storage.from_(bucket).create_signed_url(path, SIGNED_URL_TTL_S)["signedURL"]
