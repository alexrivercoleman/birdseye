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
