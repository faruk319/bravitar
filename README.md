# Bravitar

Plugin-based, multi-vertical SaaS platform for sports/fitness academies (gym,
swimming, dance, karate, football, ...). See [PROJECT_PLAN.md](PROJECT_PLAN.md)
for the full vision, architecture, and build phases.

## Status

Phase 1 — Core Platform (in progress).

## Local Supabase

```bash
supabase start   # or `supabase db reset` to wipe local data
```

## Backend (Django + DRF)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in Supabase DB + JWT/URL settings
python manage.py migrate
python manage.py runserver
```

### Accounts (`accounts/`)

- `GET /api/health/` — unauthenticated health check
- `GET /api/me/` — the authenticated Supabase user's id/email (requires
  `Authorization: Bearer <supabase JWT>`)

JWTs are verified via Supabase's JWKS endpoint (ES256/RS256, the current
Supabase default), with a legacy HS256 shared-secret fallback for older
projects.

### Organizations & tenancy (`organizations/`, `tenants/`)

- `POST /api/organizations/signup/` — authenticated user creates an
  Organization (name, slug, verticals) and becomes its owner
- `GET /api/organizations/mine/` — organizations the current user belongs to
- `GET /api/organizations/current/` — the Organization resolved for this
  request by `TenantResolutionMiddleware`
- `GET/POST /api/organizations/current/branches/` — branches (create is
  owner-only)
- `GET/POST /api/organizations/current/api-keys/` — API keys for headless
  access (owner-only; the raw key is only ever returned once, on creation)

Requests are scoped to an Organization by, in order: `X-API-Key` header,
`Host` header matching a verified `custom_domain`, or `Host` header
subdomain (`<slug>.<DJANGO_BASE_DOMAIN>`).

Without `SUPABASE_DB_HOST` set, the backend falls back to local SQLite so it
runs out of the box.
