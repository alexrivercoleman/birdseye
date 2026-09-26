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
