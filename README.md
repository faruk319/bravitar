# Bravitar

Plugin-based, multi-vertical SaaS platform for sports/fitness academies (gym,
swimming, dance, karate, football, ...). See [PROJECT_PLAN.md](PROJECT_PLAN.md)
for the full vision, architecture, and build phases.

## Status

Phase 3 complete — the Gym/Fitness plugin now has guided sessions
(pre-fill, rest timer, PR detection, estimated 1RM, progression rules,
supersets), a body log (measurements, weight chart, private progress
photos), nutrition (food library, macro targets, daily log), and the
muscle map + activity heatmap.

Phase 5 in progress — additional verticals on the same plugin pattern as
the gym. Done: swimming (lane planner, skill ladder) and karate (belts,
gradings, sparring). Remaining: dance and football.

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
python manage.py test             # 97 tests, ~2s
python manage.py seed_exercises   # shared exercise library (safe to re-run)
python manage.py seed_foods       # shared food library (safe to re-run)
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
- `PATCH /api/organizations/current/` — rename the academy and turn
  verticals on or off (owner only). `GET` also returns the caller's `role`.
- `GET/POST /api/organizations/current/team/`,
  `GET/PATCH/DELETE /api/organizations/current/team/<id>/` — invite by
  email, change roles, remove people (staff and up read, owner writes)
- `GET/POST /api/organizations/current/branches/`,
  `GET/PATCH/DELETE /api/organizations/current/branches/<id>/`
- `GET/POST /api/organizations/current/api-keys/` — API keys for headless
  access (owner-only; the raw key is only ever returned once, on creation)

Requests are scoped to an Organization by, in order: `X-API-Key` header,
`Host` header matching a verified `custom_domain`, or `Host` header
subdomain (`<slug>.<DJANGO_BASE_DOMAIN>`).

### Roles

`owner > manager > staff`, each including everything below it.

| Role | Can | Status |
|---|---|---|
| **Owner** | Everything, including settings and who has access | live |
| **Manager** | Runs the academy, and handles fees and invoices | live |
| **Staff / Trainer** | Runs sessions: members, batches, registers | wired, off |
| **Member** | Their own things only | wired, off |

Only owner and manager can sign in today — the product is being built around
the two roles that run an academy. Staff and member are fully wired and their
permissions are tested; turning either on is a line in `Role.ASSIGNABLE` and
`Role.CAN_SIGN_IN`. Existing rows keep their role, so nobody has to be
re-invited, and anyone in a switched-off role is told which one rather than
getting a bare error.

The split that gives *manager* meaning: anyone running the academy can read
the books, but raising an invoice or recording a payment is a manager's job —
a trainer runs sessions, a manager bills for them. That is one line in
`Role.MANAGES` if you'd rather trainers took payments too.

Members are tracked as `Student` records rather than logins regardless — a
Student is an enrolment, a Membership is a login, and most students (children
especially) never need one.

### Invitations

An owner invites by email *before* that person has an account: the Membership
row is created with an empty `user_id`, and the invitation is claimed the first
time they sign in with that address. That's why the two uniqueness rules on
Membership are conditional — several pending invites in one organization all
share an empty `user_id`.

**Claiming requires Supabase to have confirmed the address.** Without that
check, signing up with someone else's invited email would hand over their role.
Local Supabase auto-confirms; a production project must keep email confirmation
switched on for this to mean anything.

An organization always keeps at least one owner: demoting or removing the last
one is refused, otherwise nobody could manage the academy — including undoing
the change. Deleting a branch that still holds members or batches is refused
too, since students and batches point at it with `SET_NULL` and would be
quietly unfiled.

Turning a vertical off hides its modules and closes its API, but deletes
nothing — switching it back on restores the data.

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

### Body log (`bodylog/`)

- `GET /api/gym/body/meta/` — metrics with their legal units, and photo poses
- `GET/POST /api/gym/body/entries/` — measurements, filterable by `?metric=`.
  Each metric declares its units, so a waist reading in kg is rejected. Logging
  the same metric twice on one day updates that day's reading (200) rather
  than failing on the uniqueness constraint.
- `GET/POST /api/gym/body/photos/`, `GET /api/gym/body/photos/<id>/image/`

**Body data is private to the member it belongs to** — trainers and owners get
no implicit access, since these are measurements and pictures of someone's
body. Photo files are stored under an unguessable path in `MEDIA_ROOT`, which
is deliberately *not* wired to a static/media URL: the only way to read one is
the ownership-checked view, so the frontend fetches it with its bearer token
and renders an object URL. Production should move these to object storage.

### Nutrition (`nutrition/`)

- `GET/POST /api/gym/nutrition/foods/` — shared food library plus this org's
  own entries (`?search=`); adding is owner/staff only
- `GET/PUT /api/gym/nutrition/plan/` — the caller's daily macro targets
- `GET/POST /api/gym/nutrition/log/?date=` — what was eaten that day
- `GET /api/gym/nutrition/summary/?date=` — totals against targets, split by meal

Macros are stored **per 100 g**, so a portion is a straight ratio — 200 g of
something at 165 kcal/100 g is 330 kcal. The seeded values in
`nutrition/seed_data.py` are approximate reference figures, not label-accurate:
brands vary and cooking changes weight, so anyone tracking closely should add a
custom food from their own packaging. Like the body log, a person's food log and
targets are visible only to them.

### Training stats (`workouts/stats.py`)

- `GET /api/gym/stats/muscles/?days=` — per-muscle volume, sets, best e1RM and
  days since last trained; feeds the balance / fatigue / strength views
- `GET /api/gym/stats/activity/?days=` — sessions and sets per day, every day
  in the window present, for the heatmap

Both are derived from `SetLog` on read — there is no stats table, so the
numbers can't drift from the log they describe. A set credits its primary
muscle in full and its secondary muscles at half: counting assistance work at
full weight would make a bench press look like a triceps session, while
ignoring it hides real volume. Warm-ups are excluded, and bodyweight sets count
as sets but carry no tonnage, which is why both numbers are reported.

## Cross-vertical core (Phase 4)

Reads are open to any signed-in role; writes are staff and up, except the
books, which are managers only. The screens cover the operational loop end to
end: create a batch, enrol members into it, mark the register, raise an
invoice against a fee plan, record the payment, and log a walk-in enquiry
through to enrolment.

Available to every vertical, not gated behind one — a swim academy and a gym
both get these. Reads are open to any member; writes are owner/staff.

- `GET/POST /api/students/` — members, filterable by `?search=`, `?status=`,
  `?branch=`
- `GET/POST /api/batches/`, `/api/batches/enrolments/` — classes and who is in
  them; enrolling into a full batch is refused
- `POST /api/attendance/mark/` — marks a whole register in one request, since
  that's how a coach actually works; re-marking corrects the day rather than
  double-counting. `/api/attendance/summary/` gives per-student rates.
- `GET/POST /api/billing/plans|invoices|payments/`, `/api/billing/summary/`
- `GET/POST /api/enquiries/`, `POST /api/enquiries/<id>/convert/`,
  `/api/enquiries/funnel/`

An invoice's `status`, `amount_paid` and `balance` are derived from its
payments on read, never stored — a stored status is the classic way for an
invoice to claim it's paid while the payments say otherwise. Payments that
would overpay an invoice are rejected. A Student is deliberately separate from
a Membership: a Membership is a login, a Student is an enrolment record, and
most students (children especially) never have a login.

`python manage.py seed_demo_academy` builds a full demo academy — two
branches, ~48 members, 5 batches, 8 weeks of attendance, 3 months of invoices
and an enquiry pipeline — for clicking through the whole thing.

## Vertical plugins (Phase 5)

`Vertical.IMPLEMENTED` lists the verticals that actually have a plugin behind
them. Dance and football are named in the model because the platform knows
about them, but they can't be selected at signup or in settings, and the API
refuses them — offering an academy a module with nothing behind it is worse
than not listing it. An academy already on a withdrawn vertical keeps it and
can switch it off; it just can't be added to.

Turning a vertical on brings both its modules **and** its settings: pools
appear under Settings only for a swimming academy, the belt ladder only for a
karate one.

Each vertical is its own Django app gated by its own `RequiresVertical`
subclass, so a gym-only academy gets 403 from `/api/swimming/` and
`/api/karate/` while its own `/api/gym/` keeps working. Adding a vertical
means adding an app and two lines in `frontend/src/lib/verticals.js` and
`moduleRegistry.jsx` — the core platform is untouched.

### Swimming (`swimming/`)

- `GET/POST /api/swimming/pools/`, `/api/swimming/lanes/` — lane bookings
- `GET /api/swimming/levels/`, `POST /api/swimming/assessments/`
- `GET /api/swimming/progress/` — every swimmer's position on the ladder

A lane can hold one booking at a time: overlapping slots on the same
pool+lane+day are refused, while a slot starting exactly when another ends is
allowed. A level counts as reached only when *every* skill in it is signed
off, so partial progress never reads as a completed level.
`seed_swim_levels <slug>` loads a standard 5-level ladder.

### Karate (`karate/`)

- `GET/POST /api/karate/belts/`, `/api/karate/gradings/`, `/api/karate/results/`
- `GET/POST /api/karate/bouts/` — sparring records
- `GET /api/karate/standings/` — current belt and win/loss record per student

A student's belt is derived on read as the highest-position belt they have
*passed*, never stored — correcting a grading result corrects the belt.
`seed_belts <slug>` loads the standard kyu ladder.

Without `SUPABASE_DB_HOST` set, the backend falls back to local SQLite so it
runs out of the box.

## Tests

```bash
cd backend && source .venv/bin/activate
python manage.py test          # everything
python manage.py test tests.test_isolation
```

`backend/tests/` covers the invariants that are expensive to be wrong about
and easy to break silently:

| File | What it protects |
|---|---|
| `test_tenancy.py` | subdomain / verified-custom-domain / API-key resolution |
| `test_isolation.py` | one academy never reads or writes another's records |
| `test_roles.py` | member reads, staff runs the academy, owner controls it |
| `test_verticals.py` | plugin gating, including toggling a vertical off and on |
| `test_invitations.py` | invite claiming, the email-verification gate, last owner |
| `test_pagination.py` | response shape, the page-size cap, no row lost or repeated |
| `test_business_rules.py` | invoice status and overpayment, registers, capacity |
| `test_security.py` | private progress photos, JWT rejection, throttle identity |
| `test_plugins.py` | lane double-booking, swim levels, belt derivation, PRs |

Authentication is forced rather than driven through a real Supabase token —
the JWT path has its own tests, and everything else is about what a *known*
identity may do. Tenancy still runs through the real middleware, so every test
resolves its organization from the Host header the way production does.

The suite was checked by breaking things on purpose: removing the tenant
filter fails 6 tests, removing the email-verification gate fails 1, and
dropping the overpayment guard fails 2.

## Pagination

Every list endpoint returns `{count, next, previous, results}`, 50 rows by
default, `?page_size=` up to 200. Applied globally rather than per-view: a list
that is small today is not necessarily small next year, and a silently
truncated list is worse than a paged one.

The frontend has two helpers in `src/lib/api.js`. `apiPage` takes one page —
for big tables like members and invoices. `apiFetchAll` follows `next` until it
runs out, for the places that genuinely need every row: a dropdown, a chart
series, or a register a coach is about to mark, where showing half a class
would mark the rest absent.

Pagination needs a deterministic total order, so every paged model orders by a
unique tiebreaker — without one a row can appear on two pages or on none.

## Production configuration

The backend refuses to start with `DEBUG=False` and a placeholder
`DJANGO_SECRET_KEY` (checked for length and for giveaway markers, since the
likeliest mistake is copying the one out of `.env.example`) or with an empty
`DJANGO_ALLOWED_HOSTS`. With `DEBUG` off it also turns on HSTS, SSL redirect,
secure cookies and `X-Frame-Options: DENY`.

Throttling is on by default — `THROTTLE_ANON` (30/min) and `THROTTLE_USER`
(1000/hour). CORS matches `https://<slug>.<DJANGO_BASE_DOMAIN>` by regex,
because listing literal origins would mean editing settings on every signup.

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
