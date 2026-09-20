# 06 — Claude Code Prompts

Copy-paste prompts, in order. Each one is sized to produce something you can
review in 15 minutes. Run them in separate sessions where marked.

Claude Code reference: https://code.claude.com/docs/en/overview

---

## How to work (read this once)

**Setup**

1. Put `CLAUDE.md` at the repo root and this `docs/` folder beside it before your
   first prompt. Claude Code reads `CLAUDE.md` automatically at session start.
2. Start every task in **plan mode**. Read the plan, correct it, then let it build.
   The 90 seconds you spend reading a plan is the cheapest bug fix available.
3. Split long work across sessions. A fresh session with a clear prompt beats a
   long session where the early context has drifted.
4. Commit after every prompt that passes review. Small commits, plain messages.

**Rules of engagement**

- If the output is more than ~6 files, stop it and ask for the first half only.
- After every task: `pnpm typecheck && pnpm test`. Ask it to paste the real output,
  not a summary.
- When a fix feels mediocre, say: *"knowing what you know now, scrap this and
  implement the clean version."* This works better than iterating on a bad base.
- When something touches money, auth or tenant isolation, say: *"before writing
  code, list the ways this could go wrong and how you'll test each one."*
- Never accept "tests pass" without seeing the output. Not because it lies on
  purpose, but because a skipped test suite prints something that looks like a pass.

**Useful things to put in `.claude/commands/`** (your own slash commands):

- `/isolation` → "Add a tenant isolation test for the tables I just created,
  following the pattern in `src/modules/*/`.test.ts`."
- `/review` → "Review the last commit against `CLAUDE.md`'s Definition of Done.
  List violations. Don't fix anything yet."
- `/slice` → "Implement this as one vertical slice: migration, repo, service,
  route, UI, test. Stop after the migration and show me."

---

## Prompt 0 — Repo bootstrap

```
Read CLAUDE.md and docs/01-architecture.md.

Set up a new repo skeleton only. No business logic yet.

- Next.js (App Router) + TypeScript strict + Tailwind + shadcn/ui
- Drizzle ORM with a plain-SQL migration runner (numbered files in migrations/)
- Vitest configured, with a separate `test:isolation` script
- docker-compose.yml with postgres:16 and a persistent volume, for LOCAL dev and
  tests only. Production Postgres is Supabase; the app must not care which one it
  is talking to beyond the connection string.
- Two separate connection strings in config: DATABASE_URL_MIGRATOR (owner role)
  and DATABASE_URL (app_runtime role). The app must refuse to boot if they are
  the same value.
- postgres-js configured with prepare: false, because production runs through
  Supabase's transaction-mode pooler
- pnpm scripts exactly as listed in CLAUDE.md
- .env.example with every variable documented in one line each
- The folder structure from CLAUDE.md, with .gitkeep files

Do NOT create any tables or features. Stop and show me the tree and package.json.
```

## Prompt 1 — Database roles and the RLS foundation

```
Read docs/01-architecture.md, section "Tenant isolation".

Implement the multi-tenancy foundation:

1. Migration 0001: create the `app` schema, create the `app_runtime` role with
   NOBYPASSRLS holding DML but owning nothing, grant it usage on `app` plus
   default privileges on future tables, and revoke `anon` and `authenticated`
   from the schema. Migrations themselves run as the owner role (`postgres` on
   Supabase).
2. Migration 0002: the `tenants` table, plus a reusable SQL function or snippet
   that enables RLS + FORCE RLS + the tenant_isolation policy on a given table,
   so future migrations call it in one line.
3. src/lib/db/: connection using the app_runtime role, and the
   `withTenant(tenantId, fn)` helper using set_config('app.tenant_id', ..., true)
   inside a transaction, with the tenant id passed as a BOUND PARAMETER.
4. src/lib/db/platform.ts: `withPlatformAdmin()` using a separate exempt role.
5. A startup assertion that crashes the process if the app's connection reports a
   role with rolbypassrls, or if the Supabase service_role key is present in the
   app's environment at all.

Then write the isolation test harness: it must read the list of tenant-scoped
tables from the database catalog and assert each one has RLS enabled and FORCE
set, so a future table without a policy fails automatically.

Show me the migration SQL and the helper before writing tests.

Finally: run the isolation suite twice, once against local docker Postgres and
once against the Supabase transaction-mode pooler URL, and show me both results.
SET LOCAL behaves differently under pooling and I want that proven, not assumed.
```

## Prompt 2 — Tenants, branches, label packs

```
Read docs/02-data-model.md, sections "Platform layer", "Tenant structure",
and "Label packs".

Implement: platform_plans, tenants, tenant_subscriptions, branches, resources.

Include:
- UUIDv7 generation helper in src/lib/ids.ts
- The LABEL_PRESETS config and a `resolveLabels(tenant)` function that merges
  tenant overrides on top of the vertical preset
- A seed script creating two demo tenants: "Shivaji Karate Academy" (karate) and
  "Bright Future Tuition" (tuition), each with one branch

Add the isolation test for branches and resources.
Run pnpm test:isolation and paste the actual output.
```

## Prompt 3 — Staff, roles, permissions

```
Read docs/02-data-model.md "Staff and authorization" and docs/03-module-specs.md M2.

Implement staff_users, staff_branches, system_permissions, tenant_roles,
role_permissions, staff_user_roles.

Seed the full system_permissions list derived from the modules in docs/03-module-specs.md,
using the module:action convention.

Implement the 4 preset roles, created automatically when a tenant is created,
with the default permission sets from the M2 table.

Implement `can(ctx, module, permission)` exactly as specified in
docs/01-architecture.md, enforced in the SERVICE layer.

Write tests for: owner bypass, multi-role union, module flag blocking a permitted
action, last-owner-removal rejection.
```

## Prompt 4 — Staff auth

```
Read docs/01-architecture.md "Auth".

Implement staff email + password login:
- argon2id hashing
- sessions table, opaque token, httpOnly SameSite=Lax cookie
- the session payload shape from the architecture doc, cached on the session row
- middleware that resolves the tenant from the session and opens withTenant()
- logout, session revocation, and cache invalidation when roles/modules change
- rate limiting: 5 failed logins per email per 15 minutes

No JWTs. No auth library. Write the tests for revocation taking effect immediately.
```

## Prompt 5 — App shell

```
Read docs/01-architecture.md and the label pack section of docs/02-data-model.md.

Build the authenticated shell:
- Sidebar driven by enabled_modules AND permissions (hide what the user can't use)
- A `useLabel('client' | 'staff' | 'batch' | 'session' | 'program')` hook
- Branch switcher, hidden entirely when the tenant has one branch
- Mobile-first: bottom nav on small screens, sidebar on desktop
- Empty states everywhere, with a clear primary action

Design constraint: this is used on cheap Android phones by non-technical people.
Large tap targets, high contrast, minimal chrome. No dashboard widgets yet.
```

## Prompt 6 — Students, households, guardians

```
Read docs/02-data-model.md "People" and docs/03-module-specs.md M3.

Implement households, guardians, clients, client_guardians, consents.

Key behaviours to get right:
- Adding a student whose guardian phone already exists offers to link to that
  existing household instead of creating a duplicate
- Student code generation `{PREFIX}-{YYYY}-{0000}`, safe under concurrency
- Consent capture required before saving a minor's profile
- Status transitions with left_reason from a fixed list

UI: student list with search + status filter, student create form (short — name,
phone, guardian, program interest), student profile page with tabs.

Tests: duplicate guardian phone links the household; concurrent code generation
produces no duplicates; a student with payments cannot be deleted.
```

## Prompt 7 — CSV import

```
Build a CSV importer for existing students.

- Upload, column mapping UI, preview with row-level validation errors
- Dry run showing "will create 180 students, 140 households, 12 warnings"
- Idempotent: re-running the same file must not duplicate
- Handle Devanagari names, missing last names, shared guardian phones
- Import errors downloadable as a CSV of failed rows with reasons

This is how an academy's data gets in. Treat it as a first-class feature.
```

## Prompt 8 — Programs, batches, schedule rules

```
Read docs/02-data-model.md "Programs, batches, sessions" and docs/03-module-specs.md M4.

Implement programs, batches, batch_schedule_rules, holidays.

UI: create a batch in one screen — name, program, days of week, time, teacher,
start date. A karate academy owner must do this in under a minute.

Rules to implement exactly:
- Editing a schedule rule affects only future sessions
- Capacity in roster mode warns, never blocks
- A batch with active enrollments cannot be deleted, only closed
```

## Prompt 9 — Session generation (careful, timezone-heavy)

```
Before writing code, list every timezone edge case in generating sessions from
weekly rules for a tenant in Asia/Kolkata, and how you'll test each one.

Then implement the `sessions.generate` pg-boss job:
- Materialise sessions 60 days ahead from active batch schedule rules
- Skip holidays for the relevant branch
- Idempotent: unique (batch_id, start_at), safe to run repeatedly
- Adding a holiday later cancels already-generated sessions on that date
- Per-tenant error isolation: one tenant failing must not stop the rest

Tests must include a 5:30 AM IST session, a session crossing midnight, and a DST
edge for a non-IST tenant timezone.

Target: 200 batches, 60 days, under 30 seconds.
```

## Prompt 10 — Enrollments

```
Read docs/03-module-specs.md M4 and the enrollments table in docs/02-data-model.md.

Implement enroll, pause, resume, transfer-between-batches, leave.

Transfer must: close the old enrollment as 'transferred', create the new one,
link them via transferred_to_enrollment_id, and preserve the student's attendance
and fee history in a single continuous view on their profile.

UI: from the batch page (add students) and from the student page (join a batch).
Both paths must exist; staff use different ones.
```

## Prompt 11 — Attendance (the most important screen)

```
Read docs/03-module-specs.md M5 in full.

Build the attendance flow, mobile-first:
- Teacher's home: today's sessions, biggest tap targets in the app
- Roster screen: active enrollments only, unmarked by default
- "Mark all present" then tap to correct exceptions
- Save, with an optimistic UI and a clear saved state

Rules: 7-day edit window then attendance:override; unique (session_id, client_id);
two devices marking the same session must not create duplicates.

Performance target: roster loads under 1 second on throttled 3G.
Do NOT build offline support yet — that's the next prompt.
```

## Prompt 12 — Offline attendance

```
Add offline support to the attendance flow only. Nothing else in the app goes
offline.

- Service worker caching the app shell
- Cache today's sessions and rosters for the logged-in teacher
- Queue attendance marks in IndexedDB when offline
- Sync on reconnect, with a visible "3 unsynced" badge
- Conflict rule: last write wins, but flag in the UI if a different staff member
  already marked that student

Test by simulating airplane mode, marking a full roster, and reconnecting.
```

## Prompt 13 — Money foundation

```
Read docs/04-fees-and-payments.md in full before writing anything.

Implement the money primitives only:
- src/lib/money: paise bigint type, add/subtract/percentage/split helpers,
  round-half-up at the paisa, formatting for INR display
- number_series table and the UPDATE...RETURNING allocation inside a transaction
- A job that creates next financial year's series on 1 April

Tests first: ₹1,500 split across 3 children; 18% tax on ₹833.33; concurrent
number allocation from two transactions producing no duplicate.

Do not touch invoices yet.
```

## Prompt 14 — Fee plans and invoices

```
Read docs/04-fees-and-payments.md sections "Fee plan types" through "GST".

Implement fee_plans, invoices, invoice_lines, and the invoices.generate job.

Support recurring and term (installment) plans. Package/credits is V2 — add the
column but leave the code path unimplemented with an explicit TODO.

Admission fee charged once per student per program on the first invoice.
Discounts always shown as an explicit line with a mandatory reason.
GST lines only when tenants.gstin is present.

Invoice numbers assigned only on draft → issued.
```

## Prompt 15 — Payments and the reconciliation screen

```
Read docs/04-fees-and-payments.md sections "Payment recording" onward.

Implement payments, payment_allocations, refunds.

The primary UI is "Record payment": amount, method, done. Cash is the default
method. Two taps for the common case.

Implement: partial payments, advances on the household, auto-allocation
oldest-first, receipt PDF generation, and the daily reconciliation screen exactly
as laid out in the doc, broken down by method and by collector.

Write the full test list at the bottom of docs/04 before implementing.
The day's total must match the payments table to the paisa.
```

## Prompt 16 — Razorpay per-tenant

```
Read docs/04-fees-and-payments.md "Who receives the money" and
"Razorpay payment link flow".

Implement:
- tenant_integrations with encrypted credential storage (src/lib/crypto)
- A settings screen where an academy pastes their own Razorpay key id, secret and
  webhook secret, with a "test connection" button
- Payment link creation using THAT TENANT's credentials
- POST /api/webhooks/razorpay/:tenantSlug with signature verification BEFORE
  parsing, webhook_events dedupe, and transactional processing
- The hourly reconciliation job for lost webhooks

Critical: your own SaaS billing must use a completely separate code path and
credential resolver. Never share one.

Test: duplicate webhook creates one payment; out-of-order events create one
payment; tenant A's webhook cannot write to tenant B.
```

## Prompt 17 — WhatsApp

```
Read docs/03-module-specs.md M8.

Build in this order:
1. The manual "copy message" fallback that works with zero integration configured.
   Generate the message text from a template, one-tap copy, one-tap open WhatsApp.
2. MessagingAdapter interface + message_templates + message_log
3. WhatsApp Business API implementation behind the adapter
4. The reminder jobs: fee_due T-3, fee_overdue T+1 and T+7, absent, receipt

Rules: respect whatsapp_optin; one absence message per child per day; one reminder
per invoice per stage, never twice; per-tenant daily send cap.

Ship step 1 as its own commit — it's useful immediately.
```

## Prompt 18 — Enquiries

```
Read docs/03-module-specs.md M7.

Implement enquiries and enquiry_activities.

The add-enquiry form must be completable in 15 seconds: name, phone, program.
Everything else optional.

Implement: follow-up scheduling, trial booking into a real session without an
enrollment, and one-step conversion that creates student + household + guardian +
enrollment carrying the phone number forward with no re-typing.

Report: conversion rate by source, and lost reasons.
```

## Prompt 19 — Dashboard and reports

```
Read docs/03-module-specs.md M10.

Build the owner dashboard with exactly four blocks: Today, Money, At risk,
Pipeline. Nothing else. Resist adding charts.

Then the CSV reports listed in M10. UTF-8 with BOM so Devanagari names open
correctly in Excel.

Performance: dashboard under 2 seconds with 2,000 students. If a query is slower,
add a nightly rollup table rather than optimising the query into something
unreadable.
```

## Prompt 20 — Parent portal

```
Read docs/03-module-specs.md M11 and the auth section of docs/01-architecture.md.

Implement guardian phone + OTP login (OTP over WhatsApp, SMS fallback, hashed,
5-minute expiry, single use, rate limited) and the four portal screens.

Security test that must pass: guardian A changing an id in the URL gets a 404 for
guardian B's child. Write this test before the feature.

No chat. No feed. Four screens.
```

## Prompt 21 — Platform admin

```
Read docs/03-module-specs.md M12.

Build the /platform area for the platform admin:
tenant list with usage vs limits, create tenant, suspend/restore, change plan and
module flags, failed message and webhook queues, job queue health.

Impersonation: read-write, persistent banner, and every write tagged
impersonated_by in audit_log. Never silent.
```

## Prompt 22 — Hardening

```
Audit the whole codebase against CLAUDE.md's Definition of Done. Produce a list
of violations first, grouped by severity. Do not fix anything yet.

Look specifically for:
- Routes missing a permission check
- Tenant-scoped tables missing an RLS policy or an isolation test
- Money arithmetic outside src/lib/money
- Writes to money/attendance/roles missing an audit_log entry
- Queries that could run without a tenant context
- Any place a secret could reach a log

Then we'll fix them in priority order.
```

## Prompt 23 — Load and deploy

```
1. Write a seed script generating a realistic load: 3 tenants, 2,000 students,
   200 batches, 40,000 sessions, 100,000 attendance rows, 20,000 invoices.
2. Measure: dashboard, student list, attendance roster, collection report.
   Report actual numbers against the targets in the docs.
3. Add the missing indexes. Show EXPLAIN ANALYZE before and after.
4. Then: docker-compose for production (caddy, app, worker, postgres),
   nightly pg_dump to object storage, health endpoint, and a documented
   restore procedure I can actually run.
```

---

## Prompts to reuse throughout

**Before a risky change**

```
Before writing code: list the ways this could break tenant isolation, lose money,
or corrupt attendance. For each, say how you'll test it. Wait for my go-ahead.
```

**After a mediocre implementation**

```
Knowing everything you know now, scrap this and implement the clean version.
```

**When you suspect it's wrong**

```
Prove this works. Show me the actual test output, and walk me through the case
where two people do this at the same time.
```

**Weekly**

```
Review the last week's commits against docs/. List anywhere the code and the spec
have drifted apart. Update whichever one is wrong — ask me which.
```

**When a spec gap appears**

```
Stop. This isn't specified in docs/. Ask me the questions you need answered,
then update the relevant doc with my answers before writing code.
```

---

## Review prompts (run these regularly, not once)

**Tenant safety audit** — run after every phase:

> Audit the whole codebase for tenant isolation. Specifically find:
> 1. Any database query that does not go through `withTenant`
> 2. Any table with a `tenant_id` column that has no RLS policy
> 3. Any place a tenant id comes from a request body, query string or URL rather
>    than from the session
> 4. Any raw SQL that interpolates a value instead of binding it
> 5. Any cross-tenant query outside `src/modules/platform/`
>
> List findings by severity with file and line. Do not fix anything yet.

**Money audit** — run before charging any customer:

> Audit every code path that reads or writes money. Find: floating point
> arithmetic on money, rounding applied at the wrong level, invoice status set
> directly instead of derived, payment allocation that can exceed the payment
> amount, and any place a number series could gap or duplicate. Report only, no fixes.

**Dependency check** — run monthly:

> List every production dependency, its version, when it was last published, and
> whether it is still maintained. Flag anything unmaintained or with a known
> advisory. Recommend removals for anything used in fewer than three places.

---

## Save these as reusable commands

Put a markdown file in `.claude/commands/` and its filename becomes a slash
command in that project. The newer, recommended format is a skill at
`.claude/skills/<name>/SKILL.md`, which supports the same `/name` invocation and
can also be used by Claude on its own; `.claude/commands/` still works.

Worth saving:

| File | What it does |
|---|---|
| `tenant-audit.md` | the tenant safety audit above |
| `money-audit.md` | the money audit above |
| `slice.md` | the slice template, with `$ARGUMENTS` for the slice number |
| `ship.md` | typecheck, test, isolation test, migration check, then summarise the diff |

---

## What not to say to Claude Code

These prompts feel efficient and produce code you will regret.

| Don't say | Why | Say instead |
|---|---|---|
| "Build the whole fees module" | You get 30 files and review none of them | "Slice 9, migration and schema only, then stop" |
| "Make it production ready" | Means nothing, invites scope creep | Name the specific gap you want closed |
| "Fix all the failing tests" | Invites deleting or weakening tests | "Test X fails. Diagnose the cause before changing anything." |
| "Refactor this to be cleaner" | Unbounded diff across the repo | "Extract the allocation logic from service.ts into its own file. Nothing else." |
| "Add multi-tenancy later" | It is not retrofittable | It is slice 1, before anything else |
| "Just use any for now" | `any` becomes permanent | Model the real type, or ask for help modelling it |
| "Skip the test, I'll add it later" | You will not | The slice is not done without it |

Two more habits that matter:

- When Claude Code reports that tests pass, **run them yourself** at least once a
  week. Trust the output, but calibrate the trust with occasional checking.
- When it suggests a library you have not heard of, ask why, and ask what the
  alternative would cost. It should be able to answer in one sentence.
