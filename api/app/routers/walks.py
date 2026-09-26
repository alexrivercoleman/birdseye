import uuid

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app import schemas as s
from app import stubs
from app.auth import CurrentUser, get_current_user

router = APIRouter(tags=["walks"])


@router.post("/walks", response_model=s.WalkCreated)
async def create_walk(user: CurrentUser = Depends(get_current_user)):
    return s.WalkCreated(walk_id=str(uuid.uuid4()))  # STUB


@router.post("/walks/{walk_id}/track", response_model=s.Ok)
async def add_track(walk_id: str, body: s.TrackBatch, user: CurrentUser = Depends(get_current_user)):
    return s.Ok()  # STUB


@router.post("/walks/{walk_id}/chunks", response_model=s.ChunkCreated)
async def upload_chunk(
    walk_id: str,
    file: UploadFile = File(...),
    chunk_index: int = Form(...),
    started_at: str = Form(...),
    duration_s: float = Form(...),
    mime_type: str = Form(...),
    user: CurrentUser = Depends(get_current_user),
):
    return s.ChunkCreated(chunk_id=str(uuid.uuid4()))  # STUB (B: audio pipeline §7.2)


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
    return s.Ok()  # STUB


@router.post("/walks/{walk_id}/finish", response_model=s.FinishResponse)
async def finish_walk(walk_id: str, user: CurrentUser = Depends(get_current_user)):
    return s.FinishResponse()  # STUB (C: finish orchestrator §7.10)


@router.get("/walks/{walk_id}", response_model=s.Recap)
async def get_walk(walk_id: str, user: CurrentUser = Depends(get_current_user)):
    return stubs.recap(walk_id)  # STUB (C: masking §7.9)
