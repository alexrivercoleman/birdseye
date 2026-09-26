# Birdseye — Hackathon Build Spec

> **Strava for birding.** Go on a walk, your phone listens, AI identifies every bird you hear, and you get a recap with a map, photos, points, quests, and bounties to share with friends.

---

## 0. Instructions for Claude Code (read first)

- This spec is shared by **three engineers working in parallel**, each running their own Claude Code session on a separate workstream (see §10). Before doing anything, ask which workstream (A, B, or C) you are working on if it hasn't been stated.
- **§5 (Data Model) and §6 (API Contract) are the source of truth.** Other workstreams are building against them at the same time. Do not change a table, column, endpoint, request shape, or response shape without explicitly telling the engineer, so they can tell the rest of the team. If a change is needed, add a note to `docs/CONTRACT_CHANGES.md` describing it.
- Stay inside your workstream's directories (§4). If you need something from another workstream that doesn't exist yet, build against the contract with a mock/stub rather than implementing their part.
- This is a **36-hour hackathon**. Prefer the simplest thing that works and demos well. No premature abstraction, no exhaustive test suites. Do write a few smoke tests for the scoring logic and the audio pipeline, since those are easy to break silently.
- Where this spec says **"verify"**, the exact API details (third-party endpoints, library function signatures) come from memory and must be checked against current docs before relying on them.
- Features are prioritized P0–P3 (§9). Never start P2/P3 work while P0 is broken.

---

## 1. Product summary

**Target tracks:**
- **Meta — "Build the AI-powered social product you wish existed."** AI is core to the experience: audio bird ID, vision photo ID, AI-written walk recaps, AI-generated quests. Use Meta's Llama model API as the primary LLM.
- **AI/ML track — "Surface something brilliant through ML/AI and visualization."** Annotated spectrograms of every detection, anomaly detection against eBird historical/range data, and a community map that aggregates everyone's acoustic detections by trail.

**Core loop:**
1. User taps **Start Walk**. The app records audio in chunks and tracks GPS while the screen stays on.
2. Chunks upload to the server, where **BirdNET** identifies birds. Detections appear live on the walk screen.
3. User can snap **photos** of birds during the walk. A vision model identifies the species.
4. User taps **End Walk** and gets a **recap**: Strava-style map with route, pins for every species heard/photographed, species list with rarity tiers, playable audio clips with annotated spectrograms, photo gallery, points, quest progress, bounties, and an AI-written summary.
5. The walk posts to the **feed**. Friends can **chirp** (like) and comment.

**Game layer:**
- **Rarity tiers** (Common / Uncommon / Rare) from eBird data. No custom rarity math.
- **Points** per species per walk. Hearing and photographing the same species counts twice.
- **Bounties**: rare detections auto-create a week-long bounty. Anyone who detects that species within 5 miles claims it.
- **Quests**: Pokémon GO field-research style ("Hear 3 woodpecker species"), generated from what's actually plausible locally.
- **Leaderboards**: local area and friends.

**Explicitly out of scope:** AI birding coach, groups/clubs, native iOS app, App Store distribution.

---

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **React + Vite + TypeScript PWA** (`vite-plugin-pwa`), Tailwind CSS | Installed to iPhone home screen ("Add to Home Screen"), runs standalone |
| Maps | **Mapbox GL JS** + **Mapbox Static Images API** + Mapbox reverse geocoding | Free tier is ample for a hackathon |
| Backend API | **Python 3.11 + FastAPI** | Handles audio, ML, scoring, game logic |
| Bird audio ID | **BirdNET** via `birdnetlib` | Model loaded once at startup |
| Audio tooling | `ffmpeg`, `librosa`, `matplotlib`, `numpy` | Conversion, clipping, spectrograms |
| DB / Auth / Storage / Realtime | **Supabase** (Postgres + **PostGIS**) | Auth via email OTP code |
| LLM | **Meta Llama API** (primary), **OpenAI** (fallback) | Behind one small provider interface, switchable by env var |
| Bird data | **eBird API 2.0** | Rarity tiers, taxonomy, anomalies, quest feasibility |
| Trails | **OpenStreetMap Overpass API** | Cached into Postgres |
| Frontend hosting | Vercel (HTTPS) | |
| Backend hosting | **Vultr** VPS (2 vCPU / 4 GB is plenty) with Docker Compose + Caddy for automatic HTTPS. Fly.io is the fallback. | HTTPS is mandatory: iOS blocks mic/geolocation/mixed content otherwise. If no domain is handy, a `sslip.io` hostname works with Caddy. |

---

## 3. Architecture

```
iPhone PWA (React)
  ├── Supabase JS client ──► Supabase (auth, simple social reads/writes, realtime subscriptions)
  └── fetch w/ Supabase JWT ──► FastAPI on Vultr
                                   ├── BirdNET (in-process)
                                   ├── ffmpeg / librosa (clips + spectrograms)
                                   ├── eBird API (cached)
                                   ├── Llama API / OpenAI (recaps, photo ID, quest text)
                                   ├── Overpass API (trails, cached)
                                   └── Supabase (service-role key) for DB + Storage
```

**Rules of thumb:**
- The client talks to **Supabase directly** only for: profiles, follows, chirps, comments, and realtime subscriptions to its own walk's detections. RLS enforces access.
- Everything involving **audio, photos, scoring, points, quests, bounties, leaderboards, location masking, or the feed** goes through **FastAPI**. This keeps game logic server-side (harder to cheat) and keeps location-privacy logic in one place.
- FastAPI verifies the Supabase JWT on every request (verify: Supabase JWKS / JWT secret approach for the current Supabase version).
- Heavy processing uses FastAPI `BackgroundTasks`. No job queue needed for the hackathon.

---

## 4. Repo layout

```
/web                     # Workstream A (+ C for social screens) — React PWA
/api                     # Workstreams B and C — FastAPI
  /app/main.py
  /app/auth.py
  /app/audio/            # B: chunk ingest, conversion, BirdNET, clips, spectrograms
  /app/birds/            # B: eBird client + caching, taxonomy, rarity tiers, anomalies
  /app/photos/           # B: vision photo ID
  /app/game/             # C: scoring, points ledger, quests, bounties, leaderboards
  /app/social/           # C: feed, masking
  /app/trails/           # C: Overpass fetch, trail species aggregation
  /app/llm/              # C: provider interface (meta | openai), recap + quest text prompts
/supabase/migrations     # C owns; everyone reads
/scripts/seed            # C: demo seed data
/scripts/fixtures        # B: sample bird audio for testing and demo
/docs/CONTRACT_CHANGES.md
docker-compose.yml, Caddyfile  # B
```

---
## 5. Data model (Supabase Postgres + PostGIS)

All `geog` columns are `geography(Point, 4326)` unless noted. All tables have `created_at timestamptz default now()`. UUID primary keys unless noted.

### Social

**profiles** — `id` (PK, = `auth.users.id`), `username` (unique, lowercase, 3–20 chars `[a-z0-9_]`), `display_name`, `avatar_url`, `last_lat`, `last_lng` (updated on each walk, used for local leaderboard/quests).

**follows** — `follower_id`, `followee_id`, PK(`follower_id`, `followee_id`). Asymmetric.

> **"Friends" = mutual follows.** Precise locations are visible only to mutual follows. Following someone one-way shows you their walks with the **general area only**. This prevents a stranger from following someone to see exact routes.

Provide a SQL function `are_friends(a uuid, b uuid) returns boolean`.

**chirps** — `walk_id`, `user_id`, PK(`walk_id`, `user_id`).

**comments** — `id`, `walk_id`, `user_id`, `body` (≤ 500 chars).

### Walks

**walks** — `id`, `user_id`, `status` (`active` | `processing` | `complete`), `started_at`, `ended_at`, `distance_m`, `duration_s`, `species_count`, `points`, `recap_text`, `static_map_path` (Storage path of the Mapbox static PNG, precise), `public_area_label` (e.g. "Candler Park, Atlanta"), `public_area_geog` (walk centroid snapped to a ~2 km grid).

**track_points** — `id`, `walk_id`, `recorded_at`, `geog`, `accuracy_m`.

**audio_chunks** — `id`, `walk_id`, `chunk_index`, `started_at` (client clock), `duration_s`, `storage_path`, `status` (`uploaded` | `processed` | `failed`).

**detections** — `id`, `walk_id`, `chunk_id`, `species_code` (eBird code), `common_name`, `sci_name`, `confidence`, `detected_at`, `geog` (interpolated from track), `is_anomaly` bool, `anomaly_reason` text null.

**photos** — `id`, `walk_id`, `captured_at`, `geog`, `storage_path`, `suggestions` jsonb (`[{species_code, common_name, confidence}]`), `species_code` null (set after user confirms), `status` (`processing` | `needs_confirmation` | `confirmed` | `unidentified`).

**walk_species** — one row per species per walk; this is what the recap and scoring read. PK(`walk_id`, `species_code`). Columns: `common_name`, `sci_name`, `family_com_name`, `rarity_tier` (`common` | `uncommon` | `rare`), `heard` bool, `photographed` bool, `detection_count`, `first_detected_at`, `geog` (first detection, or photo location if photo-only), `best_detection_id`, `best_confidence`, `clip_path`, `spectrogram_path`, `photo_id`, `points`, `is_anomaly`.

### Game

**points_ledger** — `id`, `user_id`, `amount`, `reason` (`species_heard` | `species_photographed` | `bounty_claim` | `quest_complete` | `anomaly_confirmed`), `walk_id` null, `ref_id` null, `geog` (walk centroid, for local leaderboards).

**bounties** — `id`, `species_code`, `common_name`, `source_detection_id`, `source_user_id`, `center_geog` (fuzzed, see §7.6), `radius_m`, `expires_at` (created + 7 days), `status` (`active` | `expired`).

**bounty_claims** — `bounty_id`, `user_id`, `detection_id`, PK(`bounty_id`, `user_id`).

**user_quests** — `id`, `user_id`, `template` (see §7.7), `params` jsonb, `title`, `flavor_text`, `target` int, `progress` int, `reward_points`, `starts_at`, `ends_at`, `completed_at` null, `claimed_at` null.

**quest_nests** — `user_id`, `week_start` (local Monday), `month` (local first-of-month), `quest_id`, PK(`user_id`, `week_start`). One egg per week, max 5 per month.

### Reference / cache

**ebird_taxonomy** — `species_code` PK, `common_name`, `sci_name`, `family_com_name`, `family_sci_name`, `order_name`. Loaded once at startup/seed from the eBird taxonomy endpoint.

**ebird_cache** — `cache_key` PK, `payload` jsonb, `fetched_at`. Key example: `recent:{lat2}:{lng2}` with coords rounded to 0.1°. TTL 24 h.

**trails** — `id`, `osm_id` unique, `name`, `geom geography(LineString, 4326)`, `fetched_bbox` text.

### Storage buckets
`audio-chunks` (private), `clips` (private, signed URLs), `spectrograms` (private, signed URLs), `photos` (private, signed URLs), `static-maps` (private).

### RLS summary
- `profiles`: readable by any authenticated user; writable by owner.
- `follows`, `chirps`, `comments`: readable by authenticated users; insert/delete own rows only.
- `detections` (for the live walk-screen realtime subscription): owner can select.
- Every other table: **no client access**; FastAPI uses the service role and applies masking (§7.9).

---

## 6. API contract (FastAPI)

All endpoints require `Authorization: Bearer <supabase access token>`. JSON unless noted. Times are ISO-8601 UTC. Coordinates are `{lat, lng}`.

**Frontend should build against a mock layer first** (`VITE_USE_MOCKS=true`) that returns these shapes, so A isn't blocked on B/C.

### Walk lifecycle

`POST /walks` → `{ walk_id }`
Creates an `active` walk.

`POST /walks/{walk_id}/track` — body `{ points: [{ t, lat, lng, accuracy_m }] }` → `{ ok: true }`
Client batches GPS points every ~15 s.

`POST /walks/{walk_id}/chunks` — **multipart**: `file` (audio), `chunk_index` (int), `started_at` (ISO), `duration_s` (float), `mime_type` → `{ chunk_id }`
Returns immediately; processing runs in the background. New detections are inserted into `detections`, and the client sees them via Supabase realtime.

`POST /walks/{walk_id}/photos` — **multipart**: `file` (image), `captured_at`, `lat`, `lng` → `{ photo_id }`
Vision ID runs in the background.

`GET /photos/{photo_id}` → `{ photo_id, status, species_code, suggestions: [{species_code, common_name, confidence}], url }` (owner only)
For the confirm sheet: poll until `status` leaves `processing`. *(Added 2026-09-25, see docs/CONTRACT_CHANGES.md.)*

`POST /photos/{photo_id}/confirm` — body `{ species_code | null }` → `{ ok: true }`
User picks one of the suggestions (or "not sure", which sets `unidentified`).

`POST /walks/{walk_id}/finish` → `{ status: "processing" }`
Waits for pending chunks/photos (poll DB up to ~60 s), then runs the finish pipeline (§7.10). Sets `complete` when done.

`GET /walks/{walk_id}` → **Recap** (masked per viewer, §7.9):
```json
{
  "walk_id": "...",
  "user": { "id": "...", "username": "...", "display_name": "...", "avatar_url": "..." },
  "status": "complete",
  "started_at": "...", "ended_at": "...",
  "distance_m": 3120, "duration_s": 4210,
  "species_count": 14, "points": 245,
  "precise": true,
  "public_area_label": "Candler Park, Atlanta",
  "route": [[lng, lat], ...],            // null if !precise
  "static_map_url": "signed url",         // null if !precise
  "species": [{
    "species_code": "carwre", "common_name": "Carolina Wren", "sci_name": "...",
    "family_com_name": "Wrens", "rarity_tier": "common",
    "heard": true, "photographed": false, "detection_count": 7,
    "first_detected_at": "...", "location": { "lat": 0, "lng": 0 },   // null if !precise
    "best_confidence": 0.93,
    "clip_url": "signed url", "spectrogram_url": "signed url",
    "photo_url": null, "points": 10, "is_anomaly": false
  }],
  "photos": [{ "photo_id": "...", "url": "...", "species_code": "...", "status": "confirmed", "location": {...} }],
  "recap_text": "AI-written summary…",
  "quests_progressed": [{ "quest_id": "...", "title": "...", "progress": 2, "target": 3, "completed": false }],
  "bounties_claimed": [{ "bounty_id": "...", "common_name": "...", "points": 50 }],
  "bounties_created": [{ "bounty_id": "...", "common_name": "..." }],
  "chirp_count": 4, "comment_count": 2, "viewer_chirped": false
}
```

### Social

`GET /feed?cursor=` → `{ items: [RecapSummary], next_cursor }`
Walks from people the viewer follows plus the viewer's own, newest first. `RecapSummary` = recap without `route`, `species[].clip_url/spectrogram_url`, `photos` beyond the first 3; includes `static_map_url` only if precise.

`GET /users/{username}` → profile + follower/following counts + `is_following`, `is_friend` + recent walk summaries.

`GET /users/search?q=` → `[{ id, username, display_name, avatar_url, is_following }]` (prefix match, limit 20).

Follow/unfollow, chirp/unchirp, and comments go **directly to Supabase** from the client.

### Game

`GET /quests/me` → `[UserQuest]` (unclaimed ones, including completed-but-unclaimed; ensures this week's quests exist).

`GET /quests/nests` → `{ month: "YYYY-MM", total: 5, filled, laid_this_week }`

`POST /quests/{id}/claim` → `{ points_awarded, egg_laid, nests }` (404 not yours, 409 not complete or already claimed). Pays `reward_points`; the week's first claim lays an egg.

`GET /bounties/nearby?lat&lng` → `[{ bounty_id, species_code, common_name, center: {lat,lng}, radius_m, expires_at, claimed_by_me }]` (within 25 km).

`GET /leaderboards?scope=local|friends&lat&lng` → `[{ rank, user, points }]`
Weekly (last 7 days) sum of `points_ledger`. `local` = ledger entries within 25 km of the given point. `friends` = the viewer plus everyone they follow.

### Community map (AI/ML track)

`GET /map/community?bbox=minLng,minLat,maxLng,maxLat` →
```json
{
  "trails": [{ "trail_id": "...", "name": "...", "geometry": GeoJSON LineString, "species_total": 23 }],
  "bounties": [ ... as above ... ],
  "anomalies": [{ "species_code": "...", "common_name": "...", "center": {...}, "radius_m": 300,
                  "detected_at": "...", "reason": "...", "photo_confirmed": false }],
  "heat": [{ "lat": 0, "lng": 0, "weight": 3 }]   // detections aggregated to ~250 m grid, no user info
}
```

`GET /trails/{trail_id}/species` → `{ name, top_species: [{ species_code, common_name, rarity_tier, walks, users, last_heard_at }] }`

---
## 7. Feature logic

### 7.1 Recording on iPhone (PWA) — Workstream A

The biggest technical risk in the project. **Validate on a real iPhone in the first 2–3 hours.**

- Walks are a **foreground session**: iOS suspends web audio and geolocation when a PWA is backgrounded or the screen locks. The walk screen must say so plainly ("Keep Birdseye open while you walk").
- Keep the screen on with the **Screen Wake Lock API** (`navigator.wakeLock.request('screen')`), re-requested on `visibilitychange`. Verify it works in standalone home-screen mode on the demo iOS version; if not, fall back to the silent-looping-video trick (NoSleep.js approach). Walk screen uses a dark, low-brightness UI to save battery.
- Audio via `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`. Turning these off matters: they are tuned for voice and hurt bird detection.
- **Chunking:** use `MediaRecorder`, but **stop and restart it every 6 s** so every chunk is an independently decodable file. *(Was 15 s; shortened 2026-09-25 so birds appear sooner. BirdNET runs 3 s windows with 1.5 s overlap.)* (With `timeslice`, only the first blob has headers.) Small gaps between chunks are acceptable. Record `started_at = new Date().toISOString()` at each start.
- Safari produces `audio/mp4` (AAC). Do not hardcode `audio/webm`; pick the first supported type via `MediaRecorder.isTypeSupported` and send `mime_type`.
- **Upload queue:** store chunks and photos in IndexedDB first, upload in order, retry with backoff. Trails have bad signal; nothing should be lost. `/finish` is only called after the queue drains (show "Uploading 3 clips…").
- GPS via `navigator.geolocation.watchPosition` with `enableHighAccuracy: true`; drop points with accuracy worse than 50 m; batch-post every 15 s.
- Photos via `<input type="file" accept="image/*" capture="environment">`. Stamp `captured_at` and the latest GPS fix at capture time (don't rely on EXIF). Downscale to ≤ 1600 px long edge before upload.
- Mic permission may be re-prompted each session in standalone mode. That's fine; just handle denial gracefully.
- HTTPS everywhere, or none of this works.

### 7.2 Audio pipeline — Workstream B

For each uploaded chunk (background task):
1. Save the original to Storage (`audio-chunks/{walk_id}/{chunk_index}`).
2. `ffmpeg` → mono 48 kHz WAV (what BirdNET expects).
3. Run BirdNET **without** the location filter (`birdnetlib` `Recording(analyzer, path, date=..., min_conf=0.25)` with no lat/lon — verify signature). Load `Analyzer()` **once** at app startup.
4. Separately get the location/season species list for the walk's start point and date (`birdnetlib` `SpeciesList` — verify API; this range model is derived from eBird data). Cache per walk.
5. Map each detection to eBird taxonomy **by scientific name**. BirdNET includes non-bird labels (human voice, dog, engine, siren, etc.); anything that doesn't map to `ebird_taxonomy` is dropped.
6. Keep a detection if:
   - species is in the location list **and** `confidence ≥ 0.6` → normal detection; or
   - species is **not** in the location list **and** `confidence ≥ 0.85` → keep with `is_anomaly = true`, `anomaly_reason = "outside expected range/season"`.
   - Otherwise discard.
7. `detected_at = chunk.started_at + detection.start_time`; `geog` = linear interpolation between the two nearest `track_points` (nearest point if outside the track).
8. Insert into `detections` (triggers realtime update on the walk screen).
9. Keep the WAV on local disk under `/tmp/birdseye/{walk_id}/` until the walk finishes (needed for clips).

Thresholds (`MIN_CONF=0.6`, `ANOMALY_CONF=0.85`) live in config.

### 7.3 Clips + annotated spectrograms — Workstream B

At walk finish, for each `walk_species` row with `heard = true`, using its **best** (highest-confidence) detection:
- Cut `[start − 1 s, end + 1 s]` from the chunk WAV. Encode to `.m4a` (AAC) for iOS playback. Upload to `clips/`.
- Render a mel spectrogram PNG (librosa + matplotlib, ~800×300, dark background, no axes clutter; a time axis in seconds is fine). Draw a highlighted rectangle over the 3 s detection window and a label: `Carolina Wren · 93%`. Upload to `spectrograms/`.
- In the recap, the spectrogram sits next to a play button; while the clip plays, animate a playhead across the image (Workstream A).

### 7.4 Rarity tiers (no custom math) — Workstream B

Per walk, using the walk's start point (cached in `ebird_cache` per 0.1° cell per day):
- `GET https://api.ebird.org/v2/data/obs/geo/recent/notable?lat&lng&dist=50&back=14` (verify params) → set **N**
- `GET https://api.ebird.org/v2/data/obs/geo/recent?lat&lng&dist=25&back=30` → set **R**
- Header: `X-eBirdApiToken`.

Tier:
- species in **N** → `rare` (eBird's own reviewers flag these as unusual for the area)
- species not in **R** → `uncommon` (not reported nearby in the last month)
- otherwise → `common`
- detections with `is_anomaly = true` → `rare`

If eBird is unreachable, default everything to `common` and log. Never block a walk on eBird.

### 7.5 Scoring — Workstream C

| Tier | Heard | Photographed |
|---|---|---|
| common | 10 | 10 |
| uncommon | 25 | 25 |
| rare | 75 | 75 |

- Heard and photographed are scored **independently**, so a species both heard and photographed on a walk earns double.
- Each (user, species, heard/photographed) earns points **at most once per calendar day** (prevents farming via many tiny walks). It still appears in the recap with `points: 0`.
- **Anomalies earn 0 points unless photo-confirmed** (vision ID matches the anomalous species). Confirmed anomalies earn the rare amount plus a `anomaly_confirmed` bonus of 100.
- Bounty claim: +50. Quest: its `reward_points`, paid when the user claims it.
- Every award is a row in `points_ledger`; `walks.points` is the sum for that walk.

### 7.6 Bounties — Workstream C

- **Created automatically** at walk finish for each `walk_species` with tier `rare` (including anomalies), unless an active bounty for that species already exists within 8 km.
- **Fuzzing (close, but not exact):** center = true location offset by a random bearing and a random distance of 100–200 m; `radius_m = 300`. Enough to protect a nesting or roosting bird from being pinpointed while still sending people to the right spot.
- Active for **7 days**.
- **Claim:** at walk finish, any detection (or confirmed photo) of the bounty's species by a different user, located within **8,047 m (5 miles)** of the bounty center, before expiry → insert `bounty_claims` + 50 points. One claim per user per bounty.
- Bounties show on the community map and in a "Bounties near you" list.

### 7.7 Quests (Pokémon GO field-research style) — Workstream C

Each user has up to **3 active quests**, each lasting 7 days. When fewer than 3 are active, generate more (on `GET /quests/me`).

**Current implementation (2026-09-26):** every user gets the same 3 example quests each local week (`trail_distance` 5 mi, `discover_family` Woodpeckers ×3, `photo_species` Brown Thrasher), see `api/app/game/quests.py`. Completed quests must be claimed (`POST /quests/{id}/claim`) to pay out. The first claim of a week lays an egg in one of 5 monthly nests (`quest_nests`).

Templates:

| template | params | example |
|---|---|---|
| `hear_family` | `family_com_name`, `n` | Hear 3 woodpecker species |
| `photo_family` | `family_com_name`, `n` | Photograph 2 different warblers |
| `species_in_walk` | `n` | Hear 12 species on a single walk |
| `dawn_chorus` | `n`, `before_hour` (local) | Hear 5 species before 8 AM |
| `tier_hunt` | `tier` | Hear an uncommon bird |
| `distance_species` | `km`, `n` | Walk 3 km and hear 8 species |

**Feasibility:** quests must be achievable locally. Use eBird recent observations (set **R** from §7.4, around `profiles.last_lat/lng`, or Atlanta by default) joined to `ebird_taxonomy` to count species per family. Only offer `hear_family`/`photo_family` for families with at least `n + 2` species reported nearby. Pick a mix of templates; don't repeat a family across a user's active quests.

**Flavor text:** the LLM writes a playful `title` and one-sentence `flavor_text` for each quest (JSON output), e.g. *"Knock Knock — Three different woodpeckers are drumming in your area. Track them down by ear."* Fall back to template text if the LLM fails.

**Progress** is evaluated at walk finish from that walk's `walk_species` (and cumulatively for `hear_family`/`photo_family` across walks since `starts_at`).

### 7.8 Photo identification — Workstream B

On photo upload (background):
1. Candidates = species heard so far on this walk, plus species in set **R** (§7.4).
2. Send the image to a **vision-capable model** (Llama multimodal via Meta's API first; OpenAI fallback) with the candidate list, asking for JSON: top 3 `{species_code, common_name, confidence}` from the candidates, or `[]` if no bird is clearly visible. Constraining to candidates makes a general model much more accurate than open-ended ID.
3. Save `suggestions`, set status `needs_confirmation` (or `unidentified` if empty).
4. The user confirms one suggestion in the UI (big tappable chips with names) or chooses "Not sure". Only confirmed photos count for points, quests, and bounties.

### 7.9 Location privacy & masking — Workstream C

For any walk returned by the API:
- Viewer is the owner **or** `are_friends(owner, viewer)` → `precise: true`: route, per-species locations, photo locations, static map.
- Otherwise → `precise: false`: only `public_area_label` and `public_area_geog`. No route, no pins, no static map, no photo locations.
- `public_area_label` comes from Mapbox reverse geocoding of the walk centroid (neighborhood or locality); `public_area_geog` is the centroid snapped to a 0.02° grid.
- Community map heat data is aggregated to a ~250 m grid with no user attribution.

### 7.10 Walk finish pipeline — Workstreams B + C

Implemented as one orchestrator function (C owns the orchestrator; it calls B's modules):
1. Wait for pending chunks/photos (≤ 60 s).
2. Compute `distance_m` (sum of geodesic segment lengths), `duration_s`.
3. Build `walk_species` from detections + confirmed photos; attach taxonomy family.
4. Rarity tiers (§7.4).
5. Clips + spectrograms (§7.3).
6. Scoring → `points_ledger` (§7.5).
7. Bounty claims, then bounty creation (§7.6).
8. Quest progress (§7.7).
9. Public area label + grid point (§7.9).
10. Static map PNG: Mapbox Static Images API with the route as an encoded polyline (simplify to keep the URL under the length limit) and pins colored by tier. Save to Storage.
11. AI recap (§7.11).
12. `status = complete`; update `profiles.last_lat/lng`; delete temp WAVs.

Each step is wrapped so a failure in steps 5, 10, or 11 doesn't fail the walk; it just leaves that field null.

Photos confirmed **after** finish re-run steps 3, 6, 7, 8 for that walk (idempotently: recompute this walk's ledger rows).

### 7.11 AI walk recap — Workstream C

LLM input: structured JSON of the walk (duration, distance, area label, species with tiers and times, photos, anomalies, quests progressed/completed, bounties claimed/created). Output: 3–5 sentences, warm and a little playful, like a field-journal entry. **Instruct the model to use only facts from the provided data** (no invented behaviors or facts about the location). Store in `walks.recap_text`.

### 7.12 LLM provider interface — Workstream C

`api/app/llm/` exposes:
```python
async def complete_json(system: str, user: str, schema_hint: str) -> dict
async def vision_json(system: str, image_bytes: bytes, mime: str, user: str) -> dict
```
`LLM_PROVIDER=meta|openai`. Model names from env. Meta's Llama API may offer an OpenAI-compatible endpoint (verify); if so, both providers can use the OpenAI Python SDK with different `base_url`/key. Always strip code fences before parsing JSON, retry once, then fall back.

### 7.13 Community map + trails — Workstream C (API), A (UI)

- On `GET /map/community`, if the bbox isn't cached in `trails`, fetch from Overpass: named ways with `highway` in (`path`, `footway`, `track`, `bridleway`) plus `route=hiking` relations. Store geometry. (Prefetch the Atlanta demo area in the seed script; public Overpass is rate-limited.)
- Trail species = detections within **75 m** of the trail geometry (`ST_DWithin`) in the last 90 days, grouped by species, ranked by distinct walks. Only return trails with ≥ 1 detection by default, so the map isn't cluttered.
- UI: trails drawn as lines, thickness/color by species total; tapping one opens a bottom sheet with top species (tier badges). Plus bounty circles, anomaly markers (fuzzed like bounties), and a detection heatmap toggle.

---

## 8. Frontend screens — Workstream A (walk/recap/map), C (social)

Mobile-first, one-handed, big touch targets, bottom tab bar: **Feed · Walk · Quests** (app opens on Walk); profile opens from an avatar in the top-right header. Respect iOS safe areas (`env(safe-area-inset-*)`). Web app manifest with `display: standalone`, icons, and theme color.

1. **Auth** — email + password (Supabase `signUp` / `signInWithPassword`), with "Confirm email" turned off so no email is ever sent. Then pick a username. *(Changed from email OTP: templates now require custom SMTP and the built-in sender is limited to a few emails/hour. See docs/CONTRACT_CHANGES.md.)* Don't use magic links: on iOS they open in Safari, not the installed PWA.
2. **Walk (idle)** — big "Start Walk" button, active quests preview, nearby bounties.
3. **Walk (active)** — timer, distance, species count, live list of detected species (newest on top, tier badge, subtle pulse animation when a new bird is heard), camera button, "End Walk". Mic/wake-lock status indicator. Warn if the upload queue is backing up.
4. **Photo confirm sheet** — photo + suggestion chips.
5. **Recap** — stats header; Mapbox map with route and pins (distinct icon for heard vs. photographed vs. both; color by tier; tapping a pin scrolls to the species); species list sorted rare → common with play button + spectrogram; photo gallery; AI recap text; quest progress; bounties claimed/created; chirp + comments.
6. **Feed** (C) — cards: user, area label, stats, static map (if precise), top 3 species, first photo, recap text snippet, chirp/comment counts.
7. **Community Map** (A) — see §7.13.
8. **Quests** (C) — 5 monthly nests on top (the week's first claimed quest lays an egg; footprints walk to the next nest); quest cards with progress bars and XP; completed ones are covered by a CLAIM REWARD button; bounties near you; leaderboards (Local / Friends toggle).
9. **Profile** (C) — stats, life list count, recent walks, follow button, **personal QR code** (encodes `https://<app-domain>/u/{username}`), and **"Scan QR"** using an in-app camera scanner (`html5-qrcode` or `jsQR`), since scanning with the iOS Camera app would open Safari instead of the PWA. `/u/{username}` route also works in a browser.
10. **User search** (C) — username prefix search.

Design: nature palette (deep greens, warm off-white, one bright accent for rare birds), rounded cards, tier badges (Common gray, Uncommon blue, Rare gold).

---

## 9. Priorities

**P0 — must work for any demo**
- Auth + username
- Walk session on iPhone: recording chunks, GPS, wake lock, upload queue
- BirdNET pipeline + live detections on walk screen
- Photo capture with location pin (even before vision ID)
- Finish pipeline (basic stats, `walk_species`, rarity tiers, scoring)
- Recap with map, route, pins, species list

**P1 — equal importance; build in parallel after P0**
- Bounties (create, fuzz, claim, list, map)
- Quests (generation, feasibility, progress, UI)
- Follows, feed, chirps, comments, masking, QR codes, user search
- Leaderboards
- Demo seed data (§11)

**P2**
- Vision photo ID + confirm flow
- AI walk recap
- AI quest flavor text
- Clips + annotated spectrograms

**P3**
- Anomaly detection surfaced in UI
- Community map with trails, heatmap, anomalies
- Static map images for feed cards (fallback: small interactive map or no map)

---

## 10. Parallel workstreams

**Hour 0–2, all together:** agree on this spec, create the repo skeleton, Supabase project, and migrations for §5 (C drives, others review). B starts the API with **stub endpoints returning the §6 shapes** so A can integrate against a real server early. Set up env vars (§12).

**Workstream A — Frontend PWA (walk, recap, map)**
PWA shell, auth, iPhone recording spike (first!), walk screens, upload queue, photo capture/confirm UI, recap page, community map UI, mock layer. Deploy to Vercel early and test on the iPhone constantly.

**Workstream B — ML / audio / bird data**
FastAPI skeleton + auth middleware, Docker + Caddy deploy on Vultr, audio pipeline (§7.2), eBird client + cache + taxonomy load, rarity tiers (§7.4), clips + spectrograms (§7.3), photo ID (§7.8), test fixtures.

**Workstream C — Backend game + social + frontend social screens**
Migrations + RLS, finish orchestrator (§7.10), scoring, bounties, quests, leaderboards, feed + masking, LLM interface + recap, trails + community map API, seed script. Then the Feed, Quests, Profile, and Search screens in `/web`.

**Suggested checkpoints (36 h):**
- **H3:** iPhone records 15 s chunks and uploads them; BirdNET identifies a fixture file locally; migrations applied.
- **H10:** End-to-end walk: record → live detections → finish → basic recap with map. Deployed. *(P0 done.)*
- **H20:** Bounties, quests, feed/follows working with seed data. Rarity tiers live.
- **H28:** Photo ID, AI recap, spectrograms, community map.
- **H32:** Feature freeze. Polish, fix bugs, rehearse the demo.
- **H34–36:** Buffer and presentation.

Sleep in shifts; don't all crash at once.

---

## 11. Demo plan & seed data — Workstream C (seed), B (fixtures)

- **Fixtures:** CC-licensed recordings (e.g. from xeno-canto; check each clip's license and credit it in the README) of birds common around Atlanta (Northern Cardinal, Carolina Wren, Blue Jay, Tufted Titmouse, Red-bellied Woodpecker, Pileated Woodpecker, Downy Woodpecker, American Robin) plus one or two species that would trigger a rare tier or anomaly.
- **Seed script** creates ~12 fake users with follows (some mutual), ~40 walks over the past 2 weeks on real Atlanta-area trails (e.g. around Piedmont Park, the BeltLine, Freedom Park, Sweetwater Creek, Kennesaw Mountain) with realistic routes, detections, a few photos, active bounties, quest progress, chirps, and comments. Prefetch trail data for these areas. The feed, leaderboards, and community map must look alive.
- **Live demo:** presenter starts a walk on the iPhone; a teammate plays fixture calls from a laptop speaker; detections pop in live; take a photo of a bird picture on a laptop screen; end walk; show the recap (map, spectrogram with clip playing, AI recap, quest completes, bounty claimed); switch to feed, friend chirps it; open community map and tap a trail.
- Have a **pre-recorded screen capture** of the full flow as a backup in case venue Wi-Fi fails.
- Known limitation to mention proactively: someone could play recordings to farm points. Mitigations (future work): require GPS movement during a walk, weight photo-confirmed and multi-user-corroborated detections.

---

## 12. Environment variables

```
# web
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_BASE_URL=
VITE_MAPBOX_TOKEN=
VITE_USE_MOCKS=false

# api
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=          # or JWKS URL, depending on project setup (verify)
EBIRD_API_KEY=                # free: request from eBird
MAPBOX_TOKEN=
LLM_PROVIDER=meta             # meta | openai
META_LLM_API_KEY=
META_LLM_BASE_URL=
META_TEXT_MODEL=
META_VISION_MODEL=
OPENAI_API_KEY=
OPENAI_TEXT_MODEL=
OPENAI_VISION_MODEL=
MIN_CONF=0.6
ANOMALY_CONF=0.85
DEFAULT_LAT=33.749            # Atlanta fallback
DEFAULT_LNG=-84.388
```

The app must work in **any region**: nothing is hardcoded to Atlanta except the fallback coordinates and the seed data.
