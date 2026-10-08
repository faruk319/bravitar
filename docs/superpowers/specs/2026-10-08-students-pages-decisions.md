# Students listing and detail pages — decision record

Date: 2026-10-08 · Status: **decisions taken, ready to spec into tasks**
Unblocked by: `2026-10-07-member-guardian-payer.md` (complete at `e815f47`)

The brief was given before the Member + Guardian + Payer migration and was held
until it landed, because the detail page shows guardians, siblings and fees —
all of which changed.

## Inventory, measured at `e815f47`

Both pages exist: `/students` (161 lines) and `/students/[id]` (332 lines, tabs
`overview, attendance, fees, notes`). This is a **redesign**, not a build.

| The brief wants | Reality |
|---|---|
| "Student ID: ST-1024" | **`students.code` exists**, NOT NULL |
| Date of birth, gender, phone, **address** | all exist — `address` added by migration 0039 |
| Multiple guardians with relationship | `student_guardians` is many-to-many with `is_manager` |
| Coach on the listing | `batches.coach_id` |
| Attendance calendar incl. **Holiday** | sessions and holidays both exist |
| Fee status, payment history, next due | invoices, payments and allocations exist |
| **Documents tab** | **no documents module, and no storage adapter** |
| **Progress 68%** | **no progression module** |
| Student **email** | only guardians have one |
| **Suspended** status | statuses are `active, paused, left, prospect` |

## Decisions, 2026-10-08

### 1. "Suspended" maps to `paused` — no new status

`paused` already means "not attending now, still enrolled", which is what
suspension is operationally. Shown as **Paused** everywhere. No migration, and no
second concept staff must learn to tell apart.

Revisit only if a disciplinary or non-payment suspension ever needs to behave
differently from a parent-requested pause — at which point the real question is
whether a suspended student still gets invoiced.

### 2. Email shows the guardian's, labelled whose it is

"Email (father): salim@…". Honest about whose address it is, and correct for a
child who has none. An **adult student** has a guardian row of their own with
relation `self`, so their own address appears with no special casing.

No email column on `students`. A duplicate address on the child would drift from
the parent's, and then nothing says which one a receipt should use.

### 3. Documents is a placeholder tab; the real thing is its own project

`CLAUDE.md` specifies Supabase Storage behind a `StorageAdapter` interface. **None
of it is built** — no adapter, no table, no module.

The tab ships with an honest empty state. The real feature needs its own spec:
the adapter, a tenant-scoped table with RLS **and an isolation test**, signed
URLs, file-type and size limits, who may view a document, and deletion. Rushing
that inside a page redesign is how storage bugs reach production.

### 4. "Progress 68%" has no source and must not be invented

There is no progression module; belts, levels and skills were deferred until
after launch ([[academy-types-and-signup]]). **Do not compute a fake percentage
from attendance** — an owner reading "68% progress" will believe it means skill,
not attendance.

The Current Program card shows what is real: program, batch, coach, and the
member's own level if the activity has one. The progress bar waits for the
progression module.

## What the migration changed for these pages

- **Siblings are members who share a guardian**, not members sharing a household.
  `siblingsOf` and `studentOverview.siblings` are already guardian-based.
- **The fees tab is per member per payer.** A student with two enrollments on
  different payers has **two invoices a month**, each with its own bill-to name.
  The card must show that rather than implying one bill.
- **The address is the student's own** (migration 0039), with the guardian's
  shown separately and labelled.
- `familyAccount` on this page now means **this student plus their
  guardian-siblings**, not a household.

## Conflicts with settled decisions

- **Sidebar.** The brief lists **Referrals** and **Notifications** under ACADEMY.
  Neither exists; declined here as in the finance and enquiry briefs.
- **"Courses & Programs" is no longer its own sidebar item** — it is a tab under
  Batches (`f7a4a9a`), because they are one page.
- The brief's KPI row (Total / Active / New this month / Inactive) is fine, but
  must respect the viewer's permissions the way the dashboard blocks do.

## Sequencing

These pages may be built **before** finance and reports — they read the settled
model and nothing downstream depends on them. The fees tab is the only overlap,
and it reads the finance module rather than owning it.
