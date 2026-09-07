# Bravitar

Plugin-based, multi-vertical SaaS platform for sports/fitness academies (gym,
swimming, dance, karate, football, ...). See [PROJECT_PLAN.md](PROJECT_PLAN.md)
for the full vision, architecture, and build phases.

## Status

Phase 0 — Foundation.

## Backend (Django + DRF)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in Supabase DB + JWT secret
python manage.py migrate
python manage.py runserver
```

- `GET /api/health/` — unauthenticated health check
- `GET /api/me/` — returns the authenticated Supabase user's id/email (requires
  `Authorization: Bearer <supabase JWT>`)

Without `SUPABASE_DB_HOST` set, the backend falls back to local SQLite so it
runs out of the box.
