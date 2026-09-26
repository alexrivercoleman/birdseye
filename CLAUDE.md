# Birdseye

Read [BIRDSEYE_SPEC.md](BIRDSEYE_SPEC.md) first. §0 has the rules for Claude Code sessions. In short:

- Three engineers work in parallel on workstreams A (frontend), B (ML/audio/bird data), and C (game/social/migrations). Ask which one if it hasn't been stated.
- §5 (data model) and §6 (API contract) are the source of truth. Don't change them silently: log any change in [docs/CONTRACT_CHANGES.md](docs/CONTRACT_CHANGES.md) and tell the engineer.
- Stay inside your workstream's directories (§4). Stub or mock anything that belongs to another workstream.
- 36-hour hackathon: pick the simplest thing that works. Add smoke tests only for scoring and the audio pipeline.
- Anything the spec marks "verify" must be checked against current docs.

## Layout
- `web/`: Vite + React + TS PWA. `npm run dev`. Set `VITE_USE_MOCKS=true` to use the mock API in `web/src/api/mocks.ts`.
- `api/`: FastAPI. Stub routers in `api/app/routers/` return the §6 shapes; replace each stub as the real logic lands.
- `supabase/migrations/`: schema + RLS (owned by C). Apply with `npx supabase db push`, or paste into the SQL editor.
- `scripts/seed/` (C) and `scripts/fixtures/` (B).
