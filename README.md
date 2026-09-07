# Bravitar

Plugin-based, multi-vertical SaaS platform for sports/fitness academies (gym,
swimming, dance, karate, football, ...). See [PROJECT_PLAN.md](PROJECT_PLAN.md)
for the full vision, architecture, and build phases.

## Status

Phase 3 — Gym/Fitness plugin, in chunks. Done: guided sessions (pre-fill,
rest timer, PR detection, estimated 1RM, progression rules, supersets).
Remaining: body log + progress photos, nutrition, muscle map and heatmap.

## Local dev domains

Org dashboards are served from `<slug>.lvh.me:5173`, matching the
`<slug>.bravitar.com` scheme production will use. `lvh.me` is a public domain
whose wildcard DNS points at `127.0.0.1`, so subdomains work with no
`/etc/hosts` entries.

`*.localhost` resolves too, but browsers treat `localhost` as a public suffix
and won't share cookies across its subdomains — which breaks the single
sign-in across org subdomains. Use `lvh.me`. (Offline, add explicit
`/etc/hosts` entries for a `.test` domain and point both `.env` files at it.)

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
python manage.py seed_exercises   # shared exercise library (safe to re-run)
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

### Gym/fitness plugin (`exercises/`, `workouts/`)

Every endpoint below is gated by `HasGymVertical` — an organization that
didn't select the gym vertical gets a 403, which is what makes the plugin
system real on the backend rather than just a UI filter.

- `GET/POST /api/gym/exercises/` — the shared library plus this org's custom
  exercises; supports `?search=`, `?muscle=`, `?equipment=`, `?category=`.
  Creating is owner/staff only, and the exercise is scoped to that org.
- `GET /api/gym/exercises/meta/` — muscle/equipment/category vocabulary
- `GET/POST /api/gym/routines/`, `GET/PUT/DELETE /api/gym/routines/<id>/` —
  routines with nested exercise targets; scoped to the caller
- `GET /api/gym/routines/<id>/guide/` — everything needed to run the routine
  as a guided session: last session's sets, the suggested weight/reps from the
  routine's progression rule, and the lifter's best estimated 1RM
- `POST /api/gym/sessions/`, `POST /api/gym/sessions/<id>/sets/`,
  `POST /api/gym/sessions/<id>/complete/` — workout logging

Set logs carry `is_warmup` and `rir` (reps in reserve). Estimated 1RM uses the
Epley formula and is computed on save; a working set is flagged
`is_personal_record` when its e1RM beats every previous working set for that
exercise. Warm-ups are excluded from both PRs and progression, so a heavy
warm-up single can't fake a record.

Progression rules (`workouts/progression.py`) turn last session into next
session's targets — `linear`, `double_progression` (needs `target_reps_max`),
`greyskull` (AMRAP last set, deloads 10% on a miss), or `none`. The suggestion
is advice: the lifter can log whatever they actually did.

Exercises with `organization = null` are the shared library seeded by
`seed_exercises`; anything else belongs to one academy. Routines and set logs
validate that a referenced exercise is actually visible to the caller's org,
so one academy can't reference another's custom exercise.

Without `SUPABASE_DB_HOST` set, the backend falls back to local SQLite so it
runs out of the box.

## Frontend (React + Vite)

```bash
cd frontend
npm install
cp .env.example .env   # fill in VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev            # http://lvh.me:5173
```

- Sign in / sign up runs against Supabase Auth in the browser.
- On the root domain you get your academy list, or onboarding (name, web
  address, vertical selection) if you have none.
- Creating an academy sends you to `<slug>.lvh.me:5173`, where the dashboard
  shell renders the modules that org's verticals turn on
  (`src/lib/verticals.js` is the UI half of the plugin registry).

Two things make the tenancy work in dev:

- The Vite dev server proxies `/api` to Django with `changeOrigin: false`, so
  the original `Host` header reaches the tenant middleware.
- The Supabase session is stored in a cookie scoped to `.lvh.me`
  (`src/lib/supabase.js`) rather than `localStorage`, which is per-origin —
  otherwise every org subdomain would demand a fresh login.
