"""Photo upload processing: vision identification followed by eBird re-ranking.

With OpenAI configured, use the photo's own location/date for identification and
validation. Otherwise retain the heard-on-this-walk suggestions for demos.
"""

import logging
from datetime import datetime

from psycopg.types.json import Jsonb

from app import db, storage
from app.config import get_settings

log = logging.getLogger(__name__)

IMAGE_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif"}


def ext_for(mime: str) -> str:
    return IMAGE_EXT.get(mime.split(";")[0].strip().lower(), "jpg")


def process_photo(photo_id: str, image: bytes, mime: str) -> None:
    with db.connect() as conn:
        photo = conn.execute(
            "select id, walk_id, storage_path, captured_at,"
            " ST_Y(geog::geometry) lat, ST_X(geog::geometry) lng from photos where id = %s", (photo_id,),
        ).fetchone()
    walk_id = str(photo["walk_id"])
    stored = True
    try:
        storage.upload("photos", photo["storage_path"], image, mime)
    except Exception:
        log.exception("photo %s: storage upload failed", photo_id)
        stored = False
    try:
        suggestions = _suggest(
            walk_id, image, mime, lat=photo["lat"], lng=photo["lng"], captured_at=photo["captured_at"],
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
    walk_id: str, image: bytes, mime: str, *, lat: float | None = None,
    lng: float | None = None, captured_at: datetime | None = None,
) -> list[dict]:
    settings = get_settings()
    if settings.llm_provider == "openai" and settings.openai_api_key and settings.openai_vision_model:
        from app.photos.vision import identify
        return identify(image, mime, lat=lat, lng=lng, captured_at=captured_at)
    with db.connect() as conn:
        rows = conn.execute(
            "select species_code, min(common_name) common_name from detections where walk_id = %s"
            " group by species_code order by max(confidence) desc limit 3",
            (walk_id,),
        ).fetchall()
    return [{"species_code": r["species_code"], "common_name": r["common_name"], "confidence": None} for r in rows]
