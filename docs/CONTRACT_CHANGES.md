# Contract changes

§5 (Data Model) and §6 (API Contract) in [BIRDSEYE_SPEC.md](../BIRDSEYE_SPEC.md) are the source of truth.
If you need to change a table, column, endpoint, request shape, or response shape, **add an entry here and tell the team** before merging.

Format:

```
## YYYY-MM-DD HH:MM — <short title> (<workstream>, <name>)
- What changed:
- Why:
- Who needs to update what:
```

---

<!-- newest first -->

## 2026-09-26 — Comment replies, comment likes, realtime chirps/comments (A, in C's migrations)
- What changed (§5), migration `20260926200000_comment_replies_likes.sql`:
  - `comments.parent_id` uuid null → `comments.id`, on delete cascade. Replies are **one level deep**: a trigger
    rejects a `parent_id` that isn't a top-level comment on the same walk. Replying to a reply = same `parent_id`.
  - New table `comment_likes` (`comment_id`, `user_id`, PK both, `created_at`). RLS like `chirps`: authenticated
    can read; insert/delete own rows.
  - `chirps`, `comments`, `comment_likes` added to the `supabase_realtime` publication.
  No §6 change: `comment_count` in recaps still counts every comment, replies included.
- Why: feed chirps, comments, comment likes and replies, live across users. The client does all of this directly
  against Supabase (§3), in `web/src/lib/social.ts`; the feed card UI is `web/src/components/CommentSection.tsx`.
- Who needs to update what: **apply the migration** (`npx supabase db push`, or paste it into the SQL editor), or
  comment likes/replies fail and nothing updates live. Seed script (C): comments can now have `parent_id` and
  `comment_likes` rows. Client embeds of `profiles` from `comments` need the FK hint
  `profiles!comments_user_id_fkey` because `comment_likes` makes the relationship ambiguous for PostgREST.

## 2026-09-26 — Community map is real: trail groups, MultiLineString trails, Overpass cache (C, Alexandros)
- What changed:
  - §5: `trails.group_id` bigint (every OSM way of one named trail shares it: the group's smallest `osm_id`). New
    table `trail_fetch_cells` (`cell` text PK, `fetched_at`), the per-0.05°-cell Overpass cache, RLS on, API only.
    Migration `20260926180000_trail_groups.sql`.
  - §6: `GET /map/community` trails are one entry per trail group: `trail_id` is the group id and `geometry` is a
    GeoJSON **MultiLineString** (was LineString). `GET /trails/{trail_id}/species` takes that group id (404 if
    unknown) and returns up to 15 species. Bad `bbox` → 422.
  - §7.13: every trail in the bbox is returned, including ones with `species_total: 0` (was: only trails with ≥ 1
    detection); the map draws those grey. Overpass also fetches named `highway=cycleway` (the BeltLine and PATH
    trails are tagged that way), minus `foot=no`. Anomalies are left out of trail counts and heat; heat weight = distinct (walk, species) per cell.
    Bounties on the map now come from the `bounties` table (empty until §7.6 lands), not the stub.
  - §8: the community map UI is built by C (was A) and lives on the idle Walk screen, behind Start Walk. The web
    app draws 6 sample trails (`web/src/api/sampleMap.ts`, ids `sample-*`, species sheets answered client-side) on
    top of the API's trails, so the deployed demo isn't empty; set `VITE_MAP_SAMPLES=false` to hide them.
- Why: OSM splits one trail into dozens of ways, so per-way trails gave 50 m "trails" with a handful of birds each.
- Who needs to update what: **apply the migration before deploying the API** (the map queries read `group_id`),
  then run `cd api && python scripts/prefetch_trails.py` once to cache the demo areas. A: `WalkScreen`'s idle view
  now renders the map; the active walk view is unchanged.

## 2026-09-26 — Big egg: hatch a full month of nests for 500 points (C, Alexandros)
- What changed:
  - §5: new table `nest_hatches` (`user_id`, `month` date, `created_at`, PK(`user_id`, `month`)), RLS on, API only.
    `points_ledger.reason` gains `nest_hatch`. Migration `20260926150000_nest_hatch.sql`.
  - §6: `NestStatus` gains `hatched: bool` (this month's big egg is hatched). New `POST /quests/nests/hatch` →
    `{ points_awarded, nests }`: 409 unless all 5 of this month's nests are full and it isn't hatched yet. Pays 500.
  - §8: Quests screen uses the pixel-art nest/egg sprites. When the last nest fills, a big egg appears over a white
    glow. Each tap shakes it and spreads the cracks; the 10th tap breaks it open and shows 500 XP.
- Why: reward for filling every nest in a month.
- Who needs to update what: **apply the migration before deploying the API**, since `GET /quests/nests` now reads
  `nest_hatches`. The web mock starts at 4/5 nests, so the first claim triggers the big egg.

## 2026-09-26 — Quest claims, monthly nests, 3-tab nav (C, Alexandros)
- What changed:
  - §5: `user_quests.claimed_at` (timestamptz null); templates `trail_distance` (params `miles`; target/progress in
    meters), `discover_family` (`family_com_name`, `n`), `photo_species` (`species_code`, `common_name`); unique
    (`user_id`, `template`, `starts_at`). New table `quest_nests` (`user_id`, `week_start` date, `month` date,
    `quest_id`, PK(`user_id`, `week_start`)). Migration `20260926120000_quest_claims_nests.sql`.
  - §6: `UserQuest` gains `claimed_at`. `GET /quests/me` returns unclaimed quests (completed-but-unclaimed ones stay
    past `ends_at`). New `GET /quests/nests` → `{ month, total, filled, laid_this_week }` and
    `POST /quests/{id}/claim` → `{ points_awarded, egg_laid, nests }` (404 not yours, 409 incomplete/claimed).
  - §7.5/§7.7: quest points are paid on claim, not on completion. Every user gets the same 3 example quests per local
    week (Mon–Mon) for now. The first claim of a week lays an egg in one of 5 nests for that month.
    `trail_distance` counts track segments within 40 m of a cached trail, or anywhere with no trail data within 1 km.
  - §8: tab bar is Feed · Walk · Quests; profile opens from an avatar in the header.
- Why: Pokémon GO-style field research with a claim step and monthly stamp-card nests.
- Who needs to update what: migration already applied to Supabase (2026-09-26). Anyone generating quests later should
  replace `WEEKLY_QUESTS` in `api/app/game/quests.py`. Recap `quests_progressed` is still empty (TODO).

## 2026-09-26 — GET /feed shows everyone's walks; RecapSummary keeps a thinned route (A, implemented in C's area)
- What changed:
  1. `GET /feed` returns **every user's** `complete` walks (was: followed users + own), newest first by `ended_at`,
     plus the viewer's own walks still `processing`, so a just-finished walk appears at the top immediately.
     Page size 10; `next_cursor` is `"<ended_at ISO>|<walk_id>"` (malformed cursor → 422).
     Masking (§7.9) is unchanged: non-friends still get `precise: false`, no route, no locations.
  2. `RecapSummary` now includes `route` when `precise`, thinned to ≤ 80 points (was: never included).
     Feed cards draw it as an SVG sketch, since static map images (P3) aren't generated yet.
  Implemented in `api/app/social/feed.py`, `api/app/routers/social.py`, `api/app/social/recap.py` (`summary=True`).
- Why: product ask for a Strava-style feed where everyone's walks are visible and the walker lands on the feed
  (not the recap page) after End Walk. The walk screen now navigates to `/feed` with `{ justFinished: walkId }`;
  tapping the card opens the full recap.
- Who needs to update what: C, the feed API and Feed screen (`web/src/screens/FeedScreen.tsx`,
  `web/src/components/WalkCard.tsx`) are no longer stubs/placeholders; review and take ownership. If follows-only
  should come back later, it's one `where` clause in `build_feed`. `GET /users/{username}` can reuse
  `build_recap(..., summary=True)` for `recent_walks`.

## 2026-09-25 — New endpoint GET /photos/{photo_id} (C, Alexandros)
- What changed: additive. `GET /photos/{photo_id}` → `{ photo_id, status, species_code, suggestions, url }`, owner only.
  Added to §6, `api/app/schemas.py` (`PhotoDetail`), and `web/src/api` (`PhotoDetail` type, `api.getPhoto`, mock).
- Why: §8's photo confirm sheet needs the suggestions, but no endpoint returned them (photos have no client RLS access
  and `RecapPhoto` has no `suggestions`).
- Who needs to update what: A polls `api.getPhoto` after upload until status isn't `processing`, then shows the chips.
  Until vision ID (P2) lands, suggestions are the species heard so far on the walk, with `confidence: null`.

## 2026-09-25 — Auth: email + password instead of email OTP (C, Alexandros)
- What changed: §8 screen 1. Sign-in is email + password (`supabase.auth.signUp` / `signInWithPassword`).
  "Confirm email" is off in Supabase, so sign-up returns a session immediately. No §5/§6 change.
- Why: Supabase now requires custom SMTP to edit email templates (needed to put the 6-digit `{{ .Token }}`
  in the email), and the built-in sender allows only a few emails per hour, which demo-day sign-ups would hit.
- Who needs to update what: A builds the auth screen as email + password. Backend unaffected (still Supabase JWTs).

## 2026-09-25 — New API env var DATABASE_URL (C, Alexandros)
- What changed: `api/.env` needs `DATABASE_URL` (Supabase session pooler connection string; see `api/.env.example`).
  C's code talks to Postgres directly via `app/db.py` (psycopg) for PostGIS/aggregate queries. No §5/§6 change.
- Who needs to update what: B, add it to the Vultr `api/.env`. B's code may use `app.db` or supabase-py, either is fine.
- Also for B: the finish pipeline calls `app.birds.rarity.tiers_for_walk` and `app.audio.clips.render_clip` if they
  exist (signatures in `api/app/game/finish.py`), and photo confirm should call `app.game.finish.rescore_walk`.
