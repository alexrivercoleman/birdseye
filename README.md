# Birdseye

**Strava for birding.** Go on a walk, your phone listens, AI identifies every bird you hear, and you get a recap with a map, photos, points, quests, and bounties to share with friends.

The full build spec is in [BIRDSEYE_SPEC.md](BIRDSEYE_SPEC.md). §5 (data model) and §6 (API contract) are the source of truth; log any change to them in [docs/CONTRACT_CHANGES.md](docs/CONTRACT_CHANGES.md).

| Dir | What | Owner |
|---|---|---|
| `web/` | React + Vite + TS PWA | A (+ C for social screens) |
| `api/` | FastAPI | B + C |
| `supabase/migrations/` | Postgres + PostGIS schema, RLS | C |
| `scripts/seed/` | Demo seed data | C |
| `scripts/fixtures/` | Sample bird audio | B |
| `docker-compose.yml`, `Caddyfile` | Vultr deploy | B |

## Quick start

### Web
```sh
cd web
cp .env.example .env    # VITE_USE_MOCKS=true works with no backend
npm install
npm run dev             # --host is on, so a phone on the same Wi-Fi can open it (mic/GPS need HTTPS though)
```

### API
```sh
cd api
py -3.12 -m venv .venv          # Windows (Docker image uses 3.11)
.venv\Scripts\activate          # or: source .venv/bin/activate
pip install -r requirements.txt # requirements-ml.txt adds BirdNET/librosa
cp .env.example .env
uvicorn app.main:app --reload
pytest
```
Every endpoint is currently a **stub** returning §6-shaped data from `app/stubs.py`, marked `# STUB` so it's easy to grep.

### Database
Create a Supabase project, then either:
- paste `supabase/migrations/*.sql` into the SQL editor, or
- `npx supabase link --project-ref <ref>` then `npx supabase db push`.

The migration enables PostGIS, creates all §5 tables, RLS policies, `are_friends()`, realtime on `detections`, and the storage buckets.

Auth: in Supabase → Authentication → Email templates, make the sign-in email include the `{{ .Token }}` 6-digit code (spec §8: OTP code, not magic link).

### Deploy
- **Web:** Vercel, root directory `web/`, env vars from `web/.env.example`.
- **API:** Vultr VPS: `docker compose up -d --build` with `api/.env` filled in and `API_DOMAIN` set (an `sslip.io` hostname works).

## Credits
Audio fixture licenses: see [scripts/fixtures/README.md](scripts/fixtures/README.md).
