# Bravitar — Project Plan (Academy Management SaaS Platform)

## 1. Vision

Ek **plugin-based, multi-vertical SaaS platform** jo har tarah ke sports/fitness
academy owners ko ek hi jagah se apna business chalane deta hai — chahe wo gym
ho, swimming academy ho, dance class ho, karate school ho, football academy ho,
ya koi aur sport/fitness business.

Owner signup ke time apna business type (vertical) select karta hai, aur system
usi hisaab se relevant dashboard, features aur modules activate kar deta hai —
bina kisi unnecessary complexity ke.

Inspiration: [wger](https://github.com/wger-project/wger) aur
[openGym](https://gitlab.com/DuarteSantos8/opengym) (fitness tracking features
ke liye), aur OpenEduCat, ArenaFlow, ERPNext, EduSys ERP (multi-module,
plugin-based, business-management architecture ke liye).

---

## 2. Target Users

- Gym owners
- Swimming academy/class owners
- Dance class/academy owners
- Karate / martial arts school owners
- Football academy owners
- Aur generally, koi bhi sport/fitness academy jo apne members, batches,
  attendance, fees, aur coaching operations ko digitize karna chahta hai

Common pain points jo solve karne hain: manual paperwork/spreadsheets, scattered
communication, fee collection tracking, enquiry-to-enrollment leakage,
attendance tracking, batch/schedule management.

---

## 3. Tech Stack

| Layer | Choice |
|---|---|
| Backend | Django + Django REST Framework (DRF) |
| Frontend | React |
| Database | PostgreSQL (hosted on Supabase) |
| Auth | Supabase Auth (JWT-based; verified in Django via custom DRF authentication class) |
| Hosting | Web app, to be deployed later (TBD) |
| Version control | GitHub |

**Approach:** Built from scratch (not forking wger/openGym/OpenEduCat code) for
full control over architecture, even though it takes longer.

---

## 4. Core Architecture

### 4.1 Multi-tenancy

```
Organization (an academy owner's account)
  └── Branch 1, Branch 2, ... (physical locations)
        └── Members/Students, Batches, Staff, Schedules, Attendance, Fees
```

- One Organization = one academy owner (business), can have multiple Branches
- Subscription/plan/billing lives at the Organization level
- Data (members, batches, etc.) is scoped to a Branch

### 4.2 Plugin System

- At signup, an Organization selects one or more **verticals** (Gym, Swimming,
  Dance, Karate, Football, etc.)
- Only the modules relevant to the selected vertical(s) are shown in the
  dashboard/menu
- Each vertical is implemented as its own set of Django apps ("plugin"), so
  adding a new sport/vertical later means plugging in new apps without
  touching the core platform
- Modules can be enabled/added later from settings (no forced bundling —
  same philosophy as OpenEduCat)

### 4.3 Core Platform Apps (shared across all verticals)

- `organizations` — Organization + Branch models, subscription/plan info
- `accounts` — Supabase JWT authentication, user-organization-role linking
- `students` (generic) — trainee/member profiles usable by any vertical
- `batches` — classes/groups/schedules, generic across verticals
- `attendance` — check-in tracking, generic
- `billing` — fee collection, invoices, payment tracking
- `enquiries` — enquiry-to-enrollment pipeline (leads, trials, conversions)

### 4.4 API Access & Custom Domains

**Multi-tenancy routing:** confirmed to use **subdomains**
(`orgname.bravitar.com`) rather than URL paths (`bravitar.com/orgname/...`).
This is required for the custom-domain white-labeling flow below to work
naturally (a customer's CNAME points at their `orgname.bravitar.com`), keeps
cookie/session scoping clean, and avoids the rework a path-based scheme would
need later. Requires wildcard DNS (`*.bravitar.com`) and a wildcard SSL cert.

Two additional access modes, on top of the standard Bravitar-hosted frontend
(`org-slug.bravitar.com`):

**A. Headless API access** — a customer builds their own frontend (web, mobile,
whatever) and talks directly to Bravitar's backend.
- Each Organization can generate an **API Key** (separate from Supabase JWT
  auth used by the standard frontend)
- A custom DRF authentication class validates the `X-API-Key` header and
  scopes every request to that Organization
- Rate limiting via DRF throttling (tiered by plan)
- Public API docs (auto-generated, e.g. via drf-spectacular)

**B. White-labeling / custom domain** — Bravitar's own frontend is served, but
on the customer's own domain (e.g. `app.customergym.com`) instead of a
`bravitar.com` subdomain.
- `Organization` model carries a `custom_domain` field + `domain_verified` flag
- Customer verifies ownership via a DNS TXT record, then points a CNAME at
  Bravitar's edge
- A reverse proxy (Caddy or Traefik) handles automatic per-domain SSL via
  Let's Encrypt
- A Django middleware resolves the request's `Host` header (or subdomain, or
  API key) to the correct Organization — same backend, same database, same
  DRF views regardless of entry point

**Monetization angle:** both API access and custom domains can be gated to
paid tiers — free tier gets `slug.bravitar.com` only, paid tiers unlock API
access and/or white-labeled custom domains.

### 4.5 Vertical Plugin: Gym / Fitness (first one being built)

Feature set merged from wger + openGym:

**From wger:**
- Nutrition tracking — diet plans, food database, calorie logging
- Body measurements (beyond weight) + progress photo gallery
- Gym/multi-user management (trainers, members)
- Full REST API

**From openGym:**
- Guided workout sessions — pre-filled weights from last session, rest
  timer, PR detection
- Muscle map — balance / fatigue / strength views
- Per-routine progression rules (Linear, Greyskull LP, double progression)
- Supersets & cardio pairing
- RIR/RPE effort rating per set
- Warm-up sets excluded from calculations
- Estimated 1RM
- Routine sharing (export/import, merge not overwrite)
- Activity heatmap (GitHub-style)
- Passkey login option

**Django apps for this plugin:** `exercises`, `workouts`, `nutrition`,
`bodylog`, `gym`

---

## 5. Build Phases

### Phase 0 — Foundation (in progress)
- Django project scaffolded
- Supabase Auth JWT verification wired up
- Supabase PostgreSQL connection configured
- GitHub repository setup

### Phase 1 — Core Platform
- `organizations` app: Organization + Branch models, including `slug`,
  `custom_domain`, and `domain_verified` fields from the start
- `APIKey` model tied to Organization
- Tenant-resolution middleware (subdomain, custom domain, or API key → Organization)
- Plugin/vertical selection at signup
- Role-based access (owner, staff/trainer, member) within an Organization
- Basic dashboard shell that adapts to selected vertical(s)

### Phase 2 — Gym/Fitness Plugin (MVP)
- Exercise database (models + API + seed data)
- Workout routines + logging
- React frontend: auth flow + exercise list + routine builder

### Phase 3 — Gym/Fitness Plugin (Full)
- Guided workout sessions (pre-fill, timer, PR detection)
- Body weight/measurements + progress photos
- Nutrition module
- Muscle map, progression rules, supersets, 1RM, heatmap

### Phase 4 — Cross-Vertical Core Features
- Generic students/batches/attendance apps usable by any vertical
- Fee collection & billing
- Enquiry-to-enrollment pipeline
- Multi-branch support end-to-end

### Phase 5 — Additional Verticals
- Swimming, Dance, Karate, Football plugins (built on the same core platform
  pattern as the Gym plugin)

### Phase 6 — Polish & Deploy
- Multilingual support
- Production deployment
- Billing/subscription plans for the SaaS itself

---

## 6. Open Decisions (to revisit later)

- Pricing/subscription model for the SaaS (free tier vs paid tiers)
- Which tiers get API access and/or custom domain white-labeling
- Deployment target (cloud provider, domain, etc.) — including where the
  reverse proxy (Caddy/Traefik) will run for custom domain SSL
- Mobile app strategy (native vs PWA)
