import uuid
from datetime import datetime
from uuid import UUID

import psycopg
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile

from app import db, storage
from app import schemas as s
from app.audio.pipeline import ext_for, process_chunk, walk_tmp_dir
from app.auth import CurrentUser, get_current_user
from app.game.finish import rescore_walk, run_finish
from app.llm.species_summary import fill_missing_summaries
from app.photos.pipeline import ext_for as photo_ext_for
from app.photos.pipeline import process_photo
from app.social.recap import build_recap

router = APIRouter(tags=["walks"])

# Endpoints that hit Postgres are plain `def`: FastAPI runs them in a threadpool, so the sync driver
# doesn't block the event loop.


def _require_owner(conn: psycopg.Connection, walk_id: UUID, user: CurrentUser) -> dict:
    walk = conn.execute("select id, status from walks where id = %s and user_id = %s", (walk_id, user.id)).fetchone()
    if not walk:
        raise HTTPException(404, "Walk not found")
    return walk


@router.post("/walks", response_model=s.WalkCreated)
def create_walk(user: CurrentUser = Depends(get_current_user)):
    try:
        with db.connect() as conn:
            row = conn.execute("insert into walks (user_id) values (%s) returning id", (user.id,)).fetchone()
    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(409, "Create a profile (pick a username) before starting a walk") from None
    return s.WalkCreated(walk_id=str(row["id"]))


@router.post("/walks/{walk_id}/track", response_model=s.Ok)
def add_track(walk_id: UUID, body: s.TrackBatch, user: CurrentUser = Depends(get_current_user)):
    with db.connect() as conn:
        _require_owner(conn, walk_id, user)
        with conn.cursor() as cur:
            cur.executemany(
                "insert into track_points (walk_id, recorded_at, geog, accuracy_m)"
                " values (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s)",
                [(walk_id, p.t, p.lng, p.lat, p.accuracy_m) for p in body.points],
            )
    return s.Ok()


@router.post("/walks/{walk_id}/chunks", response_model=s.ChunkCreated)
def upload_chunk(
    walk_id: UUID,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    chunk_index: int = Form(...),
    started_at: datetime = Form(...),
    duration_s: float = Form(...),
    mime_type: str = Form(...),
    user: CurrentUser = Depends(get_current_user),
):
    with db.connect() as conn:
        _require_owner(conn, walk_id, user)
    # Write the file before inserting the row, so a row never exists without audio (finish waits on it).
    ext = ext_for(mime_type)
    tmp = walk_tmp_dir(str(walk_id))
    tmp.mkdir(parents=True, exist_ok=True)
    raw = tmp / f"{chunk_index}.upload.{ext}"
    raw.write_bytes(file.file.read())
    with db.connect() as conn:
        row = conn.execute(
            "insert into audio_chunks (walk_id, chunk_index, started_at, duration_s, storage_path)"
            " values (%s, %s, %s, %s, %s) on conflict (walk_id, chunk_index) do nothing returning id",
            (walk_id, chunk_index, started_at, duration_s, f"{walk_id}/{chunk_index}.{ext}"),
        ).fetchone()
        if not row:  # client upload-queue retry of a chunk we already have
            raw.unlink(missing_ok=True)
            existing = conn.execute(
                "select id from audio_chunks where walk_id = %s and chunk_index = %s", (walk_id, chunk_index)
            ).fetchone()
            return s.ChunkCreated(chunk_id=str(existing["id"]))
    background.add_task(process_chunk, str(row["id"]), str(raw), mime_type)
    return s.ChunkCreated(chunk_id=str(row["id"]))


@router.get("/walks/{walk_id}/seen", response_model=list[s.SeenSpecies])
def birds_seen(walk_id: UUID, user: CurrentUser = Depends(get_current_user)):
    """Read saved sightings through the API; photos has no browser SELECT policy."""
    with db.connect() as conn:
        _require_owner(conn, walk_id, user)
        rows = conn.execute(
            "select p.species_code code, coalesce(t.common_name, p.species_code) name, count(*) count"
            " from photos p left join ebird_taxonomy t on t.species_code = p.species_code"
            " where p.walk_id = %s and p.status = 'confirmed' and p.species_code is not null"
            " group by p.species_code, t.common_name order by name",
            (walk_id,),
        ).fetchall()
    return [s.SeenSpecies(**row) for row in rows]


@router.post("/walks/{walk_id}/photos", response_model=s.PhotoCreated)
def upload_photo(
    walk_id: UUID,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    captured_at: datetime = Form(...),
    lat: float = Form(...),
    lng: float = Form(...),
    user: CurrentUser = Depends(get_current_user),
):
    mime = file.content_type or "image/jpeg"
    photo_id = uuid.uuid4()
    image = file.file.read()
    with db.connect() as conn:
        _require_owner(conn, walk_id, user)
        conn.execute(
            "insert into photos (id, walk_id, captured_at, geog, storage_path)"
            " values (%s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s)",
            (photo_id, walk_id, captured_at, lng, lat, f"{walk_id}/{photo_id}.{photo_ext_for(mime)}"),
        )
    background.add_task(process_photo, str(photo_id), image, mime)
    return s.PhotoCreated(photo_id=str(photo_id))


def _require_photo_owner(conn: psycopg.Connection, photo_id: UUID, user: CurrentUser) -> dict:
    photo = conn.execute(
        "select p.id, p.walk_id, p.status, p.species_code, p.suggestions, p.storage_path, w.status walk_status"
        " from photos p join walks w on w.id = p.walk_id where p.id = %s and w.user_id = %s",
        (photo_id, user.id),
    ).fetchone()
    if not photo:
        raise HTTPException(404, "Photo not found")
    return photo


@router.get("/photos/{photo_id}", response_model=s.PhotoDetail)
def get_photo(photo_id: UUID, user: CurrentUser = Depends(get_current_user)):
    """Suggestions for the confirm sheet. Poll until status leaves "processing"."""
    with db.connect() as conn:
        p = _require_photo_owner(conn, photo_id, user)
    return s.PhotoDetail(
        photo_id=str(p["id"]), status=p["status"], species_code=p["species_code"],
        suggestions=p["suggestions"], url=storage.signed_url("photos", p["storage_path"]),
    )


@router.post("/photos/{photo_id}/confirm", response_model=s.Ok)
def confirm_photo(
    photo_id: UUID, body: s.PhotoConfirm, background: BackgroundTasks, user: CurrentUser = Depends(get_current_user)
):
    with db.connect() as conn:
        p = _require_photo_owner(conn, photo_id, user)
        if body.species_code and not conn.execute(
            "select 1 from ebird_taxonomy where species_code = %s", (body.species_code,)
        ).fetchone():
            raise HTTPException(422, f"Unknown species_code {body.species_code!r}")
        conn.execute(
            "update photos set species_code = %s, status = %s where id = %s",
            (body.species_code, "confirmed" if body.species_code else "unidentified", photo_id),
        )
    if p["walk_status"] == "complete":  # confirmed after finish → recompute this walk (§7.10)
        background.add_task(rescore_walk, str(p["walk_id"]))
    return s.Ok()


@router.post("/walks/{walk_id}/finish", response_model=s.FinishResponse)
def finish_walk(walk_id: UUID, background: BackgroundTasks, user: CurrentUser = Depends(get_current_user)):
    with db.connect() as conn:
        _require_owner(conn, walk_id, user)
        started = conn.execute(
            "update walks set status = 'processing', ended_at = now() where id = %s and status = 'active' returning id",
            (walk_id,),
        ).fetchone()
    if started:  # repeat calls while processing/complete are no-ops; the client polls GET /walks/{id}
        background.add_task(run_finish, str(walk_id))
    return s.FinishResponse()


@router.get("/walks/{walk_id}", response_model=s.Recap)
def get_walk(walk_id: UUID, background: BackgroundTasks, user: CurrentUser = Depends(get_current_user)):
    with db.connect() as conn:
        recap = build_recap(conn, str(walk_id), user.id)
    if not recap:
        raise HTTPException(404, "Walk not found")
    if recap.status == "complete" and any(sp.summary is None for sp in recap.species):
        background.add_task(fill_missing_summaries, str(walk_id))
    return recap
