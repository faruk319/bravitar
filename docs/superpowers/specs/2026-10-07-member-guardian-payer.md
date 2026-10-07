# Member + Guardian + Payer replaces Household — decision record

Date: 2026-10-07 · Status: **Decided, not yet specced into tasks**
Supersedes: `docs/superpowers/specs/2026-10-07-identity-and-family-decisions.md`, whose
open questions this answers.

## Context

Billing invoices to a "household" produced hard cases: a student separating from
the household, who owns the history, the last member leaving, and gym members who
have no parent at all. Benchmarks checked:

- **Zen Planner** (gym style): everyone is a member, family members are linked, a
  parent switches between profiles in one login, children need no email.
- **Jackrabbit** (kids-class style): the Family record holds contacts and all
  transactions, students sit under it.

## Decision

1. **Member** — the person who attends. Owns attendance, progress and level/belt
   history. Exists in every module.
2. **Guardian** — a parent profile, phone + WhatsApp OTP login, linked to one or
   more members. **A member may have many guardians.** Enabled per module/academy
   by `guardian_mode = off | optional | required_under_age(X)`. Gym defaults to
   `off`.
3. **Payer** — points at the member themselves or at one guardian. Invoices are
   raised against the payer. **One payer at a time.**
4. **No household entity.**

## Resolutions to three ambiguities found in the codebase

These were not in the original decision and were settled on 2026-10-07.

### Payer attaches to the **enrollment**

The decision said "payer is set on each subscription", but `app.activity_subscriptions`
is the **academy's own Bravitar subscription** (platform billing), not a student's
fee arrangement. A student's recurring fee originates from
`app.enrollments.fee_plan_id`.

So `payer` goes on the **enrollment**. A consequence worth keeping: a student in
two batches can have two payers — the mother paying for swimming, the father for
karate.

### `household_id` is backfilled then **dropped entirely**

`app.invoices.household_id` and `app.payments.household_id` are both `NOT NULL`.
Add `payer_id`, backfill from each household's existing primary guardian, then
**drop `household_id`**.

The user chose the irreversible option deliberately: the product is pre-launch
with only demo data, so there is no production history to endanger, and a dead
column would be carried forever. **This decision is only valid while that holds.**
If real tenant data exists when this is implemented, revisit it.

### Guardians become many-to-many

`app.guardians.household_id` is `NOT NULL` today, so a guardian belongs to exactly
one household. `app.student_guardians` already exists as a join table with
`is_manager` and `removed_at`, so the relationship is half-built. The migration
removes the household FK and makes the join table the only link.

## Answers to the earlier open questions

- **Who pays after a separation?** Change the payer on the enrollment from that
  date. Invoices already raised stay with the old payer.
- **History?** It splits. Attendance, progress and levels stay with the **member**;
  invoices and payments stay with the **payer**. A new guardian sees attendance but
  not the previous payer's money records.
- **Only member leaves?** There is no household to archive. A guardian with no
  linked members becomes inactive and their invoice history stays readable.
  **Block deactivation while a balance is due.**
- **Lowering the age threshold** never revokes existing logins; it affects only new
  ones. Staff can disable a single login by hand.
- **Email** is optional on every account. Login is phone + WhatsApp OTP; email is
  used only for receipts, if given.

## Login behaviour

- A guardian logs in once and switches between linked members.
- A member gets their own login if adult, or above the academy's age threshold
  (default 18, owner-adjustable, hard floor 13 — see the superseded identity doc
  for the legal note on India's DPDP Act).

## Further decisions, 2026-10-07 (second pass)

These came out of reading the billing code and were not in the original decision.

### Invoices: one per member per payer

The monthly run currently keys on `${householdId}|${branchId}` (`fees/service.ts:292`),
so a family gets **one invoice covering all their children**, and advances are
applied per household per branch.

That becomes **one invoice per member per payer**, per branch. In the ordinary case
— one payer for everything — a member gets one invoice, which is what was asked
for. When a member's enrollments have **different payers** (mother pays swimming,
father pays karate), a single invoice is impossible because an invoice has exactly
one payer, so that member gets one per payer. The two models only diverge in the
split case, which is precisely the case the payer-on-enrollment decision exists to
support.

Advances and credits follow the **payer**, replacing the household+branch key.

**Consequence to accept:** a parent with three children now receives three invoices
a month instead of one. That was chosen deliberately over per-family grouping.

### The bill-to name is snapshotted onto the invoice

`householdName` is joined onto invoice rows (`fees/repo.ts:289`) and receipts
(`payments/repo.ts:144`) and printed as "Received from" (`invoice-view.tsx:80`,
`receipt-card.tsx:43`). These are financial documents.

Store the bill-to name **on the invoice at issue time**. A document must not change
after it has been issued — a receipt reprinted next year must match the original.
This is one extra column and the migration is the moment to add it.

### Address and notes

- **Address** goes on **both guardian and member**, optional on each, with **no
  module-specific behaviour**. An adult member in any module — gym, dance, music —
  has their own; a child's normally comes from their guardian. Nothing branches on
  academy type.
- **Notes** move to the guardian.
- The family **name** ("Patil family") is dropped. It was only a label for the
  group; with no group, documents use the payer's own name.

### Siblings

`studentsOfHousehold` (`students/repo.ts:51`) currently finds siblings by shared
`household_id`. Without households, **siblings are members who share a guardian**.
Anything that depends on sibling relationships — the sibling discount in the seed
is one — must be re-expressed through the guardian link.

## Scope, measured 2026-10-07

Not a UI change. Measured against the codebase at `daca038`:

- **32 non-test files, 136 occurrences** of `householdId` / `household_id`.
- Four tables carry it: `invoices`, `payments`, `students`, `guardians` — two of
  them money tables.
- 14 test files touch it.
- It would be migration **0039+**; 38 exist today.
- Every tenant-scoped table involved needs its isolation test to keep passing, and
  anything new needs one of its own.

## Sequencing (decided)

1. Finish the app shell — **S3, S4, S5**.
2. **This**, as its own project with its own spec and plan.
3. The students pages, built once on the settled model.
