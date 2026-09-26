# 01 — Architecture

## Shape

One modular monolith. One Postgres database. One deployable.
Compute on a small VPS, database and file storage managed by Supabase.

```
      PWA (React, installable)
              │  https
              ▼
   VPS: Caddy → Next.js app  ──────────►  Razorpay (per-tenant credentials)
       ├─ route handlers                  WhatsApp BSP (per-tenant credentials)
       ├─ services
       ├─ repos  ──────────►  Supabase Postgres (RLS, `app` schema)
       └─ pg-boss workers  ──►  same Postgres
                            ──►  Supabase Storage (signed URLs)
```

**Why compute stays on a VPS:** pg-boss needs a long-running process. Serverless
functions cannot hold a worker open, so invoice generation and WhatsApp sends
would have nowhere to run. One small VPS running the app and the worker is the
simplest thing that works.

You are one person. Every extra moving part is a part you maintain at 11 PM.
No Redis, no message broker, no separate API service, no microservices.
pg-boss gives you a job queue inside the database you already run.

## Why these choices

**Next.js full-stack, not NestJS + separate React.** One repo, one deploy, one
set of types shared between server and client. For a solo developer this is worth
more than architectural purity.

**Drizzle, not Prisma.** You need `SET LOCAL app.tenant_id` to run on the same
connection as your queries, inside a transaction. Drizzle makes that
straightforward; Prisma fights you on connection pinning for RLS.

**Custom auth, not a framework.** You need staff email+password and guardian
phone+OTP, both tenant-scoped, with impersonation and audit. That is ~300 lines
of well-understood code. An auth framework will cost you more in bending it.

**pg-boss, not cron on the server.** You need retries, scheduling and visibility
for invoice generation and WhatsApp sends. Jobs must survive a restart.

## Tenant isolation — the part that must not be wrong

Three layers. A bug must pass all three to leak data.

### Layer 1: `tenant_id` column

Every tenant-scoped table has `tenant_id uuid not null references tenants(id)`.
Composite indexes lead with `tenant_id`.

### Layer 2: Postgres Row-Level Security

```sql
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON students
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

`FORCE` matters: without it, the table owner bypasses RLS. The application must
connect as a role that is **not** the table owner and is **not** superuser.

```sql
-- run once, as the Supabase `postgres` role, in the SQL editor
CREATE SCHEMA IF NOT EXISTS app;

CREATE ROLE app_runtime LOGIN PASSWORD '...' NOBYPASSRLS;
GRANT USAGE ON SCHEMA app TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;

-- keep Supabase's auto-generated API away from our tables entirely
REVOKE ALL ON SCHEMA app FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated;
```

Migrations run as `postgres` (which owns the tables). The app runs as
`app_runtime`, which cannot bypass RLS. Because `postgres` owns the tables,
`FORCE ROW LEVEL SECURITY` is not optional — without it the owner slips past
every policy.

**Never put the `service_role` key in application code.** It bypasses RLS
completely and would make the entire isolation layer decorative. It belongs in
the migration runner's environment and nowhere else.

### Layer 3: request-scoped transaction

Every request that touches tenant data runs inside one transaction that begins by
setting the tenant:

```ts
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
```

`set_config(..., true)` is transaction-local, so a pooled connection cannot carry
one tenant's context into the next request. This is the single most important line
in the codebase.

**Platform-admin queries** use a separate connection role that is exempt from RLS,
through a dedicated `withPlatformAdmin()` helper. Every call through it writes an
audit row. Impersonating a tenant uses `withTenant()` like anyone else, with an
`impersonated_by` field on the audit row.

### The isolation test suite

`pnpm test:isolation` seeds two tenants and, for every tenant-scoped table,
asserts that tenant A's context returns zero rows of tenant B and cannot insert a
row carrying tenant B's id. Write it as a table-driven test that reads the table
list from the schema, so a new table without a policy fails automatically.

## Tenant resolution

Order of precedence:

1. Authenticated session carries `tenant_id` → use it. (Primary path.)
2. Subdomain `demo.yourapp.com` → look up `tenants.slug`, used for the login page
   branding and the public enquiry form.
3. Neither → platform landing page.

Store `slug` from day one. Serve everything from one domain in V1 with a wildcard
DNS record and a wildcard TLS certificate (DNS-01 challenge). Tenant custom
domains are a V3 feature and a support burden.

## Auth

**Staff:** email + password (argon2id), session row in `sessions` table, httpOnly
`SameSite=Lax` cookie holding an opaque token. No JWT. Revocation must be instant
when an owner fires a coach.

**Guardian / adult student:** phone + 6-digit OTP sent over WhatsApp, SMS fallback.
Rate limit: 3 OTPs per phone per 15 minutes, 5 wrong attempts locks for an hour.
OTP hashed in the database, 5-minute expiry, single use.

**Built as** (agreed 2026-09-25; `src/modules/auth/`)

- One login page. On `bravitar.in/login`, staff give email and password; the
  password is checked in each academy with that email, under that academy's
  own 5-in-15-minutes limit, and the academies are named only after it
  matches. Cookies stay per address, so the main site hands over to
  `<slug>.bravitar.in` with a one-time pass (2 minutes, single use, hashed).
  Each academy's own address keeps its own login.
- Forgot password: a 6-digit code on WhatsApp to the phone on the staff
  account (set on My account, behind the password), then a new password; the
  account's sessions end. The main site covers every academy with that email
  and phone. Codes come from one Bravitar number (`PLATFORM_WHATSAPP_*`), never
  an academy's; no SMS yet. The limits above live in the database functions
  `otp_issue` and `otp_check`; the app can't read `otp_codes`.
- Parents and adult students (built 2026-09-26, Prompt 20): the same box
  takes a phone number and sends a WhatsApp code (purpose `portal_login`),
  only to a guardian who may sign in with a child at an active academy; the
  answer is the same for any number. On the main site the code lists the
  academies with that number, each through its one-time pass. The session
  (actor `guardian`, 30 days) keeps the phone the code proved, so "Switch
  academy" needs no new code; the guardian is re-read on every request.

**Session payload assembled on login:**

```jsonc
{
  "actor": { "type": "staff", "id": "...", "name": "Amit" },
  "tenant": { "id": "...", "slug": "abc-karate", "timezone": "Asia/Kolkata" },
  "branchIds": ["..."],
  "isOwner": false,
  "modules": { "attendance": true, "fees": true, "enquiries": true, "credits": false },
  "permissions": ["clients:read", "clients:create", "attendance:mark"]
}
```

Cache this in the session row. Invalidate it whenever roles, permissions, modules
or branch assignments change.

## Authorization — two gates, checked in this order

```ts
function can(ctx, module, permission) {
  if (!ctx.modules[module]) return false;            // 1. tenant feature flag (owner included)
  if (ctx.isOwner) return true;                      // 2. owner bypass
  return ctx.permissions.includes(permission);       // 3. role permissions (union)
}
```

A switched-off module is off for everyone, the owner included: the flag belongs
to the tenant (and its plan), not to the person. `core` is never switched off.

Enforce it in the **service layer**, not only in route handlers, so background
jobs and future entry points can't skip it. Hiding a button in the UI is cosmetic;
the server check is the real one.

Permission keys are `module:action`, e.g. `students:create`, `fees:collect`,
`fees:refund`, `attendance:mark`, `staff:manage`, `reports:view`. The canonical
entity name is **`students`** everywhere in code and database; "Member",
"Client" or "Trainee" are label-pack strings only (see `02-data-model.md` §0).

**Branch scoping** is a third dimension: a staff member assigned to Branch 1 must
not see Branch 2's students. Handle it as an explicit filter in repos, not RLS,
because owners legitimately cross branches.

## Money

- `bigint` paise everywhere. `₹1,500.50` is `150050`.
- Rounding: round half up, at the line level, before summing.
- All arithmetic in `src/lib/money`. No arithmetic on money inside a component.
- Never store a currency symbol. Tenant currency is INR, full stop, for now.

## Time

- `timestamptz`, stored UTC.
- Tenant has `timezone`, default `Asia/Kolkata`.
- Session generation, "today's roster", attendance dates and invoice due dates are
  computed in **tenant local time** and then converted. Getting this wrong means a
  6:00 AM batch shows on the wrong day. Write a test for a 5:30 AM IST session.

## Background jobs (pg-boss)

| Job | Schedule | Does |
|---|---|---|
| `sessions.generate` | nightly | Materialise sessions from batch schedule rules, 60 days ahead |
| `invoices.generate` | nightly | Create invoices due in the next cycle per fee plan |
| `invoices.markOverdue` | nightly | Flip status when past due date |
| `reminders.feeDue` | daily 10:00 IST | WhatsApp reminder, T-3, T+1, T+7 |
| `reminders.absent` | after each session window | Notify guardian if child marked absent |
| `retention.atRisk` | weekly | Flag students with 3+ consecutive absences or 2 unpaid cycles |
| `payments.reconcile` | hourly | Re-poll Razorpay for payments whose webhook never arrived |

Every job is tenant-scoped and runs through `withTenant()`. A job that throws for
one tenant must not stop the others: iterate tenants, catch per tenant, log.

## Offline (PWA)

Keep scope narrow and boring:

- Cache the app shell.
- Cache **today's sessions and rosters** for the logged-in teacher.
- Allow marking attendance offline, queue it in IndexedDB, sync on reconnect.
- Conflict rule: last write wins, but never overwrite a record already marked by a
  different staff member without flagging it in the UI.

Nothing else works offline in V1. Not fees, not enrollment.

How it is built: docs/03 §7 "Offline, agreed 2026-09-24".

## File storage

`StorageAdapter` interface with two implementations: local disk (dev) and
S3-compatible (prod). Store: student photos, fee receipts (PDF), consent
documents, certificates. Signed URLs, 15-minute expiry. Never a public bucket.

## Deployment

Compute on one small VPS (Mumbai region), database and storage on Supabase
(also Mumbai, `ap-south-1`, chosen at project creation and **not changeable
afterwards**).

```
VPS, Docker Compose:
  caddy    → TLS, reverse proxy
  app      → Next.js
  worker   → pg-boss (same image, different command)

Supabase:
  postgres → app schema, RLS
  storage  → photos, receipts, consent documents
```

- Health check endpoint, uptime monitor, error tracking (Sentry or similar).
- Staging is a **second Supabase project** plus a second compose project on the
  same box. Never point staging at the production database.
- When you outgrow this, the move is a bigger VPS and a bigger Supabase compute
  tier. Not a rewrite. Plan nothing beyond that.

### Supabase setup checklist

Do these in order, once, before slice 1:

1. Create the project in **Mumbai (`ap-south-1`)**. The region is permanent.
2. SQL editor: create the `app` schema and the `app_runtime` role as shown in
   section 2.2, and revoke `anon` and `authenticated` from that schema.
3. Dashboard → API settings: remove `app` from the **exposed schemas** list, so
   PostgREST never serves our tables. Verify by hitting the REST URL for a table
   and confirming a 404, not an empty array.
4. Connection strings:
   - **Migration runner** → direct connection, `postgres` role
   - **App and worker** → Supavisor pooler in **transaction mode** (port 6543),
     `app_runtime` role
   - With the transaction pooler, `postgres-js` needs `prepare: false`. Prepared
     statements do not survive transaction pooling and you will get confusing
     intermittent errors without this.
   - `SET LOCAL app.tenant_id` works correctly in transaction mode, because it is
     scoped to the transaction the pooler hands you. Verify this in the slice 1
     isolation test against the pooler URL, not just against local Postgres.
5. Storage: create a **private** bucket. Generate signed URLs server-side using
   the service role, inside the storage adapter only. Bucket policies are not
   your access control; your own permission checks are.
6. Backups: Supabase Pro takes daily backups, and point-in-time recovery is a
   paid add-on. Still run your own weekly `pg_dump` to a **different vendor's**
   storage. Backups living inside the account that could be lost or locked are
   not a disaster recovery plan. Restore one into a scratch project monthly.

### What we deliberately do not use from Supabase

Supabase Auth, Realtime, Edge Functions, and the PostgREST auto-API. Reasons:
Supabase Auth makes email unique per project, while we need it unique per tenant;
our guardians log in with a WhatsApp OTP rather than an SMS provider; and the
browser-talks-directly-to-Postgres model conflicts with the server-side tenant
context this whole architecture rests on. Mixing the two models is the single
most likely way to create a cross-tenant leak.

Everything we use is plain PostgreSQL, so leaving Supabase later is a `pg_dump`
and a connection string change, not a migration project.

## Testing priorities

1. Tenant isolation (blocking, runs on every commit)
2. Money: invoice totals, partial payment allocation, discount, refund
3. Attendance: roster generation, timezone edge cases
4. Permissions: each preset role against each route
5. Webhooks: signature verification, replay, out-of-order events

Everything else can wait. These five are where a bug costs you a customer.

## Document numbering — gapless, per tenant, per financial year

Invoice and receipt numbers must have **no gaps**, per tenant, per branch, per
Indian financial year (April–March). Accountants and auditors check this.

Do **not** use a Postgres sequence: sequences gap on rollback. Use a counter row
updated inside the same transaction as the insert:

```sql
UPDATE number_series
   SET next_value = next_value + 1
 WHERE tenant_id = $1 AND branch_id = $2 AND kind = $3 AND fy = $4
RETURNING next_value - 1 AS assigned;
```

The `UPDATE ... RETURNING` takes a row lock, so concurrent issuers serialise.
Format as `INV/2026-27/0001`. Voiding an invoice keeps the number and marks it
void; it never frees the number for reuse.

## Who holds the money

Each tenant connects **their own Razorpay account**. Credentials are stored
encrypted per tenant, settlement goes to the academy's own bank account.

Do not route academy fees through your own Razorpay account and pay academies
later. In India that is an unlicensed payment-aggregator posture, and it also
makes you liable for every refund dispute between a parent and an academy. If you
later want a platform commission, the correct mechanism is Razorpay Route with
linked sub-accounts, and that is a V3 decision.

Payment integration is phased:

1. **V1 — ledger only.** Cash, UPI (recorded manually), bank transfer, cheque.
   Staff records the payment, the system issues a numbered receipt and WhatsApps it.
2. **V1.5 — Razorpay Payment Links** per invoice. One API call, a short URL sent
   on WhatsApp, one webhook marks it paid. No mandates, no card storage, no PCI
   surface.
3. **V2 — Subscriptions / e-mandate auto-debit**, only for tenants who ask.
   Mandate setup friction and failure rates are high in this segment; do not make
   it the default path.

## Compliance — you are handling children's data

Most of your data subjects are minors. Under the DPDP Act 2023 this is the
highest-duty category, so build it in now rather than retrofitting.

- **Verifiable guardian consent** captured at student creation: who consented,
  when, for what purpose, from which IP. Stored, not assumed.
- **Photograph consent is separate and revocable.** Check the flag before a photo
  is displayed anywhere outside the staff app.
- **Export and erasure** for a single student, self-serve for the tenant.
- **You are a processor for your tenants.** Include a one-page data processing
  addendum in the tenant terms, and give tenants a full data export on demand.
  Their data is theirs; making it hard to leave buys you nothing.
- Audit log is append-only. No update path, no delete path, no admin override.
- No personal data in URLs or query strings — it ends up in access logs.
