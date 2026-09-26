"""Photo upload processing (§7.8). process_photo runs as a BackgroundTask per uploaded photo.

Vision ID is P2. Until app.photos.vision exists, suggestions are the species heard so far on this walk
(confidence null), so the confirm sheet already works. Workstream B hook:
    app.photos.vision.identify(walk_id: str, image: bytes, mime: str) -> list[dict]
        top 3 [{species_code, common_name, confidence}] or [] if no bird is clearly visible.
"""

import logging

from psycopg.types.json import Jsonb

from app import db, storage

log = logging.getLogger(__name__)

IMAGE_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif"}


def ext_for(mime: str) -> str:
    return IMAGE_EXT.get(mime.split(";")[0].strip().lower(), "jpg")


def process_photo(photo_id: str, image: bytes, mime: str) -> None:
    with db.connect() as conn:
        photo = conn.execute("select id, walk_id, storage_path from photos where id = %s", (photo_id,)).fetchone()
    walk_id = str(photo["walk_id"])
    stored = True
    try:
        storage.upload("photos", photo["storage_path"], image, mime)
    except Exception:
        log.exception("photo %s: storage upload failed", photo_id)
        stored = False
    try:
        suggestions = _suggest(walk_id, image, mime)
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


def _suggest(walk_id: str, image: bytes, mime: str) -> list[dict]:
    try:
        from app.photos.vision import identify  # Workstream B (P2)
    except ImportError:
        pass
    else:
        return identify(walk_id, image, mime)
    with db.connect() as conn:
        rows = conn.execute(
            "select species_code, min(common_name) common_name from detections where walk_id = %s"
            " group by species_code order by max(confidence) desc limit 3",
            (walk_id,),
        ).fetchall()
    return [{"species_code": r["species_code"], "common_name": r["common_name"], "confidence": None} for r in rows]
