import uuid
from datetime import datetime
from uuid import UUID

import psycopg
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile

from app import db
from app import schemas as s
from app import stubs
from app.audio.pipeline import ext_for, process_chunk, walk_tmp_dir
from app.auth import CurrentUser, get_current_user
from app.game.finish import run_finish

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


@router.post("/walks/{walk_id}/photos", response_model=s.PhotoCreated)
async def upload_photo(
    walk_id: str,
    file: UploadFile = File(...),
    captured_at: str = Form(...),
    lat: float = Form(...),
    lng: float = Form(...),
    user: CurrentUser = Depends(get_current_user),
):
    return s.PhotoCreated(photo_id=str(uuid.uuid4()))  # STUB (B: photo ID §7.8)


@router.post("/photos/{photo_id}/confirm", response_model=s.Ok)
async def confirm_photo(photo_id: str, body: s.PhotoConfirm, user: CurrentUser = Depends(get_current_user)):
    return s.Ok()  # STUB (B). If the walk is already complete, call app.game.finish.rescore_walk (§7.10).


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
async def get_walk(walk_id: str, user: CurrentUser = Depends(get_current_user)):
    return stubs.recap(walk_id)  # STUB (C: masking §7.9)
