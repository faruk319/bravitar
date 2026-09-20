# 04 — Build Plan

You are one person working with Claude Code. The plan below is ordered so that
**something demonstrable exists early** and so that the hardest correctness work
(tenant isolation, money) happens while the codebase is still small.

Each slice is one Claude Code session or two. A slice is done when it is merged,
typechecked, tested and visible in `pnpm seed`.

---

## Rules of engagement

1. **One slice at a time.** Do not let Claude Code start slice 6 because it is
   "already in that file".
2. **Migration first, test last, both in the same slice.** A slice with no test
   is not done.
3. **Review every diff.** Generated code you did not read is code you cannot
   debug at 11 PM when a pilot academy calls.
4. **Commit per slice**, with the slice number in the message.
5. **If a slice takes more than two sessions, it was too big.** Split it and
   update this file.

---

## Phase 0 — Foundations (slices 0–3)

Nothing user-visible. Do not skip any of it. Everything after depends on it.

### Slice 0 — Repo skeleton
Next.js + TypeScript strict, Tailwind, Drizzle, Vitest, Docker Compose with
Postgres, migration runner, `.env.example`, the scripts listed in `CLAUDE.md`.
**Done when:** `pnpm dev` serves a page and `pnpm migrate` runs against Docker
Postgres.

### Slice 1 — Tenancy and RLS
`tenants`, `branches`, the two DB roles, `withTenant()`, the startup assertion
that the app is not connected as an RLS-bypassing role, and the reflection-driven
isolation test suite.
**Done when:** `pnpm test:isolation` passes and **fails** if you deliberately drop
a policy. Verify that second part by actually dropping one.

### Slice 2 — Auth
`staff_users`, `sessions_auth`, argon2id, login/logout, session middleware,
request context. Platform admin login with TOTP.
**Done when:** you can log in as a seeded owner and the context carries tenant,
branch and owner flag.

### Slice 3 — RBAC and feature flags
`permissions` seed, `roles`, `role_permissions`, `staff_roles`, the `can()` gate,
the route helper that refuses to compile without a declared permission, the 4
preset roles.
**Done when:** a Teacher session gets 403 on a fees route and 200 on a roster
route, proven by test.

---

## Phase 1 — The daily loop (slices 4–8)

At the end of this phase a real academy could use the product for attendance,
which is enough for a pilot to start.

### Slice 4 — Students, households, guardians
Tables, add/edit/search, household linking, consent capture, student profile shell.
**Done when:** adding a second sibling reuses the household and guardian.

### Slice 5 — Programs, batches, schedules, holidays
Tables plus CRUD, week calendar view.
**Done when:** a batch with Mon/Wed/Fri 6–7 PM exists and displays on a calendar.

### Slice 6 — Session generation
pg-boss, the `sessions.generate` job, holiday skipping, idempotency, timezone tests
including a 5:30 AM IST batch.
**Done when:** running the job twice produces zero duplicates and correct local dates.

### Slice 7 — Enrollment
Enroll, pause, resume, transfer, leave. Roster on the batch page.
**Done when:** transferring a student preserves history and links the enrollments.

### Slice 8 — Attendance
Mobile-first roster, mark-all-present-then-correct, correction window, audit,
monthly grid. Offline queue comes later in slice 13.
**Done when:** a 30-student roster is markable in under 15 seconds on a phone.

> **Stop here and show it to your three pilot academies.** Before building fees.
> Their reaction to attendance will tell you whether the fee model you are about
> to build matches reality.

---

## Phase 2 — Money (slices 9–11)

The highest-risk code in the product. Slow down here.

### Slice 9 — Fee plans, discounts, invoices
Tables, fee plan editor, discount assignment, `number_series`, invoice generation
job with a **preview step**, the four invoice invariants as tests.
**Done when:** a two-child family gets one correct invoice with a sibling discount,
and re-running generation creates no duplicates.

### Slice 10 — Payments, allocations, receipts
Collect payment, allocate across invoices, advances, receipt numbering under
concurrency, receipt PDF, refunds, daily collection sheet.
**Done when:** the gapless-numbering test passes with 50 concurrent inserts, and
part-payment and over-payment both behave as specified.

### Slice 11 — Enquiries and trials
Board, activity timeline, follow-ups, trial on roster, conversion, funnel report.
**Done when:** enquiry → trial → conversion produces a student with the right
`joined_on`.

---

## Phase 3 — Retention and polish (slices 12–15)

### Slice 12 — Messaging
`MessagingAdapter`, console adapter, `message_log`, the six templates, the
reminder jobs, per-tenant on/off, and the manual copy-to-WhatsApp fallback.
**Done when:** the fallback works end to end with no provider connected.

### Slice 13 — Dashboard, reports, offline attendance
Owner dashboard, the five reports, CSV export, and the IndexedDB offline queue
for attendance.
**Done when:** aeroplane-mode marking of 30 students syncs exactly once.

### Slice 14 — Guardian portal
Phone OTP, children list, attendance calendar, dues, receipts, multi-tenant picker.
**Done when:** a parent with children in two tenants sees both, with no leakage.

### Slice 15 — Platform admin and go-live
Tenant onboarding wizard, plan limits, suspend, impersonation with audit, backups
with a **tested restore**, uptime monitoring, error tracking.
**Done when:** you have created a tenant end to end with zero manual SQL, and
restored last night's backup into a scratch database successfully.

---

## After V1

In this order, and only when a paying customer asks:

1. Razorpay Payment Links (V1.5)
2. Progression tracks — belts, swim levels, syllabus milestones
3. Booking mode + credits → unlocks gym and swimming
4. Staff attendance and payroll
5. Tenant subdomains and branding
6. Razorpay Subscriptions / auto-debit

---

## Timeline, honestly

Working evenings and weekends, with Claude Code, and reviewing every diff:

| Phase | Realistic |
|---|---|
| Phase 0 | 2–3 weeks |
| Phase 1 | 4–6 weeks |
| Phase 2 | 4–6 weeks |
| Phase 3 | 4–6 weeks |
| Pilot fixes before charging anyone | 4 weeks |

Roughly **5 to 7 months to a product you can charge for**. If someone tells you
six weeks, they are counting the code and not the correctness, the pilot feedback
or the WhatsApp template approvals.

Two things you can do in parallel, starting this week, that cost no code time:

- Recruit the three pilot academies and photograph their fee and attendance
  registers.
- Apply for WhatsApp Business API access and submit the six templates. Approval
  latency will otherwise land on your critical path in Phase 3.

---

## What "done" looks like for V1

A karate academy with 120 students and two branches runs a full month on it:
every student enrolled, attendance marked daily on a phone, invoices generated on
the 1st, reminders sent on WhatsApp, payments recorded in cash and UPI, receipts
issued with no gaps, and the owner checking the collection sheet at closing time
without opening a register.

If that month passes with no data loss, no wrong invoice and no cross-tenant leak,
you have a product.

---

## Scope discipline rules

- A feature request from **one** academy is a note. From **three**, it is a sprint.
- If a sprint runs more than 50% over, cut scope, don't extend. Ship the smaller
  thing and move on.
- Any new module must answer: which of the 4 dashboard numbers does it improve?
  If none, it waits.
- Before building anything, ask: can the academy do this today in a WhatsApp group
  or a notebook, and are they actually unhappy about it? If they are not unhappy,
  they will not pay.

## The three failure modes to watch for

1. **Building for all eight verticals at once.** Symptom: you keep adding
   configuration options instead of shipping screens. Cure: pick one pilot
   academy and build exactly what they need this month.
2. **Building the admin panel instead of the product.** Platform admin is Sprint 8
   for a reason. You have zero tenants until you have one.
3. **Rewriting because the architecture "isn't clean".** With RLS and a modular
   monolith you have enough architecture for 500 tenants. Resist.
