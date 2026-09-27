"""Photo upload processing: vision identification followed by eBird re-ranking.

Photo suggestions come only from the image classifier and eBird validation.
Audio detections and the shared text LLM provider never supply photo suggestions.
"""

import logging
from datetime import datetime

from psycopg.types.json import Jsonb

from app import db, storage

log = logging.getLogger(__name__)

IMAGE_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif"}


def ext_for(mime: str) -> str:
    return IMAGE_EXT.get(mime.split(";")[0].strip().lower(), "jpg")


def process_photo(photo_id: str, image: bytes, mime: str) -> None:
    with db.connect() as conn:
        photo = conn.execute(
            "select id, storage_path, captured_at,"
            " ST_Y(geog::geometry) lat, ST_X(geog::geometry) lng from photos where id = %s", (photo_id,),
        ).fetchone()
    stored = True
    try:
        storage.upload("photos", photo["storage_path"], image, mime)
    except Exception:
        log.exception("photo %s: storage upload failed", photo_id)
        stored = False
    try:
        suggestions = _suggest(
            image, mime, lat=photo["lat"], lng=photo["lng"], captured_at=photo["captured_at"],
        )
    except Exception:
        log.exception("photo %s: identification failed", photo_id)
        suggestions = []
    with db.connect() as conn:
        # status guard: the user may already have confirmed / chosen "not sure" while this ran
        conn.execute(
            """
            update photos set suggestions = %s,
                   status = case when status = 'processing' then %s else status end,
                   storage_path = case when %s then storage_path end
             where id = %s
            """,
            (Jsonb(suggestions), "needs_confirmation" if suggestions else "unidentified", stored, photo_id),
        )


def _suggest(
    image: bytes, mime: str, *, lat: float | None = None,
    lng: float | None = None, captured_at: datetime | None = None,
) -> list[dict]:
    from app.photos.vision import identify

    return identify(image, mime, lat=lat, lng=lng, captured_at=captured_at)
