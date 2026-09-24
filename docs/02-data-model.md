# 02 — Data Model

PostgreSQL 16+. This is the V1 schema. It is designed so that V2 (gym/swimming
booking + credits) is **additive**: no table here has to be renamed or split.

Read `01-architecture.md` for the RLS rules that apply to every table below.

---

## 0. Naming decisions (settle these once, never revisit)

| Concept | Table | Why |
|---|---|---|
| The person attending | `students` | Label pack renders "Member", "Trainee", "Client" per vertical |
| The person paying | `guardians` + `households` | Payer, login and attendee are three different people |
| The thing taught | `programs` | "Karate", "Class 9 Maths", "Hifz", "Bharatanatyam" |
| A specific group + timing | `batches` | "Karate Batch B, Mon/Wed/Fri 6 PM" |
| One occurrence | `sessions` | Generated from the batch schedule |
| Staff | `staff_users` | Teachers, coaches, front desk, owner |

An adult student with no guardian still gets a household with themselves as the
sole guardian. Do not special-case it; keep one billing path.

---

## 1. Conventions on every table

```sql
id            uuid primary key default gen_random_uuid()  -- app passes UUIDv7
tenant_id     uuid not null references tenants(id) on delete restrict
created_at    timestamptz not null default now()
updated_at    timestamptz not null default now()
created_by    uuid                                        -- staff_users.id, nullable for system
deleted_at    timestamptz                                 -- soft delete
```

- `on delete restrict` on `tenant_id`, not `cascade`. Deleting a tenant must be a
  deliberate, audited, export-first operation — never a stray cascade.
- Every query filters `deleted_at is null` unless explicitly restoring.
- Money columns are `bigint`, named `*_paise`.
- Every composite index starts with `tenant_id`.

> **Migration ordering.** The DDL below is grouped by domain for readability, so
> a few foreign keys point forward (`batches.default_fee_plan_id` → `fee_plans`,
> `enquiries.program_id` → `programs`, `trial_attendances.session_id` → `sessions`).
> In the actual migrations, either create tables in dependency order or add those
> constraints in a follow-up `ALTER TABLE`. Do not reorder the sections here.

Extensions and schema:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email

-- every table below lives in `app`, never in `public`
CREATE SCHEMA IF NOT EXISTS app;
SET search_path TO app, public;
```

> **Supabase note.** On Supabase both extensions are already available, usually
> installed into the `extensions` schema, so `CREATE EXTENSION IF NOT EXISTS` is
> a no-op rather than an error. Tables go in `app` and not `public` because
> Supabase exposes `public` through its auto-generated PostgREST API. Keeping our
> tables out of that schema, and out of the exposed-schemas list, means the API
> we did not ask for cannot serve data we did not intend to publish.

---

## 2. Platform layer (not tenant-scoped, no RLS)

```sql
CREATE TABLE platform_admins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE NOT NULL,
  password_hash text NOT NULL,
  totp_secret   text NOT NULL,
  full_name     text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_plans (
  code            text PRIMARY KEY,              -- 'starter' | 'growth' | 'pro'
  name            text NOT NULL,
  price_paise     bigint NOT NULL,
  billing_cycle   text NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  max_students    integer,                       -- NULL = unlimited
  max_staff       integer,
  max_branches    integer,
  included_modules jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active       boolean NOT NULL DEFAULT true
);

CREATE TABLE tenant_subscriptions (           -- what the ACADEMY pays YOU
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  plan_code     text NOT NULL REFERENCES platform_plans(code),
  status        text NOT NULL CHECK (status IN ('trial','active','past_due','suspended','cancelled')),
  trial_ends_at timestamptz,
  period_end    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

Keep **your** billing of tenants completely separate from **tenants'** billing of
students. They share no tables. Conflating them is a classic SaaS mistake.

---

## 3. Tenant and configuration

```sql
CREATE TABLE tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            citext UNIQUE NOT NULL,        -- subdomain, immutable after creation
  vertical_preset text NOT NULL DEFAULT 'general', -- karate|dance|tuition|deeniyat|sports|general
  timezone        text NOT NULL DEFAULT 'Asia/Kolkata',
  locale          text NOT NULL DEFAULT 'en-IN',
  currency        char(3) NOT NULL DEFAULT 'INR',
  fy_start_month  smallint NOT NULL DEFAULT 4,   -- April
  enabled_modules jsonb NOT NULL DEFAULT '{
    "students":true,"batches":true,"attendance":true,"fees":true,
    "enquiries":true,"messaging":true,"reports":true,
    "progression":false,"credits":false,"bookings":false,"pos":false
  }'::jsonb,
  label_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL,
  address     text,
  phone       text,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX ON branches (tenant_id) WHERE is_default AND deleted_at IS NULL;

CREATE TABLE tenant_integrations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind           text NOT NULL CHECK (kind IN ('razorpay','whatsapp')),
  credentials    bytea NOT NULL,        -- encrypted blob, NEVER plain text, NEVER logged
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active      boolean NOT NULL DEFAULT true,
  connected_at   timestamptz,
  last_error     text,
  UNIQUE (tenant_id, kind)
);
```

---

## 3a. Label packs

`tenants.vertical_preset` picks a pack; `tenants.label_overrides` edits it. The
canonical entity names (`students`, `staff_users`, `batches`, `sessions`,
`programs`) never change in code or database — only what the screen calls them.

| preset   | student | staff      | batch | session | program |
|----------|---------|------------|-------|---------|---------|
| general  | Student | Staff      | Batch | Session | Program |
| tuition  | Student | Teacher    | Batch | Class   | Subject |
| deeniyat | Student | Teacher    | Batch | Class   | Course  |
| karate   | Student | Coach      | Batch | Class   | Program |
| dance    | Student | Instructor | Batch | Class   | Course  |
| sports   | Player  | Coach      | Group | Session | Program |

Each key has `one` and `many` forms (`Class` / `Classes`). Overrides are partial
and per key: `{"staff": {"one": "Sensei"}}` changes only that word. Unknown keys
are ignored. `resolveLabels(tenant)` in `src/lib/tenant/labels.ts` is the only
place this merge happens. English only at launch; a language dimension is added
when Hindi and Marathi arrive.

## 4. Auth and RBAC

```sql
CREATE TABLE permissions (               -- global, seeded from code, no tenant_id
  key         text PRIMARY KEY,          -- 'students:create'
  module      text NOT NULL,             -- 'students'
  description text NOT NULL
);

CREATE TABLE staff_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  email         citext NOT NULL,
  phone         text,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  is_owner      boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (tenant_id, email)
);

CREATE TABLE staff_branches (
  staff_id  uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  PRIMARY KEY (staff_id, branch_id)
);
-- no rows for a staff member = access to all branches

CREATE TABLE roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name       text NOT NULL,              -- Owner | Manager | Teacher | Front Desk
  is_system  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE role_permissions (
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  role_id        uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions(key),
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE staff_roles (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  staff_id  uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  role_id   uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, role_id)
);

CREATE TABLE sessions_auth (             -- named to avoid clashing with class sessions
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text UNIQUE NOT NULL,
  actor_type    text NOT NULL CHECK (actor_type IN ('platform','staff','guardian')),
  actor_id      uuid NOT NULL,
  tenant_id     uuid,                    -- null for platform admins
  impersonated_by uuid,                  -- platform_admins.id when impersonating
  cached_context jsonb,                  -- modules + permissions snapshot
  ip            inet,
  user_agent    text,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  purpose     text NOT NULL,             -- 'portal_login'
  attempts    smallint NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON otp_codes (phone, created_at DESC);
```

> **Careful:** `sessions_auth` is deliberately NOT called `sessions`. The class
> `sessions` table below is one of the most-queried tables in the product. Two
> things called "session" in one codebase will cost you hours.

---

## 5. People

```sql
CREATE TABLE households (                -- the billing unit
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL,             -- "Sharma family" — auto-generated, editable
  address     text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE guardians (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  full_name     text NOT NULL,
  phone         text NOT NULL,           -- E.164, the portal login identifier
  email         citext,
  can_login     boolean NOT NULL DEFAULT true,
  is_primary    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (tenant_id, phone)
);

CREATE TABLE students (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  branch_id     uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  code          text NOT NULL,           -- human-facing ID, e.g. ABC/2026/0142
  full_name     text NOT NULL,
  date_of_birth date,
  gender        text,
  phone         text,                    -- adult students only
  photo_key     text,                    -- storage key, not a URL
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','paused','left','prospect')),
  joined_on     date NOT NULL DEFAULT CURRENT_DATE,
  left_on       date,
  left_reason   text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- vertical-specific fields
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (tenant_id, code)
);
CREATE INDEX ON students (tenant_id, branch_id, status) WHERE deleted_at IS NULL;
CREATE INDEX ON students (tenant_id, household_id);

CREATE TABLE student_guardians (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  guardian_id uuid NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  relation    text NOT NULL,             -- father | mother | self | other
  PRIMARY KEY (student_id, guardian_id)
);

CREATE TABLE consents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id    uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  guardian_id   uuid REFERENCES guardians(id),
  kind          text NOT NULL CHECK (kind IN ('data_processing','photo','medical','waiver')),
  granted       boolean NOT NULL,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  granted_ip    inet,
  method        text NOT NULL,           -- 'portal' | 'paper' | 'staff_recorded'
  document_key  text,                    -- scan of a signed paper form
  revoked_at    timestamptz
);
```

`students.metadata` holds vertical-specific fields (school grade for tuition,
belt for karate, medical notes for sports). Keep it to **display and filter**
data. Anything you need to compute on, join on, or bill on gets a real column.

---


### Slice 6 addendum (agreed 2026-09-21)

- `students.code` is `PREFIX/YYYY/0001`. The prefix lives in `tenants.code_prefix`
  (2–5 upper-case letters, defaulted from the academy's initials, editable in
  Settings). The counter is `student_code_series (tenant_id, year, next_value)`,
  per tenant per calendar year, allocated with `UPDATE … RETURNING` under the row
  lock; `number_series` (per branch, per financial year) is for invoices and
  receipts only.
- `students.code_edited_at` records the one allowed manual edit; after that the
  code is locked.
- `students.left_reason` is one of `moved_away | fees | timing | lost_interest |
  completed | health | other`; `other` needs `left_note`.
- Students are never hard-deleted: `deleted_at` is set only while there is no
  attendance, invoice or payment history; otherwise `status = 'left'`.

---

## 6. Enquiries and trials

The module most likely to make an owner say yes. Do not cut it.

```sql
CREATE TABLE enquiries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  branch_id       uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name            text NOT NULL,
  phone           text NOT NULL,
  email           citext,
  source          text,                  -- walk_in | whatsapp | referral | instagram | poster
  program_id      uuid REFERENCES programs(id),
  batch_id        uuid REFERENCES batches(id),
  status          text NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new','contacted','trial_booked','trial_done','won','lost')),
  lost_reason     text,
  owner_staff_id  uuid REFERENCES staff_users(id),
  next_follow_up  date,
  converted_student_id uuid REFERENCES students(id),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX ON enquiries (tenant_id, status, next_follow_up);

CREATE TABLE enquiry_activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  enquiry_id  uuid NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  kind        text NOT NULL,             -- call | whatsapp | visit | note | status_change
  note        text,
  staff_id    uuid REFERENCES staff_users(id),
  happened_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trial_attendances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  enquiry_id  uuid NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  session_id  uuid REFERENCES sessions(id),
  trial_date  date NOT NULL,
  attended    boolean,
  feedback    text
);
```

---

## 7. Programs, batches, schedule, sessions

```sql
CREATE TABLE programs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL,             -- 'Karate', 'Class 9 Maths', 'Hifz'
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE resources (                 -- rooms, halls, grounds, courts. Pool lanes in V2.
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  branch_id   uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name        text NOT NULL,
  capacity    integer,
  deleted_at  timestamptz
);

CREATE TABLE batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  branch_id       uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  program_id      uuid NOT NULL REFERENCES programs(id) ON DELETE RESTRICT,
  name            text NOT NULL,         -- 'Beginners Evening'
  coach_id        uuid REFERENCES staff_users(id),   -- default teacher
  resource_id     uuid REFERENCES resources(id),
  capacity        integer,               -- NULL = unlimited
  enrollment_mode text NOT NULL DEFAULT 'roster'
                  CHECK (enrollment_mode IN ('roster','booking')),  -- 'booking' unlocks in V2
  default_fee_plan_id uuid REFERENCES fee_plans(id),
  start_date      date NOT NULL,
  end_date        date,
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','paused','ended')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX ON batches (tenant_id, branch_id, status);

CREATE TABLE batch_schedules (           -- recurring weekly rule
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  batch_id       uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  weekday        smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Sunday
  start_time     time NOT NULL,          -- LOCAL time in tenant timezone
  end_time       time NOT NULL,
  effective_from date NOT NULL,
  effective_to   date,
  CHECK (end_time > start_time)
);

CREATE TABLE holidays (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  branch_id  uuid REFERENCES branches(id),   -- NULL = all branches
  date       date NOT NULL,
  name       text NOT NULL,
  UNIQUE (tenant_id, branch_id, date)
);

CREATE TABLE sessions (                  -- one actual occurrence
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  branch_id   uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  batch_id    uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  coach_id    uuid REFERENCES staff_users(id),     -- override for a substitute
  resource_id uuid REFERENCES resources(id),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  session_date date NOT NULL,            -- LOCAL date, denormalised for fast day queries
  status      text NOT NULL DEFAULT 'scheduled'
              CHECK (status IN ('scheduled','held','cancelled')),
  cancel_reason text,
  notes       text,                      -- what was actually taught
  generated   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, starts_at)           -- makes generation idempotent
);
CREATE INDEX ON sessions (tenant_id, session_date, branch_id);
CREATE INDEX ON sessions (tenant_id, coach_id, session_date);

CREATE TABLE enrollments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id   uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  batch_id     uuid NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
  fee_plan_id  uuid REFERENCES fee_plans(id),
  status       text NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','paused','left','transferred')),
  start_date   date NOT NULL,
  end_date     date,
  transferred_to_enrollment_id uuid REFERENCES enrollments(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON enrollments (tenant_id, batch_id, status);
CREATE INDEX ON enrollments (tenant_id, student_id, status);
```

**Session generation rule.** A nightly job materialises sessions 21–60 days ahead
from `batch_schedules`, skipping `holidays`. `UNIQUE (batch_id, starts_at)` makes
it safe to re-run. Changing a schedule regenerates only **future** sessions that
have no attendance rows; past sessions are history and are never rewritten.

**Batch transfer** (the "shift from 6 PM to 7 PM" case, which will happen in your
first week of pilot): close the old enrollment with `status='transferred'`, create
a new one, link via `transferred_to_enrollment_id`. Never mutate `batch_id` on an
existing enrollment — it would silently rewrite attendance history.

---

## 8. Attendance

```sql
CREATE TABLE attendance (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  status      text NOT NULL CHECK (status IN ('present','absent','late','excused')),
  marked_by   uuid REFERENCES staff_users(id),
  marked_at   timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','offline_sync','portal','kiosk')),
  note        text,
  UNIQUE (session_id, student_id)        -- also the offline idempotency key
);
CREATE INDEX ON attendance (tenant_id, student_id, marked_at DESC);
```

Unmarked means **no row**, not `absent`. "Teacher forgot" and "child did not come"
are different facts and the owner needs to tell them apart.

---

## 9. Fees, invoices, payments

```sql
CREATE TABLE fee_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  program_id        uuid REFERENCES programs(id),
  name              text NOT NULL,       -- 'Karate Monthly', 'Maths Term Fee'
  billing_cycle     text NOT NULL CHECK (billing_cycle IN ('monthly','quarterly','half_yearly','yearly','one_time')),
  amount_paise      bigint NOT NULL CHECK (amount_paise >= 0),
  admission_fee_paise bigint NOT NULL DEFAULT 0,
  billing_day       smallint NOT NULL DEFAULT 1 CHECK (billing_day BETWEEN 1 AND 28),
  grace_days        smallint NOT NULL DEFAULT 7,
  late_fee_paise    bigint NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE TABLE discounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL,             -- 'Sibling 10%', 'Zakat waiver', 'Staff child'
  kind        text NOT NULL CHECK (kind IN ('percent','amount')),
  value       integer NOT NULL,          -- percent 0-100, or paise
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE student_discounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  discount_id uuid NOT NULL REFERENCES discounts(id) ON DELETE RESTRICT,
  reason      text,
  valid_from  date NOT NULL DEFAULT CURRENT_DATE,
  valid_to    date,
  approved_by uuid REFERENCES staff_users(id)
);

CREATE TABLE number_series (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  branch_id   uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  kind        text NOT NULL CHECK (kind IN ('invoice','receipt')),
  fy          text NOT NULL,             -- '2026-27'
  prefix      text NOT NULL,
  next_value  integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, branch_id, kind, fy)
);
-- Built without branch_id (agreed 2026-09-24): one series per academy,
-- PRIMARY KEY (tenant_id, kind, fy). A per-branch series is a later migration.

CREATE TABLE invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  branch_id       uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  household_id    uuid NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  student_id      uuid REFERENCES students(id),      -- NULL for a combined family invoice
  number          text NOT NULL,                     -- 'INV/2026-27/0042'
  fy              text NOT NULL,
  period_start    date,
  period_end      date,
  issue_date      date NOT NULL DEFAULT CURRENT_DATE,
  due_date        date NOT NULL,
  subtotal_paise  bigint NOT NULL DEFAULT 0,
  discount_paise  bigint NOT NULL DEFAULT 0,
  tax_paise       bigint NOT NULL DEFAULT 0,
  total_paise     bigint NOT NULL DEFAULT 0,
  paid_paise      bigint NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'issued'
                  CHECK (status IN ('draft','issued','part_paid','paid','overdue','void')),
  void_reason     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);
CREATE INDEX ON invoices (tenant_id, status, due_date);
CREATE INDEX ON invoices (tenant_id, household_id, status);

CREATE TABLE invoice_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  invoice_id    uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  enrollment_id uuid REFERENCES enrollments(id),
  student_id    uuid REFERENCES students(id),
  kind          text NOT NULL CHECK (kind IN ('tuition','admission','exam','late_fee','item','other')),
  description   text NOT NULL,
  quantity      integer NOT NULL DEFAULT 1,
  unit_paise    bigint NOT NULL,
  discount_paise bigint NOT NULL DEFAULT 0,
  amount_paise  bigint NOT NULL
);

CREATE TABLE payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  branch_id         uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  household_id      uuid NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  receipt_number    text NOT NULL,
  fy                text NOT NULL,
  method            text NOT NULL CHECK (method IN ('cash','upi','bank_transfer','cheque','card','online')),
  amount_paise      bigint NOT NULL CHECK (amount_paise > 0),
  received_at       timestamptz NOT NULL DEFAULT now(),
  received_by       uuid REFERENCES staff_users(id),
  reference         text,                -- UPI ref, cheque no, bank UTR
  gateway_payment_id text,               -- Razorpay payment id (V1.5)
  status            text NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN ('pending','confirmed','failed','refunded')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, receipt_number)
);
CREATE INDEX ON payments (tenant_id, received_at DESC);

CREATE TABLE payment_allocations (       -- one payment can settle several invoices
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  payment_id  uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  UNIQUE (payment_id, invoice_id)
);

CREATE TABLE refunds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  payment_id  uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  reason      text NOT NULL,
  approved_by uuid REFERENCES staff_users(id),
  refunded_at timestamptz NOT NULL DEFAULT now()
);
-- Built as (agreed 2026-09-24, migration 0015, rules in docs/03 §9):
-- payments: received_on (printed on the receipt) and recorded_on (the collection
--   sheet's day), both dates, in place of received_at; request_id, unique per
--   tenant, so a double tap is one payment; status adds 'cancelled' with
--   cancelled_at, cancelled_by, cancel_reason. Only status and those three can
--   ever be updated.
-- payment_allocations: an append-only ledger instead of one row per (payment,
--   invoice). kind receipt | advance puts money on an invoice; refund | void |
--   cancel takes it back with a negative amount. paid_paise is the invoice's sum.
-- refunds: add method, reference and refunded_on (the sheet's day). Append-only.
-- invoices: database checks keep paid_paise between 0 and total_paise, and
--   status in step with it (invariant 4).
```

**Invariants that must hold and must be tested:**

1. `invoices.paid_paise = sum(payment_allocations.amount_paise)` for that invoice,
   counting only `payments.status = 'confirmed'`.
2. `sum(allocations for a payment) <= payments.amount_paise`. The remainder is an
   unallocated advance, which is legitimate and must be visible in the UI.
3. `invoice.total_paise = sum(lines.amount_paise) - discount + tax`.
4. Status is **derived** from `paid_paise` vs `total_paise`, never set by hand.
5. A paid invoice cannot be edited. Void it and issue a new one.

---

## 10. Messaging

```sql
CREATE TABLE message_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  key            text NOT NULL,          -- fee_due | fee_overdue | receipt | absent | holiday | welcome
  channel        text NOT NULL DEFAULT 'whatsapp',
  language       text NOT NULL DEFAULT 'en',
  body           text NOT NULL,          -- with {{student_name}} style variables
  provider_template_name text,           -- the BSP-approved name
  is_active      boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, key, language)
);

CREATE TABLE message_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  to_phone      text NOT NULL,
  channel       text NOT NULL,
  template_key  text,
  variables     jsonb,
  related_type  text,                    -- 'invoice' | 'attendance' | 'enquiry'
  related_id    uuid,
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','sent','delivered','read','failed')),
  provider_message_id text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);
CREATE INDEX ON message_log (tenant_id, created_at DESC);
```

---

## 11. System tables

```sql
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid,                      -- NULL for platform-level actions
  actor_type  text NOT NULL,
  actor_id    uuid,
  impersonated_by uuid,
  action      text NOT NULL,             -- 'payment.create', 'role.update'
  entity_type text,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          inet,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (tenant_id, at DESC);
CREATE INDEX ON audit_log (tenant_id, entity_type, entity_id, at DESC);
-- append only: GRANT only INSERT and SELECT to app_runtime on this table

CREATE TABLE webhook_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL,
  provider_event_id text NOT NULL,
  payload       jsonb NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  error         text,
  UNIQUE (provider, provider_event_id)   -- this unique index IS the idempotency
);
-- Built with tenant_id (agreed 2026-09-25, migration 0016): a payload is the
-- academy's data, so RLS applies; unique (tenant_id, provider, provider_event_id);
-- only processed_at and error are ever updated. Came with it: payment_links (one
-- live Razorpay link per invoice; only status and closed_at change) and
-- refunds.gateway_refund_id (a Razorpay refund recorded once).

CREATE TABLE files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  storage_key text NOT NULL,
  kind        text NOT NULL,             -- photo | receipt | consent | document
  mime        text NOT NULL,
  size_bytes  bigint NOT NULL,
  related_type text,
  related_id  uuid,
  uploaded_by uuid REFERENCES staff_users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

pg-boss creates and owns its own tables in a `pgboss` schema. Do not hand-write them.

---

## 12. V2 additions (do not build now, just don't block them)

Adding gym and swimming later requires only these, and nothing above changes:

```sql
-- credit packs / punch cards
credit_packs, student_credits, credit_ledger
-- slot booking against a session
bookings (session_id, student_id, status, booked_at, cancelled_at)
waitlist_entries (session_id, student_id, position)
-- generic progression: belts, swim levels, syllabus milestones
progression_tracks, progression_levels, student_progressions
```

`batches.enrollment_mode = 'booking'` is the switch that turns a batch from a
fixed roster into a bookable slot. That single column is why V2 is additive.

---

## 13. Applying RLS

For **every** table above that has a `tenant_id` column:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <t>
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Excluded (no `tenant_id`, platform-owned): `platform_admins`, `platform_plans`,
`permissions`, `webhook_events`, `otp_codes`, `sessions_auth`.
These are protected by code paths and grants instead, and each one needs an
explicit comment in the migration saying why it has no policy.

`audit_log` has a nullable `tenant_id` and **does** get the standard policy: a
tenant reads and writes only rows tagged with itself, platform-level rows
(`tenant_id IS NULL`) are written by the platform role only. Append-only is
enforced by revoking UPDATE and DELETE from both application roles.

Write the migration that applies RLS as a loop over
`information_schema.columns WHERE column_name = 'tenant_id'`, so it can be re-run
after any new table is added and nothing is ever forgotten.
