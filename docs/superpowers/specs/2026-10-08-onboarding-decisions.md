# Onboarding & subscription selection — decision record

Date: 2026-10-08 · Status: **decisions taken, not yet specced into tasks**
Related: `2026-10-07-finance-module-decisions.md`, `2026-10-07-reports-analytics-decisions.md`,
`2026-10-08-enquiries-module-decisions.md`

## Inventory, measured at `e815f47`

Unlike the finance, reports and enquiry briefs, **this one is largely greenfield**:

| | |
|---|---|
| Onboarding of any kind | **none** — no files, no references |
| Self sign-up | **none** — only login, invite, reset, and the two public token routes |
| Branches, modules, roles, invites | built |
| Per-branch-per-module subscriptions | **built, and more complete than the brief assumes** |

`app.activity_subscriptions` is keyed on **(tenant, branch, activity)** and already
carries status, plan, `nextPlanId` (a downgrade waiting for period end), trial via
`periodEnd`, `anchorDay`, `cancelAtPeriodEnd`, and a price override with a reason
and an expiry. `app.activity_plans` carries `pricePaise`, `billingInterval`,
`maxStudents`, `maxStaff`, `isOffered`, `isDefault`.

## Decisions, 2026-10-08

### 1. Billing stays per branch, per activity

The subscription brief describes one academy-wide tier (Starter / Growth /
Business) with limits like "max branches: 1". **That model does not exist here
and is not being built.** What exists: an academy subscribes to *Karate at Main
Dojo*; adding Swimming or a second branch adds a subscription, and each activity
plan carries its own `maxStudents` / `maxStaff`. There is no `maxBranches`.

Consequence for onboarding: **there is no separate "Choose your plan" step.**
Plan choice belongs to the **module step**, where the owner is already picking
what this branch does. The brief's instruction not to hard-code plans, prices,
limits or intervals stands and is easy to honour — they all come from
`activity_plans`.

### 2. Self sign-up is in scope

The flow starts at "Sign Up", and there is no sign-up today. The user chose to
build it as part of this work rather than defer it.

**It needs its own sub-spec before any task is written.** It is a public,
unauthenticated, tenant-creating endpoint — the largest new attack surface this
product will have gained. At minimum it must settle: phone or email verification
before a tenant exists, slug/subdomain allocation and collision handling, rate
limiting and abuse, what a tenant looks like before any subscription is chosen,
and whether a trial starts automatically. See [[academy-types-and-signup]] for
the earlier deeniyat free-after-verification decision, which this must respect.

### 3. The tenant *is* the organization

No new layer. A tenant already has its own name, slug and branding, and branches
already carry independent names — the brief's "ABC Academy owning XYZ Academy"
works today. Onboarding only needs to collect organization-level fields not yet
captured: logo, contact details, country, currency.

**An Organization above tenants was explicitly rejected.** Every tenant-scoped
query, RLS policy and isolation test assumes the tenant is the top of the tree;
changing that would reopen the isolation work this project has just spent
thirteen tasks protecting.

## What the brief gets right about this codebase

**Completion detection from real state** (§13) fits exactly. Each task maps to a
table that already exists: a branch row, an `activity_subscriptions` row, a staff
row, a batch row, a `fee_plans` row. The checklist should be a **view over the
product**, never a second store of progress — the brief says this and it is the
single most important architectural instruction in it.

**Permissions** (§8) also fit: never show a task the viewer cannot perform. The
RBAC model is owner-editable permission keys, and nav already filters this way.

## Conflicts to carry into the spec

- **Sidebar.** The brief's ACADEMY group lists **Referrals** and **Notifications**.
  Neither exists and neither was agreed — the same two appeared in the enquiry
  brief and were declined there.
- **Onboarding tables.** `onboarding_progress`, `onboarding_task`,
  `onboarding_task_completion` are suggested. Most task state is *derived*, so
  only the non-derivable parts need storing: **skipped**, **dismissed**, and
  contextual-tour state. Storing a `COMPLETED` that the database can already
  answer creates two sources of truth that will drift.
- **Module onboarding definitions** should live beside each activity in
  `src/lib/activities.ts`, which is already the module registry, rather than in a
  new engine-side table.
- The marketplace (§10) and QR onboarding (§9 route D) are explicitly out of
  scope; the architecture should not preclude them.

## Sequencing

1. Member + Guardian + Payer migration — **done, `e815f47`**.
2. Finance.
3. Reports.
4. Enquiries.
5. This, **with self sign-up specced separately first**.

Onboarding goes last of the five: it walks an owner through branches, modules,
staff, students and fee plans, so every one of those surfaces should have settled
before it is scripted. A sign-up spec can be written at any time.
