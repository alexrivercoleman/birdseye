"""Response/request shapes from BIRDSEYE_SPEC.md §6. Changing these = contract change."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

Tier = Literal["common", "uncommon", "rare"]


class LatLng(BaseModel):
    lat: float
    lng: float


class UserRef(BaseModel):
    id: str
    username: str
    display_name: str | None = None
    avatar_url: str | None = None


# ---- Walk lifecycle -------------------------------------------------------

class WalkCreated(BaseModel):
    walk_id: str


class TrackPoint(BaseModel):
    t: datetime
    lat: float
    lng: float
    accuracy_m: float | None = None


class TrackBatch(BaseModel):
    points: list[TrackPoint]


class Ok(BaseModel):
    ok: bool = True


class ChunkCreated(BaseModel):
    chunk_id: str


class PhotoCreated(BaseModel):
    photo_id: str


class PhotoConfirm(BaseModel):
    species_code: str | None


class PhotoSuggestion(BaseModel):
    species_code: str
    common_name: str
    confidence: float | None = None


class PhotoDetail(BaseModel):
    """GET /photos/{photo_id} (owner only). Added 2026-09-25, see docs/CONTRACT_CHANGES.md."""
    photo_id: str
    status: Literal["processing", "needs_confirmation", "confirmed", "unidentified"]
    species_code: str | None = None
    suggestions: list[PhotoSuggestion]
    url: str | None = None


class FinishResponse(BaseModel):
    status: Literal["processing"] = "processing"


# ---- Recap ----------------------------------------------------------------

class RecapSpecies(BaseModel):
    species_code: str
    common_name: str
    sci_name: str | None = None
    family_com_name: str | None = None
    rarity_tier: Tier
    heard: bool
    photographed: bool
    detection_count: int
    first_detected_at: datetime | None = None
    location: LatLng | None = None  # null if !precise
    best_confidence: float | None = None
    clip_url: str | None = None
    spectrogram_url: str | None = None
    photo_url: str | None = None
    points: int
    is_anomaly: bool


class RecapPhoto(BaseModel):
    photo_id: str
    url: str | None = None
    species_code: str | None = None
    status: Literal["processing", "needs_confirmation", "confirmed", "unidentified"]
    location: LatLng | None = None


class QuestProgress(BaseModel):
    quest_id: str
    title: str
    progress: int
    target: int
    completed: bool


class BountyClaimed(BaseModel):
    bounty_id: str
    common_name: str
    points: int


class BountyCreated(BaseModel):
    bounty_id: str
    common_name: str


class Recap(BaseModel):
    walk_id: str
    user: UserRef
    status: Literal["active", "processing", "complete"]
    started_at: datetime
    ended_at: datetime | None = None
    distance_m: float | None = None
    duration_s: int | None = None
    species_count: int
    points: int
    precise: bool
    public_area_label: str | None = None
    route: list[list[float]] | None = None  # [[lng, lat], ...]; null if !precise
    static_map_url: str | None = None
    species: list[RecapSpecies]
    photos: list[RecapPhoto]
    recap_text: str | None = None
    quests_progressed: list[QuestProgress]
    bounties_claimed: list[BountyClaimed]
    bounties_created: list[BountyCreated]
    chirp_count: int
    comment_count: int
    viewer_chirped: bool


# RecapSummary = Recap minus species[].clip_url/spectrogram_url and photos beyond first 3; route thinned to ≤ 80 points.
RecapSummary = Recap


# ---- Social ---------------------------------------------------------------

class FeedPage(BaseModel):
    items: list[RecapSummary]
    next_cursor: str | None = None


class UserSearchResult(UserRef):
    is_following: bool


class UserProfile(BaseModel):
    user: UserRef
    follower_count: int
    following_count: int
    is_following: bool
    is_friend: bool
    recent_walks: list[RecapSummary]


# ---- Game -----------------------------------------------------------------

class UserQuest(BaseModel):
    id: str
    template: Literal["hear_family", "photo_family", "species_in_walk", "dawn_chorus", "tier_hunt", "distance_species"]
    params: dict[str, Any]
    title: str
    flavor_text: str | None = None
    target: int
    progress: int
    reward_points: int
    starts_at: datetime
    ends_at: datetime
    completed_at: datetime | None = None


class NearbyBounty(BaseModel):
    bounty_id: str
    species_code: str
    common_name: str
    center: LatLng
    radius_m: int
    expires_at: datetime
    claimed_by_me: bool


class LeaderboardRow(BaseModel):
    rank: int
    user: UserRef
    points: int


# ---- Community map --------------------------------------------------------

class MapTrail(BaseModel):
    trail_id: str
    name: str | None = None
    geometry: dict[str, Any]  # GeoJSON LineString
    species_total: int


class MapAnomaly(BaseModel):
    species_code: str
    common_name: str
    center: LatLng
    radius_m: int
    detected_at: datetime
    reason: str | None = None
    photo_confirmed: bool


class HeatPoint(BaseModel):
    lat: float
    lng: float
    weight: int


class CommunityMap(BaseModel):
    trails: list[MapTrail]
    bounties: list[NearbyBounty]
    anomalies: list[MapAnomaly]
    heat: list[HeatPoint]


class TrailTopSpecies(BaseModel):
    species_code: str
    common_name: str
    rarity_tier: Tier
    walks: int
    users: int
    last_heard_at: datetime | None = None


class TrailSpecies(BaseModel):
    name: str | None = None
    top_species: list[TrailTopSpecies]
