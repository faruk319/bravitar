# Member + Guardian + Payer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `households` entity with Member + Guardian + Payer, so a member's attendance history and a payer's money records can separate cleanly.

**Architecture:** Expand → migrate → contract. One migration adds every new column as nullable and backfills from households, changing no behaviour. Each consumer then switches to the new columns with its tests green at every step. Only when nothing reads `household_id` does a final migration drop it. At no point is the app broken.

**Tech Stack:** Next.js 16 App Router, Drizzle, PostgreSQL with RLS, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-07-member-guardian-payer.md`

## Global Constraints

- TypeScript strict, **no `any`**.
- **Money is `bigint` paise.** Never float, never `numeric` in app code, never a rupee string. Format only at the UI edge.
- **Every tenant-scoped table has `tenant_id`, RLS and `FORCE ROW LEVEL SECURITY`.** Every new tenant-scoped table ships an isolation test in the same task. `pnpm test:isolation` must pass after every task.
- **Migrations are append-only**, numbered, each with a working `-- down`. Never edit an applied migration.
- **Audit log every write** to money, attendance, enrollment status, roles and integration credentials.
- Timestamps are `timestamptz` UTC; "what day is this" converts to the tenant's timezone. `new Date().toISOString().slice(0,10)` is banned — it shipped a real bug here.
- IDs are UUIDv7 generated in the application.
- Soft delete, never hard delete, anything touching people, money or attendance.
- Comments one or two lines. No new dependency without saying why.
- Baseline entering this plan: **73 files, 590 tests, 0 failures**; typecheck and lint clean.

## Explicitly out of scope — a second project

The spec also decides **behaviour** that this plan does not build. Task 1 adds the
columns (`guardian_mode`, `guardian_required_under_age`, `member_login_min_age`)
because the migration is the cheap moment to add them, but **nothing reads them
here**. These need their own spec and plan once the data model has landed:

- Enforcing `guardian_mode` (`off | optional | required_under_age`) when adding a member.
- A member's own login above the age threshold, and the owner setting with its
  13-year floor and the ⓘ legal note.
- A guardian signing in once and switching between linked members.
- **Leaving the family**: the member requests, the manager or owner approves,
  `removed_at` ends access while history stays.
- **Blocking guardian deactivation while a balance is due.**

Building the model first is deliberate: all of that behaviour reads the model, and
writing it against `households` would mean writing it twice.

## Review Focus

Five conditions the spec implies that no task's happy path exercises. Each has a test assigned to the task that owns it.

1. **A member with two payers** — enrollments with different payers must produce one invoice per payer, never a single invoice silently attributed to one of them. *(Task 5)*
2. **A payer with no member, and a member with no payer** — a guardian whose last member left, and an enrollment created before a payer was set. Neither may crash a billing run or produce an invoice with a null bill-to. *(Tasks 4, 5)*
3. **Backfill completeness** — every existing invoice and payment must come out of the migration with a payer. A single null in a money table is a failure, not a warning. *(Task 1)*
4. **Sibling resolution without households** — two members sharing a guardian are siblings; two members of different guardians are not. The sibling discount depends on this. *(Task 3)*
5. **Tenant isolation across the new links** — a guardian in tenant A must never resolve to a member in tenant B through the join table, and the payer FKs must not open a cross-tenant path. *(Tasks 1, 9)*

---

## File structure

**New:**
- `migrations/0039_member_guardian_payer.sql` — expand + backfill
- `migrations/0040_drop_households.sql` — contract
- `src/modules/students/payer.ts` — payer resolution, pure where possible

**Heavily changed:** `modules/students/{schema,repo,service,family}.ts`, `modules/fees/{schema,repo,service,invoicing}.ts`, `modules/payments/{schema,repo,service}.ts`, `modules/portal/{repo,service}.ts`

**Mechanical follow-through:** `modules/{messaging/compose,messaging/reminders,reports/service,enquiries/convert,students/import}.ts`, the five `isolation.ts` files, `lib/db/seed.ts`, and six UI files under `app/` and `components/`.

---

### Task 1: Migration 0039 — expand and backfill

**Files:**
- Create: `migrations/0039_member_guardian_payer.sql`
- Modify: `src/modules/students/schema.ts`, `src/modules/fees/schema.ts`, `src/modules/payments/schema.ts`, `src/modules/tenancy/schema.ts`
- Test: `src/modules/students/students.integration.test.ts`

**Interfaces produced:**
- `enrollments.payer_guardian_id`, `enrollments.payer_member_id` (exactly one non-null when set)
- `invoices.payer_guardian_id`, `invoices.payer_member_id`, `invoices.bill_to_name`
- `payments.payer_guardian_id`, `payments.payer_member_id`
- `guardians.address`, `guardians.notes`, `students.address`
- `tenants.guardian_mode` (`off | optional | required_under_age`), `tenants.guardian_required_under_age`, `tenants.member_login_min_age`

**Nothing reads these yet.** This task changes no behaviour.

- [ ] **Step 1: Write the failing test**

In `students.integration.test.ts`:

```ts
it("every invoice and payment has a payer after the migration, and none has two", async () => {
  const rows = await withTenant(T, async (tx) => ({
    invoices: await tx.execute(sql`SELECT count(*)::int AS n FROM app.invoices WHERE payer_guardian_id IS NULL AND payer_member_id IS NULL`),
    payments: await tx.execute(sql`SELECT count(*)::int AS n FROM app.payments WHERE payer_guardian_id IS NULL AND payer_member_id IS NULL`),
    bothInv: await tx.execute(sql`SELECT count(*)::int AS n FROM app.invoices WHERE payer_guardian_id IS NOT NULL AND payer_member_id IS NOT NULL`),
    noName: await tx.execute(sql`SELECT count(*)::int AS n FROM app.invoices WHERE issued_at IS NOT NULL AND (bill_to_name IS NULL OR bill_to_name = '')`),
  }));
  expect(rows.invoices[0]?.n).toBe(0);
  expect(rows.payments[0]?.n).toBe(0);
  expect(rows.bothInv[0]?.n).toBe(0);
  expect(rows.noName[0]?.n).toBe(0);
});
```

This asserts the backfill is **complete**, which is Review Focus #3. A migration that leaves one null in a money table has failed.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run --project integration students`
Expected: FAIL — column `payer_guardian_id` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- up
-- Member + Guardian + Payer replaces the household (docs/superpowers/specs/
-- 2026-10-07-member-guardian-payer.md). Expand and backfill only; nothing reads
-- these yet and household_id still carries the app. 0040 drops it.

ALTER TABLE app.guardians
  ADD COLUMN address text,
  ADD COLUMN notes text;

ALTER TABLE app.students
  ADD COLUMN address text;

ALTER TABLE app.enrollments
  ADD COLUMN payer_guardian_id uuid REFERENCES app.guardians(id),
  ADD COLUMN payer_member_id uuid REFERENCES app.students(id),
  ADD CONSTRAINT enrollments_one_payer
    CHECK (payer_guardian_id IS NULL OR payer_member_id IS NULL);

ALTER TABLE app.invoices
  ADD COLUMN payer_guardian_id uuid REFERENCES app.guardians(id),
  ADD COLUMN payer_member_id uuid REFERENCES app.students(id),
  ADD COLUMN bill_to_name text,
  ADD CONSTRAINT invoices_one_payer
    CHECK (payer_guardian_id IS NULL OR payer_member_id IS NULL);

ALTER TABLE app.payments
  ADD COLUMN payer_guardian_id uuid REFERENCES app.guardians(id),
  ADD COLUMN payer_member_id uuid REFERENCES app.students(id),
  ADD CONSTRAINT payments_one_payer
    CHECK (payer_guardian_id IS NULL OR payer_member_id IS NULL);

ALTER TABLE app.tenants
  ADD COLUMN guardian_mode text NOT NULL DEFAULT 'optional'
    CONSTRAINT tenants_guardian_mode_check
    CHECK (guardian_mode IN ('off', 'optional', 'required_under_age')),
  ADD COLUMN guardian_required_under_age integer NOT NULL DEFAULT 18
    CONSTRAINT tenants_guardian_age_check
    CHECK (guardian_required_under_age BETWEEN 13 AND 25),
  ADD COLUMN member_login_min_age integer NOT NULL DEFAULT 18
    CONSTRAINT tenants_member_login_age_check
    CHECK (member_login_min_age >= 13);

-- Backfill: a household's payer is its primary guardian, else its earliest
-- guardian. Address and notes move from the household to that same guardian.
WITH primary_guardian AS (
  SELECT DISTINCT ON (household_id) household_id, id, full_name
  FROM app.guardians
  WHERE deleted_at IS NULL
  ORDER BY household_id, is_primary DESC, created_at ASC
)
UPDATE app.guardians g
SET address = h.address, notes = h.notes
FROM app.households h, primary_guardian p
WHERE g.household_id = h.id AND p.household_id = h.id AND p.id = g.id;

WITH primary_guardian AS (
  SELECT DISTINCT ON (household_id) household_id, id, full_name
  FROM app.guardians
  WHERE deleted_at IS NULL
  ORDER BY household_id, is_primary DESC, created_at ASC
)
UPDATE app.invoices i
SET payer_guardian_id = p.id,
    bill_to_name = COALESCE(p.full_name, h.name)
FROM app.households h, primary_guardian p
WHERE i.household_id = h.id AND p.household_id = h.id;

WITH primary_guardian AS (
  SELECT DISTINCT ON (household_id) household_id, id
  FROM app.guardians
  WHERE deleted_at IS NULL
  ORDER BY household_id, is_primary DESC, created_at ASC
)
UPDATE app.payments pay
SET payer_guardian_id = p.id
FROM primary_guardian p
WHERE pay.household_id = p.household_id;

WITH primary_guardian AS (
  SELECT DISTINCT ON (household_id) household_id, id
  FROM app.guardians
  WHERE deleted_at IS NULL
  ORDER BY household_id, is_primary DESC, created_at ASC
)
UPDATE app.enrollments e
SET payer_guardian_id = p.id
FROM app.students s, primary_guardian p
WHERE e.student_id = s.id AND s.household_id = p.household_id;

-- A household with no guardian at all would leave money rows unpaid-for.
-- Fail loudly rather than ship nulls into invoices and payments.
DO $$
DECLARE orphans integer;
BEGIN
  SELECT count(*) INTO orphans FROM app.invoices WHERE payer_guardian_id IS NULL AND payer_member_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'backfill left % invoice(s) with no payer', orphans;
  END IF;
  SELECT count(*) INTO orphans FROM app.payments WHERE payer_guardian_id IS NULL AND payer_member_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'backfill left % payment(s) with no payer', orphans;
  END IF;
END $$;

-- down
ALTER TABLE app.payments DROP CONSTRAINT payments_one_payer, DROP COLUMN payer_guardian_id, DROP COLUMN payer_member_id;
ALTER TABLE app.invoices DROP CONSTRAINT invoices_one_payer, DROP COLUMN payer_guardian_id, DROP COLUMN payer_member_id, DROP COLUMN bill_to_name;
ALTER TABLE app.enrollments DROP CONSTRAINT enrollments_one_payer, DROP COLUMN payer_guardian_id, DROP COLUMN payer_member_id;
ALTER TABLE app.students DROP COLUMN address;
ALTER TABLE app.guardians DROP COLUMN address, DROP COLUMN notes;
ALTER TABLE app.tenants
  DROP CONSTRAINT tenants_guardian_mode_check, DROP CONSTRAINT tenants_guardian_age_check, DROP CONSTRAINT tenants_member_login_age_check,
  DROP COLUMN guardian_mode, DROP COLUMN guardian_required_under_age, DROP COLUMN member_login_min_age;
```

The `DO $$` block is the point of this task: a backfill that silently leaves a money row without a payer must abort the migration, not succeed.

- [ ] **Step 4: Mirror it in the Drizzle schemas**

Add the matching columns to `students/schema.ts` (guardians, students), `fees/schema.ts` (invoices), `payments/schema.ts`, `tenancy/schema.ts`. All nullable except the three tenant columns, which have defaults. Do not make anything `NOT NULL` yet — later tasks do that once writers exist.

- [ ] **Step 5: Run the migration and the test**

```bash
pnpm migrate && pnpm exec vitest run --project integration students
```
Expected: migration applies, test PASSES.

- [ ] **Step 6: Prove the down migration works**

```bash
pnpm migrate:down && pnpm migrate
```
Expected: both succeed. The project requires a working `-- down`; a down that errors is a failed task.

- [ ] **Step 7: Full suite and isolation**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:isolation`
Expected: **590 passing, 0 failures**, isolation green. Nothing reads the new columns, so nothing should change.

- [ ] **Step 8: Commit**

```bash
git add migrations/0039_member_guardian_payer.sql src/modules/students/schema.ts src/modules/fees/schema.ts src/modules/payments/schema.ts src/modules/tenancy/schema.ts src/modules/students/students.integration.test.ts
git commit -m "fees: add payer columns and backfill them from households"
```

---

### Task 2: Guardians become many-to-many

**Files:** `src/modules/students/{schema,repo,service}.ts`, `src/modules/students/students.integration.test.ts`

`guardians.household_id` is `NOT NULL`, so a guardian belongs to one household. `student_guardians` already exists with `is_manager` and `removed_at`. Make that join table the only relationship: stop reading `guardians.household_id`, and let one guardian link to members across what used to be different households.

Keep the column for now — Task 9 drops it. Write the tests first, covering a guardian linked to two members and a member with two guardians.

---

### Task 3: Siblings without households, and `payer.ts`

**Files:** Create `src/modules/students/payer.ts`; modify `src/modules/students/{repo,family}.ts`

`studentsOfHousehold` (`repo.ts:51`) finds siblings by shared `household_id`. Replace with **members sharing a guardian**, deduplicated, excluding the member themselves and anything with `removed_at` set.

`payer.ts` produces:
```ts
export type Payer = { kind: "guardian"; guardianId: string } | { kind: "member"; memberId: string };
export function payerOf(enrollment: { payerGuardianId: string | null; payerMemberId: string | null }): Payer | null;
export function payerKey(p: Payer): string;   // for grouping
```
Pure functions, unit-tested — no database.

**Review Focus #4 belongs here:** two members sharing a guardian are siblings; two members of different guardians are not. The sibling discount depends on it.

---

### Task 4: Fees — payer on the invoice, bill-to snapshot

**Files:** `src/modules/fees/{repo,service}.ts`

Write the payer onto new invoices and **snapshot `bill_to_name` at issue time** from the payer's current name. `fees/repo.ts:289` currently joins `households.name`; read the stored `bill_to_name` instead, falling back to the join only for rows that predate the snapshot.

**Review Focus #2 belongs here:** an invoice whose payer is a guardian with no members left must still render its stored name, and an enrollment with no payer must not produce an invoice with a null bill-to.

---

### Task 5: Invoicing — one invoice per member per payer

**Files:** `src/modules/fees/invoicing.ts`, `src/modules/fees/service.ts`

Invoices already carry a nullable `studentId`, and `invoicing.ts:104` groups tuition with `group: \`family|${householdId}|${branchId}|${issueDate}\`` and `studentId: null`. Change that key to member + payer:

```ts
group: `member|${studentId}|${payerKey(payer)}|${b.branchId}|${ch.issueDate}`,
studentId,
```

and update `familyDraft` to find a draft by member + payer rather than household.

In `service.ts:292`, the advance key `${i.householdId}|${i.branchId}` becomes the payer key plus branch.

**Review Focus #1 belongs here:** a member whose two enrollments have different payers must produce **two** invoices, never one silently attributed to a single payer. Test it explicitly.

---

### Task 6: Payments and the portal

**Files:** `src/modules/payments/{repo,service,links}.ts`, `src/modules/portal/{repo,service}.ts`

Payments move from household to payer; advances and credits follow the payer. The portal's `childrenOf` already joins `student_guardians`, so it mostly needs `guardians.household_id` removed from its filters.

---

### Task 7: Mechanical follow-through

**Files:** `modules/messaging/{compose,reminders}.ts`, `modules/reports/service.ts`, `modules/enquiries/convert.ts`, `modules/students/import.ts`, `modules/dashboard/bench.ts`

Each reads `householdId` for a name or a grouping. Switch each to the payer or the guardian link. **Enumerate every call site from `grep -rn "householdId" src` and tick them off** — this project has four times been bitten by a search that matched a spelling rather than the problem.

---

### Task 8: UI

**Files:** `app/(tenant)/payments/new/page.tsx`, `app/(tenant)/reports/dues/page.tsx`, `app/(tenant)/students/[id]/page.tsx`, `components/enquiries/convert-enquiry.tsx`, `components/payments/collect-form.tsx`, `components/students/add-student-form.tsx`

`householdName` becomes the bill-to name or the payer's name. The student page shows the member's own address and their guardians' addresses.

---

### Task 9: Migration 0040 — drop households

**Files:** Create `migrations/0040_drop_households.sql`; modify the five `isolation.ts` files and every schema

Only after `grep -rn "householdId\|household_id" src --include="*.ts" --include="*.tsx"` returns **nothing outside this migration**. Make the payer columns `NOT NULL` on invoices and payments, drop `household_id` from all four tables, drop `app.households`.

**Review Focus #5 belongs here:** confirm a guardian in tenant A cannot resolve to a member in tenant B through the join table or the payer FKs. `pnpm test:isolation` must pass, and the isolation fixtures need rewriting since they all build a household today.

---

### Task 10: Seed and full verification

**Files:** `src/lib/db/seed.ts`

Seed members, guardians and payers with no households. Include a member with **two payers** so the split case is visible in demo, and an adult member who is their own payer via the `self` relation.

Then `pnpm typecheck && pnpm lint && pnpm test && pnpm test:isolation`, reseed, and check `/students/[id]`, `/invoices`, `/payments` and the portal in Chrome at desktop and 390px.
