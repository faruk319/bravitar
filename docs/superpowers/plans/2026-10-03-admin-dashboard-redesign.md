# Admin Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Bravitar's admin surface to a single-accent, minimal SaaS look — new design tokens, a MAIN/MANAGEMENT rail, and a `/dashboard` rebuilt on real data with Recharts.

**Architecture:** Tokens are repointed in place in `globals.css`, so every page inherits the new palette without markup changes. The dashboard page stays a server component with one `dashboardData()` call; sections become presentational components in `src/components/dashboard/`, only the two charts being client components. New numbers come from five small read-only repo additions — no migration, no schema change.

**Tech Stack:** Next.js 16 App Router, React 19.2.8, Tailwind v4 (`@theme`), shadcn/ui, Drizzle, Vitest, `recharts@3.10.1`.

**Spec:** `docs/superpowers/specs/2026-10-03-admin-dashboard-redesign-design.md`

## Global Constraints

- TypeScript strict, **no `any`**.
- Money is `bigint` paise end to end; format only at the UI edge via `src/lib/money/format`.
- Every tenant query runs inside `withTenant(...)`; never add a `service_role` import.
- No migration and no new tenant-scoped table in this plan, therefore no new isolation test — but `pnpm test:isolation` must still pass at the end.
- Permission gating lives in `dashboardData()` via `allows(ctx, permission)` (**two arguments**). A block the viewer may not see must be **absent from the payload**, not merely hidden in the UI.
- `branchIds: []` means **all branches**. Every new query follows that convention, matching `paymentScope` / `inScope`.
- Comments stay to one or two lines (project rule).
- UI text stays short: a label or an info control, never a paragraph hint.
- Status colour never carries meaning alone — an icon or a word goes with it.
- Accent is `#2563EB` for every academy. No `data-vertical` branching anywhere.
- Touch targets ≥44px; icon-only controls carry an accessible name and a tooltip.

## Review Focus

Five conditions the spec implies that no task's happy path exercises. Each has a test assigned to the task that owns the code.

1. **Empty academy** — no classes today, no invoices, no payments. Every new query must return `0`/`[]` and the attendance percentage must not divide by zero. *(Tasks 2, 3, 4, 5, 6)*
2. **`batches.capacity` is nullable** — "near capacity" and the `18/20` schedule figure must skip a batch with no capacity set rather than render `18/null` or treat `null` as `0`. *(Tasks 2, 6)*
3. **Branch scoping** — a front-desk user scoped to one branch must not see another branch's revenue, overdue total, or unallocated students. *(Tasks 3, 4, 5)*
4. **Permission gating** — a viewer without `payments:read` must get no revenue field in the payload at all. *(Task 6)*
5. **Month boundary** — on the 1st of a month, the "this month vs last month" trend must compare against the previous calendar month and must not divide by zero when last month collected nothing. *(Tasks 3, 6)*

---

### Task 1: Design tokens

**Files:**
- Modify: `src/app/globals.css:10-135`
- Modify: `src/app/layout.tsx:1-33`

**Interfaces:**
- Consumes: nothing.
- Produces: the token names stay identical (`--color-neutral-*`, `--color-accent-*`, `--color-success-600`…), so no other file changes. Adds `--color-success-700`, `--color-warning-700`, `--color-danger-700`.

There is no unit test for CSS custom property values. The regression guard for this task is: the existing suite still passes, and a Chrome pass confirms the palette. Do not invent a hollow test.

- [ ] **Step 1: Repoint the raw palette**

In the `@theme` block of `src/app/globals.css`, replace these eight values:

```css
  --color-neutral-50: #f7f8fa;
  --color-neutral-100: #f3f4f6;
  --color-neutral-300: #e5e7eb;
  --color-neutral-500: #6b7280;
  --color-neutral-700: #374151;
  --color-neutral-900: #111827;

  --color-accent-50: #eff6ff;
  --color-accent-600: #2563eb;
```

- [ ] **Step 2: Split the status colours into fill and text**

Replace the three status lines with six. The bright value is for dots, bars and fills; the `-700` value is for text, because `#f59e0b` is 2.1:1 on white and `#ef4444` is 3.8:1 — both fail WCAG AA for text.

```css
  --color-success-600: #16a34a;
  --color-success-700: #15803d;
  --color-danger-600: #ef4444;
  --color-danger-700: #b91c1c;
  --color-warning-600: #f59e0b;
  --color-warning-700: #b45309;
```

- [ ] **Step 3: Tighten the radius ladder**

Controls 10px, cards 12px. Replace the `--radius-*` block:

```css
  --radius-*: initial;
  --radius-sm: 0.625rem;
  --radius-md: 0.625rem;
  --radius-lg: 0.625rem;
  --radius-xl: 0.75rem;
  --radius-2xl: 0.75rem;
  --radius-3xl: 0.75rem;
  --radius-4xl: 0.75rem;
  --radius-full: 9999px;
```

- [ ] **Step 4: Body text to 14px**

```css
  --text-body: 0.875rem;
```

`--text-label` is already `0.875rem` and `--text-caption` `0.8125rem`; body and label now share a size and differ only in weight. That is intended.

**Do not change `src/components/ui/input.tsx`.** It uses `text-base`, and Tailwind's default `text-base` (1rem) survives because only `--color-*`, `--font-weight-*` and `--radius-*` are reset to `initial` in this file. Inputs therefore stay 16px and iOS Safari will not zoom on focus. Verify this in Step 8 rather than editing the file.

- [ ] **Step 5: Delete the per-type accent blocks**

Remove the whole commented section and all four rules from `src/app/globals.css` — the comment beginning `The accent by academy type (agreed 2026-09-26)` through the closing brace of `[data-vertical="sports"]`.

- [ ] **Step 6: Drop the now-dead `data-vertical` lookup**

`src/app/layout.tsx` queries the database on **every page render** purely to pick the accent. With the CSS gone it has no consumer. Replace the component and delete the two now-unused imports (`headers`, `resolveTenantBySlug`, `slugFromHost`):

```tsx
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

Leave `tenants.vertical_preset` in the database alone — it is still read elsewhere (e.g. `testAcademy`).

- [ ] **Step 7: Confirm nothing else reads the attribute**

Run: `grep -rn "data-vertical" src/`
Expected: no matches.

- [ ] **Step 8: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS, with no new failures.

Then start `pnpm dev` and confirm in Chrome at 390px that an input on `/students/new` renders at 16px (DevTools → computed `font-size: 16px`) and that focusing it does not zoom the page.

- [ ] **Step 9: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx
git commit -m "ui: one accent, new neutral palette, drop the per-type accent lookup"
```

---

### Task 2: Capacity and coach on today's classes

**Files:**
- Modify: `src/modules/attendance/repo.ts:12` and `:23-33`
- Modify: `src/modules/attendance/service.ts:32-50`
- Test: `src/modules/attendance/attendance.integration.test.ts`

**Interfaces:**
- Consumes: `staffNames(tx, ids)` from `src/modules/attendance/repo.ts:141` — already exists, returns `Map<string, string>`. Use it; do not add a join for the coach name.
- Produces:
  - `ClassRow` gains `capacity: number | null`.
  - `ClassCard` gains `coachName: string | null` — the **effective** coach: the substitute in `sessions.coachId` when set, otherwise `batches.coachId`.

- [ ] **Step 1: Write the failing test**

Append to `src/modules/attendance/attendance.integration.test.ts`, inside the existing describe block that covers `todaysClasses`:

```ts
it("carries the batch capacity and the effective coach, and tolerates a batch with no capacity", async () => {
  const { classes } = await withTenant(T, (tx) => todaysClasses(tx, owner));
  const withCap = classes.find((c) => c.capacity !== null);
  expect(withCap?.capacity).toBeGreaterThan(0);
  expect(withCap?.coachName).toBeTypeOf("string");
  // A batch with capacity left unset must come back null, never 0.
  expect(classes.every((c) => c.capacity === null || c.capacity > 0)).toBe(true);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:integration -- attendance`
Expected: FAIL — `Property 'capacity' does not exist on type 'ClassCard'`.

- [ ] **Step 3: Widen `ClassRow` and select the column**

In `src/modules/attendance/repo.ts`, line 12:

```ts
export type ClassRow = { session: Session; batchName: string; programName: string; roomName: string | null; batchCoachId: string | null; capacity: number | null };
```

and in `classRows`, add one column to the existing select:

```ts
    .select({ session: sessions, batchName: batches.name, programName: programs.name, roomName: resources.name, batchCoachId: batches.coachId, capacity: batches.capacity })
```

- [ ] **Step 4: Resolve the effective coach in `todaysClasses`**

In `src/modules/attendance/service.ts`, widen the type and resolve names with the existing helper:

```ts
export type ClassCard = ClassRow & { students: number; marked: number; coachName: string | null };
```

Inside `todaysClasses`, after `marks` is fetched:

```ts
  // A substitute on the session takes the class; otherwise the batch's coach.
  const coachIds = [...new Set(rows.map((r) => r.session.coachId ?? r.batchCoachId).filter((id): id is string => id !== null))];
  const names = await staffNames(tx, coachIds);
```

and in the `rows.map` body add:

```ts
      coachName: names.get(r.session.coachId ?? r.batchCoachId ?? "") ?? null,
```

Add `staffNames` to the existing import from `./repo`.

- [ ] **Step 5: Run the test**

Run: `pnpm test:integration -- attendance`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/attendance/repo.ts src/modules/attendance/service.ts src/modules/attendance/attendance.integration.test.ts
git commit -m "attendance: capacity and the effective coach on today's classes"
```

---

### Task 3: Revenue by month

**Files:**
- Modify: `src/modules/payments/repo.ts` (add after `collectedOn`, around line 226)
- Test: `src/modules/payments/payments.integration.test.ts`

**Interfaces:**
- Produces: `collectedByMonth(tx: Tx, branchIds: string[], from: string, to: string): Promise<{ month: string; count: number; total: Paise }[]>` — `month` is `YYYY-MM`, ascending, months with no payments omitted. `from`/`to` are `YYYY-MM-DD`.

`payments.recordedOn` is a `date` column already written in tenant-local time by `recordPayment`, so bucketing with `to_char` needs no timezone conversion.

- [ ] **Step 1: Write the failing test**

Append to `src/modules/payments/payments.integration.test.ts`:

```ts
it("buckets collection by calendar month, honours branch scope, and omits empty months", async () => {
  const rows = await withTenant(T, (tx) => collectedByMonth(tx, [], "2020-01-01", "2099-12-31"));
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0]?.month).toMatch(/^\d{4}-\d{2}$/);
  expect(rows.map((r) => r.month)).toEqual([...rows.map((r) => r.month)].sort());
  expect(typeof rows[0]?.total).toBe("bigint");

  // A branch with no payments sees nothing, and an empty window is empty.
  expect(await withTenant(T, (tx) => collectedByMonth(tx, [other], "2020-01-01", "2099-12-31"))).toEqual([]);
  expect(await withTenant(T, (tx) => collectedByMonth(tx, [], "2020-01-01", "2020-01-31"))).toEqual([]);
});
```

Add `collectedByMonth` to the existing import from `./repo`. If the file has no `other` branch id, create one in `beforeAll` the way `dashboard.integration.test.ts:63` does.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:integration -- payments`
Expected: FAIL — `collectedByMonth is not exported`.

- [ ] **Step 3: Implement**

```ts
// The revenue chart: one row per calendar month in [from, to], by recorded date.
export async function collectedByMonth(tx: Tx, branchIds: string[], from: string, to: string): Promise<{ month: string; count: number; total: Paise }[]> {
  const month = sql<string>`to_char(${payments.recordedOn}, 'YYYY-MM')`;
  const rows = await tx
    .select({ month, count: sql<number>`count(*)::int`, total: sql<string>`sum(${payments.amountPaise})::text` })
    .from(payments)
    .where(and(gte(payments.recordedOn, from), lte(payments.recordedOn, to), inArray(payments.status, ["confirmed", "refunded"]), paymentScope(branchIds)))
    .groupBy(month)
    .orderBy(asc(month));
  return rows.map((r) => ({ month: r.month, count: r.count, total: BigInt(r.total) }));
}
```

Every identifier used here (`and`, `gte`, `lte`, `inArray`, `asc`, `sql`, `payments`, `paymentScope`, `Paise`, `Tx`) is already imported in that file.

- [ ] **Step 4: Run the test**

Run: `pnpm test:integration -- payments`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/payments/repo.ts src/modules/payments/payments.integration.test.ts
git commit -m "payments: collection by calendar month"
```

---

### Task 4: Overdue total and fees due tomorrow

**Files:**
- Modify: `src/modules/fees/repo.ts:368-378`
- Test: `src/modules/fees/fees.integration.test.ts`

**Interfaces:**
- Produces: `owedSummary` return type gains `overduePaise: bigint` and `dueTomorrow: number`. Existing callers (`src/modules/dashboard/service.ts:73`) keep working — the type only widens.

- [ ] **Step 1: Write the failing test**

Append to `src/modules/fees/fees.integration.test.ts`:

```ts
it("totals the overdue amount and counts invoices falling due tomorrow", async () => {
  const today = await withTenant(T, tenantToday);
  const s = await withTenant(T, (tx) => owedSummary(tx, [], today));
  expect(typeof s.overduePaise).toBe("bigint");
  // Overdue is a subset of what is owed, so it can never exceed it.
  expect(s.overduePaise <= s.owedPaise).toBe(true);
  expect(s.dueTomorrow).toBeGreaterThanOrEqual(0);

  // A branch with no invoices is all zeroes, not a crash.
  const empty = await withTenant(T, (tx) => owedSummary(tx, [other], today));
  expect(empty).toMatchObject({ invoices: 0, owedPaise: 0n, overduePaise: 0n, dueTomorrow: 0, overdueFamilies: 0 });
});
```

If the file has no `other` branch id or `tenantToday` import, add them as `dashboard.integration.test.ts` does (`createBranch` from `@/modules/tenancy/repo`).

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:integration -- fees`
Expected: FAIL — `Property 'overduePaise' does not exist`.

- [ ] **Step 3: Implement**

Replace `owedSummary` with:

```ts
export async function owedSummary(tx: Tx, branchIds: string[], today: string): Promise<{ invoices: number; owedPaise: bigint; overdueFamilies: number; overduePaise: bigint; dueTomorrow: number }> {
  const tomorrow = addDays(today, 1);
  const [r] = await tx
    .select({
      invoices: sql<number>`count(*)::int`,
      owed: sql<string>`coalesce(sum(${invoices.totalPaise} - ${invoices.paidPaise}), 0)::text`,
      overdueFamilies: sql<number>`count(DISTINCT ${invoices.householdId}) FILTER (WHERE ${invoices.dueDate} < ${today})::int`,
      overdue: sql<string>`coalesce(sum(${invoices.totalPaise} - ${invoices.paidPaise}) FILTER (WHERE ${invoices.dueDate} < ${today}), 0)::text`,
      dueTomorrow: sql<number>`count(*) FILTER (WHERE ${invoices.dueDate} = ${tomorrow})::int`,
    })
    .from(invoices)
    .where(and(inArray(invoices.status, [...OWED]), invoiceScope(branchIds)));
  return {
    invoices: r?.invoices ?? 0,
    owedPaise: BigInt(r?.owed ?? "0"),
    overdueFamilies: r?.overdueFamilies ?? 0,
    overduePaise: BigInt(r?.overdue ?? "0"),
    dueTomorrow: r?.dueTomorrow ?? 0,
  };
}
```

Add `import { addDays } from "@/lib/dates";` if the file does not already have it.

- [ ] **Step 4: Run the test**

Run: `pnpm test:integration -- fees`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/fees/repo.ts src/modules/fees/fees.integration.test.ts
git commit -m "fees: overdue total and invoices due tomorrow in owedSummary"
```

---

### Task 5: Students waiting for a batch

**Files:**
- Modify: `src/modules/students/repo.ts` (add after `countJoinedSince`, around line 183)
- Test: `src/modules/students/students.integration.test.ts`

**Interfaces:**
- Produces: `countWithoutBatch(tx: Tx, scope: Scope): Promise<number>` — active, non-deleted students with no `active` enrollment.

- [ ] **Step 1: Write the failing test**

Append to `src/modules/students/students.integration.test.ts`:

```ts
it("counts active students with no active enrollment, and respects branch scope", async () => {
  const before = await withTenant(T, (tx) => countWithoutBatch(tx, { branchIds: [] }));
  await withTenant(T, (tx) =>
    createStudent(tx, ownerCtx, {
      fullName: "Unenrolled Child",
      branchId: mainBranch,
      guardian: { fullName: "Parent of Unenrolled", phone: P(871), relation: "mother" },
      consents,
    }),
  );
  const after = await withTenant(T, (tx) => countWithoutBatch(tx, { branchIds: [] }));
  expect(after).toBe(before + 1);

  // Scoped to a branch with no students at all, the answer is 0, not a crash.
  expect(await withTenant(T, (tx) => countWithoutBatch(tx, { branchIds: [otherBranch] }))).toBe(0);
});
```

`ownerCtx`, `mainBranch`, `otherBranch`, `P` and `consents` are all already set up in that file's `beforeAll`. Add `countWithoutBatch` to the existing `@/modules/students/repo` import. Pick a `P(n)` argument no other test in the file uses.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:integration -- students`
Expected: FAIL — `countWithoutBatch is not exported`.

- [ ] **Step 3: Implement**

```ts
// Waiting for a batch: on the roll, but in nothing yet.
export async function countWithoutBatch(tx: Tx, scope: Scope): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(students)
    .where(
      and(
        eq(students.status, "active"),
        isNull(students.deletedAt),
        inScope(scope),
        sql`NOT EXISTS (SELECT 1 FROM ${enrollments} WHERE ${enrollments.studentId} = ${students.id} AND ${enrollments.status} = 'active')`,
      ),
    );
  return r?.n ?? 0;
}
```

Add two imports: `sql` to the existing `drizzle-orm` import, and `import { enrollments } from "@/modules/enrollments/schema";`. This direction is safe — `enrollments/schema` imports `students/schema`, not `students/repo`, so there is no cycle.

- [ ] **Step 4: Run the test**

Run: `pnpm test:integration -- students`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/students/repo.ts src/modules/students/students.integration.test.ts
git commit -m "students: count those waiting for a batch"
```

---

### Task 6: Assemble the dashboard payload

**Files:**
- Modify: `src/modules/dashboard/service.ts:18-33` (the `Dashboard` type) and `:35-86`
- Test: `src/modules/dashboard/dashboard.integration.test.ts`

**Interfaces:**
- Consumes: `countByStatus` (`students/repo:150`), `countWithoutBatch` (Task 5), `collectedByMonth` (Task 3), `owedSummary` with `overduePaise`/`dueTomorrow` (Task 4), `ClassCard.capacity`/`.coachName` (Task 2).
- Produces: the `Dashboard` type below. Task 11 renders exactly these fields.

- [ ] **Step 1: Write the failing test**

Append to `src/modules/dashboard/dashboard.integration.test.ts`:

```ts
it("adds the roll, the revenue history and the attention counts, each behind its own permission", async () => {
  const d = await withTenant(T, (tx) => dashboardData(tx, owner, { now: noon }));

  expect(d.roll?.active).toBeGreaterThan(0);
  expect(d.roll?.waitingForBatch).toBeGreaterThanOrEqual(0);
  expect(typeof d.money?.overduePaise).toBe("bigint");
  expect(d.money?.dueTomorrow).toBeGreaterThanOrEqual(0);
  expect(d.money?.byMonth?.length).toBeGreaterThan(0);
  expect(d.today?.attendance).toMatchObject({ present: expect.any(Number), absent: expect.any(Number), notMarked: expect.any(Number) });
  // Capacity is nullable, so a batch without one must not reach nearCapacity.
  expect(d.today?.nearCapacity).toBeGreaterThanOrEqual(0);
});

it("omits money entirely for a viewer who may not read payments or invoices", async () => {
  const coach = await ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `coach-only-${stamp}@example.test`, fullName: "Coach Only", roleId: (Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r.id])))["Coach"] ?? "" }))).id);
  const d = await withTenant(T, (tx) => dashboardData(tx, coach, { now: noon }));
  expect(d.money).toBeUndefined();
  expect(d.money?.byMonth).toBeUndefined();
});

it("survives an academy with nothing in it", async () => {
  const t = await testAcademy({ name: `Empty ${stamp}`, slug: `empty-${stamp}`, verticalPreset: "general", owner: { name: "Owner", email: `empty-${stamp}@example.test` } });
  const ctx = await (async () => {
    const [base, branchIds] = await withTenant(t.tenant.id, async (tx) => [await loadAccessContext(tx, t.owner.id), await staffBranchIds(tx, t.owner.id)] as const);
    return { ...base, branchIds };
  })();
  const d = await withTenant(t.tenant.id, (tx) => dashboardData(tx, ctx));
  expect(d.roll?.active).toBe(0);
  expect(d.today?.attendance).toMatchObject({ present: 0, absent: 0, notMarked: 0 });
  expect(d.money?.byMonth).toEqual([]);
  expect(d.money?.trendPct).toBeNull();
  await deleteTenantsCompletely([t.tenant.id]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:integration -- dashboard`
Expected: FAIL — `Property 'roll' does not exist on type 'Dashboard'`.

- [ ] **Step 3: Widen the `Dashboard` type**

```ts
export type Dashboard = {
  date: string;
  roll?: { active: number; joinedThisMonth: number; waitingForBatch: number };
  today?: {
    timeZone: string;
    classes: ClassCard[];
    held: number;
    marked: number;
    notMarked: number;
    present?: { here: number; marked: number };
    attendance?: { present: number; absent: number; notMarked: number };
    nearCapacity: number;
  };
  money?: {
    collectedToday?: Collected;
    thisMonth?: Collected;
    last30?: { from: string; to: string; byDay: { key: string; count: number; totalPaise: Paise }[] };
    byMonth?: { month: string; count: number; totalPaise: Paise }[];
    trendPct?: number | null;
    owed?: { invoices: number; owedPaise: Paise; overdueFamilies: number };
    overduePaise?: Paise;
    dueTomorrow?: number;
    admissions?: number;
  };
  atRisk?: { attendance: number | null; unpaid: number | null };
  pipeline?: { followUps: number; month: Funnel; mine: EnquiryRow[] };
};
```

- [ ] **Step 4: Fill the new fields**

In `dashboardData`, inside the existing `allows(ctx, "sessions:read")` block, after `out.today` is built:

```ts
    // Near capacity only counts batches that actually declare one.
    out.today.nearCapacity = t.classes.filter((c) => c.capacity !== null && c.capacity > 0 && c.students / c.capacity >= 0.9).length;
```

and inside the nested `allows(ctx, "attendance:read")` block, beside `present`:

```ts
      const roster = t.classes.reduce((n, c) => n + c.students, 0);
      out.today.attendance = {
        present: marks.filter((m) => m.status === "present" || m.status === "late").length,
        absent: marks.filter((m) => m.status === "absent").length,
        notMarked: Math.max(0, roster - marks.length),
      };
```

After the `students:read` admissions line, add the roll block:

```ts
  if (allows(ctx, "students:read")) {
    const byStatus = await countByStatus(tx, { branchIds: ctx.branchIds });
    out.roll = {
      active: byStatus.active,
      joinedThisMonth: await countJoinedSince(tx, { branchIds: ctx.branchIds }, monthStart),
      waitingForBatch: await countWithoutBatch(tx, { branchIds: ctx.branchIds }),
    };
  }
```

Inside the `allows(ctx, "payments:read")` block, after `money.last30`:

```ts
    // Eight months of history for the revenue chart, plus last month for the trend.
    const months = await collectedByMonth(tx, ctx.branchIds, addMonths(monthStart, -7), today);
    money.byMonth = months.map((m) => ({ month: m.month, count: m.count, totalPaise: m.total }));
    const last = months.find((m) => m.month === addMonths(monthStart, -1).slice(0, 7))?.total ?? 0n;
    const now = money.thisMonth?.total ?? 0n;
    money.trendPct = last === 0n ? null : Math.round((Number(now - last) / Number(last)) * 1000) / 10;
```

Inside the `allows(ctx, "invoices:read")` block, widen what is kept:

```ts
    const owed = await owedSummary(tx, ctx.branchIds, today);
    money.owed = { invoices: owed.invoices, owedPaise: owed.owedPaise, overdueFamilies: owed.overdueFamilies };
    money.overduePaise = owed.overduePaise;
    money.dueTomorrow = owed.dueTomorrow;
```

`trendPct` is `null` when last month collected nothing — never `Infinity`, never a divide by zero.

- [ ] **Step 5: Add the `addMonths` helper**

`src/lib/dates.ts` has `addDays` but no month helper. Add it there, beside `addDays`:

```ts
// Shifts a YYYY-MM-DD by whole months, clamping to the 1st.
export function addMonths(date: string, months: number): string {
  const [y, m] = date.split("-").map(Number);
  const total = (y ?? 0) * 12 + (m ?? 1) - 1 + months;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}
```

Write its unit test in `src/lib/dates.test.ts` (create the file if absent):

```ts
import { describe, expect, it } from "vitest";
import { addMonths } from "./dates";

describe("addMonths", () => {
  it("shifts whole months across year boundaries and clamps to the 1st", () => {
    expect(addMonths("2026-10-03", -7)).toBe("2026-03-01");
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-10-03", 0)).toBe("2026-10-01");
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test:unit && pnpm test:integration -- dashboard`
Expected: PASS, including the three new integration cases.

- [ ] **Step 7: Commit**

```bash
git add src/modules/dashboard/service.ts src/lib/dates.ts src/lib/dates.test.ts src/modules/dashboard/dashboard.integration.test.ts
git commit -m "dashboard: roll, revenue history, attendance split and attention counts"
```

---

### Task 7: Nav reshaped into MAIN and MANAGEMENT

**Files:**
- Modify: `src/lib/auth/nav.ts`
- Test: Create `src/lib/auth/nav.test.ts`

**Interfaces:**
- Produces:
  - `NavParent = { title: NavLabel; icon: string; children: NavItem[] }`
  - `NavEntry = NavItem | NavParent`
  - `isParent(e: NavEntry): e is NavParent`
  - `NavGroup.items` becomes `NavEntry[]`
  - `navFor()` keeps its signature and now filters children too.

A parent has no `href` of its own — it is a disclosure, not a link. That is why it is a separate type rather than a `NavItem` with a fake href.

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth/nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isParent, navFor, type NavSession } from "./nav";

const session = (permissions: string[]): NavSession => ({ isOwner: false, modules: {}, permissions });

describe("navFor", () => {
  it("drops a parent whose children are all refused", () => {
    const groups = navFor(session(["students:read"]));
    expect(groups.flatMap((g) => g.items).some((i) => isParent(i))).toBe(false);
  });

  it("collapses a parent with one permitted child into that child", () => {
    const items = navFor(session(["invoices:read"])).flatMap((g) => g.items);
    const money = items.find((i) => !isParent(i) && i.href === "/invoices");
    expect(money).toBeDefined();
    expect(items.some((i) => isParent(i))).toBe(false);
  });

  it("keeps a parent when two or more children are permitted", () => {
    const items = navFor(session(["invoices:read", "payments:read"])).flatMap((g) => g.items);
    const parent = items.find((i) => isParent(i));
    expect(parent && isParent(parent) && parent.children.map((c) => c.href)).toEqual(["/invoices", "/payments"]);
  });

  it("puts every permitted destination in exactly one of the two groups", () => {
    const groups = navFor(session(["students:read", "staff:read", "settings:manage"]));
    expect(groups.map((g) => g.title)).toEqual(["MAIN", "MANAGEMENT"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:unit -- nav`
Expected: FAIL — `isParent is not exported`.

- [ ] **Step 3: Add the parent type**

```ts
export type NavParent = { title: NavLabel; icon: string; children: NavItem[] };
export type NavEntry = NavItem | NavParent;
export type NavGroup = { title: string; items: NavEntry[] };

export function isParent(entry: NavEntry): entry is NavParent {
  return "children" in entry;
}
```

- [ ] **Step 4: Rewrite `NAV_GROUPS` as two groups**

```ts
export const NAV_GROUPS: NavGroup[] = [
  {
    title: "MAIN",
    items: [
      { href: "/dashboard", label: { text: "Dashboard" }, icon: "LayoutDashboard", permission: null }, // blocks inside follow permissions
      { href: "/today", label: { labelKey: "session", form: "many", prefix: "Today's " }, icon: "CalendarDays", permission: "sessions:read" },
      { href: "/attendance", label: { text: "Attendance" }, icon: "ClipboardCheck", permission: "attendance:read" },
      { href: "/students", label: { labelKey: "student", form: "many" }, icon: "Users", permission: "students:read" },
      { href: "/staff", label: { labelKey: "staff", form: "many" }, icon: "UserCog", permission: "staff:read" },
      { href: "/batches", label: { labelKey: "batch", form: "many", prefix: "Programs & " }, icon: "Layers", permission: "batches:read" },
      {
        title: { text: "Fees & Payments" },
        icon: "IndianRupee",
        children: [
          { href: "/invoices", label: { text: "Invoices" }, icon: "Receipt", permission: "invoices:read" },
          { href: "/payments", label: { text: "Collection" }, icon: "Wallet", permission: "payments:read" },
          { href: "/payments/new", label: { text: "Collect payment" }, icon: "IndianRupee", permission: "fees:collect" },
        ],
      },
      { href: "/reports", label: { text: "Reports" }, icon: "BarChart3", permission: "reports:view" },
    ],
  },
  {
    title: "MANAGEMENT",
    items: [
      { href: "/enquiries", label: { text: "Enquiries" }, icon: "MessageSquare", permission: "enquiries:read" },
      { href: "/fee-plans", label: { text: "Fee plans" }, icon: "FileText", permission: "fee_plans:manage" },
      { href: "/messages", label: { text: "Messages" }, icon: "Send", permission: "messages:read" },
      { href: "/settings", label: { text: "Settings" }, icon: "Settings", permission: "settings:manage" },
      { href: "/billing", label: { text: "Billing" }, icon: "CreditCard", permission: "billing:view" },
    ],
  },
];
```

Child order is Invoices, Collection, Collect payment — the test in Step 1 asserts `["/invoices", "/payments"]` for a viewer with those two permissions.

- [ ] **Step 5: Teach `navFor` about children**

```ts
// A parent of one permitted child is just that child; of none, nothing at all.
function permit(session: NavSession, entry: NavEntry): NavEntry | null {
  if (isParent(entry)) {
    const children = entry.children.filter((c) => allowed(session, c));
    if (!children.length) return null;
    return children.length === 1 ? children[0]! : { ...entry, children };
  }
  return allowed(session, entry) ? entry : null;
}

export function navFor(session: NavSession, groups: NavGroup[] = NAV_GROUPS): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.map((i) => permit(session, i)).filter((i): i is NavEntry => i !== null) }))
    .filter((g) => g.items.length > 0);
}
```

`COACH_NAV` and `coachNavFor` are unchanged — they stay `NavItem[]`.

- [ ] **Step 6: Run the tests**

Run: `pnpm test:unit -- nav`
Expected: PASS, all four cases.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/nav.ts src/lib/auth/nav.test.ts
git commit -m "nav: two groups, with Fees & Payments as a parent of three"
```

---

### Task 8: Nav rendering — nested items and tooltips

**Files:**
- Modify: `src/components/shell/nav-link.tsx`
- Test: `src/components/shell/nav-link.test.ts`

**Interfaces:**
- Consumes: `NavParent`, `NavEntry`, `isParent` from Task 7.
- Produces: `anyActive(pathname: string, parent: NavParent, others: string[]): boolean`, and a `NavGroupItem` component that renders either a `NavLink` or a disclosure.

- [ ] **Step 1: Write the failing test**

Append to `src/components/shell/nav-link.test.ts`:

```ts
describe("anyActive", () => {
  const parent = {
    title: { text: "Fees & Payments" } as const,
    icon: "IndianRupee",
    children: [
      { href: "/invoices", label: { text: "Invoices" } as const, icon: "Receipt", permission: "invoices:read" as const },
      { href: "/payments", label: { text: "Collection" } as const, icon: "Wallet", permission: "payments:read" as const },
    ],
  };
  const all = ["/invoices", "/payments", "/students"];

  it("is open when the current page is one of its children", () => {
    expect(anyActive("/invoices", parent, all)).toBe(true);
    expect(anyActive("/payments/0192-abc", parent, all)).toBe(true);
  });

  it("is closed elsewhere", () => {
    expect(anyActive("/students/42", parent, all)).toBe(false);
    expect(anyActive("/dashboard", parent, all)).toBe(false);
  });
});
```

Add `anyActive` to the import at the top of the file.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:unit -- nav-link`
Expected: FAIL — `anyActive is not exported`.

- [ ] **Step 3: Implement the predicate**

In `src/components/shell/nav-link.tsx`, below `isActive`:

```ts
// A parent opens when the page is inside one of its children.
export function anyActive(pathname: string, parent: NavParent, others: string[] = []): boolean {
  return parent.children.some((c) => isActive(pathname, c.href, others));
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test:unit -- nav-link`
Expected: PASS.

- [ ] **Step 5: Add tooltips to the collapsed rail**

The collapsed rail is icon-only and today has only `title` plus an `sr-only` span. If `src/components/ui/tooltip.tsx` does not exist, add it with `pnpm dlx shadcn@latest add tooltip` — it is Base UI, already a dependency, so no new package.

Keep the existing `sr-only` label (it carries the accessible name when the tooltip is closed) and wrap the compact link. In `NavLink`, extract the current `<Link>` into `const link = (...)` and return:

```tsx
  if (!compact) return link;
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
```

Base UI's `render` prop is how this codebase composes triggers — `admin-shell.tsx:103` uses the same pattern on `SheetTrigger`. Mount one `<TooltipProvider>` in `AdminShell` around the `<aside>` in Task 9.

- [ ] **Step 6: Render parents as a disclosure**

Add to the same file:

```tsx
export function NavGroupItem({ entry, compact, onNavigate, others }: { entry: NavEntry; compact?: boolean | undefined; onNavigate?: (() => void) | undefined; others?: string[] }) {
  const pathname = usePathname();
  if (!isParent(entry)) return <NavLink item={entry} compact={compact} onNavigate={onNavigate} others={others} />;
  return <NavParentItem parent={entry} compact={compact} onNavigate={onNavigate} others={others} active={anyActive(pathname, entry, others)} />;
}

function NavParentItem({ parent, compact, onNavigate, others, active }: { parent: NavParent; compact?: boolean | undefined; onNavigate?: (() => void) | undefined; others?: string[]; active: boolean }) {
  const [open, setOpen] = useState(active);
  const label = useNavLabel({ href: "", label: parent.title, icon: parent.icon, permission: null });
  // Collapsed, the rail is 64px: show the children as a flat icon list, no popover.
  if (compact) return <>{parent.children.map((c) => <NavLink key={c.href} item={c} compact onNavigate={onNavigate} others={others} />)}</>;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn("flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-body text-neutral-700 hover:bg-neutral-50", active && "font-medium")}
      >
        <NavIcon name={parent.icon} />
        <span className="truncate">{label}</span>
        <icons.ChevronDown className={cn("ml-auto size-5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className="flex flex-col gap-0.5 pl-6">
          {parent.children.map((c) => (
            <NavLink key={c.href} item={c} onNavigate={onNavigate} others={others} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

Add `useState` to the `react` import; `icons`, `cn`, `usePathname`, `NavIcon` and `useNavLabel` are already in this file.

Note `active` seeds the initial open state only — once a person collapses the group it stays collapsed while they move within it, which is what a disclosure should do.

- [ ] **Step 7: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/shell/nav-link.tsx src/components/shell/nav-link.test.ts src/components/ui/tooltip.tsx
git commit -m "nav: nested Fees & Payments disclosure and tooltips on the collapsed rail"
```

---

### Task 9: Admin shell restyle

**Files:**
- Modify: `src/components/shell/admin-shell.tsx`

**Interfaces:**
- Consumes: `NavGroupItem` (Task 8), `NavEntry` (Task 7).

- [ ] **Step 1: Swap `NavLink` for `NavGroupItem` in `NavGroups`**

The `hrefs` list that feeds `others` must now include children:

```tsx
  const hrefs = groups.flatMap((g) => g.items.flatMap((i) => (isParent(i) ? i.children.map((c) => c.href) : [i.href])));
```

and the inner map renders `<NavGroupItem key={...} entry={item} ... others={hrefs} />`. Key a parent by its title text, an item by its href.

- [ ] **Step 2: Restyle the rail**

- Group heading: uppercase, `text-caption`, `text-muted-foreground`, unchanged in structure.
- Rail border stays `border-r border-neutral-300` (the token now resolves to `#E5E7EB`); drop any shadow.
- Active item already uses `bg-accent text-accent-foreground`, which now resolves to `#EFF6FF` / `#2563EB`. Keep the 1px left marker.

- [ ] **Step 3: Add the bottom profile block**

At the end of the `<aside>`, after `<NavGroups/>`. On phones nothing changes — the avatar stays in the header, where it is now.

```tsx
      <Link href="/me" className={cn("mt-auto flex min-h-14 items-center gap-3 rounded-lg border-t border-neutral-100 px-3 pt-3 hover:bg-neutral-50", !expanded && "justify-center px-0")}>
        <Avatar name={me} size="sm" />
        {expanded ? (
          <span className="min-w-0">
            <span className="block truncate text-label text-neutral-900">{me}</span>
            <span className="block truncate text-caption text-muted-foreground">{tenantName}</span>
          </span>
        ) : (
          <span className="sr-only">{me}</span>
        )}
      </Link>
```

`me`, `tenantName`, `Avatar`, `Link` and `cn` are all already in this file. Wrap the collapsed form in the same `<Tooltip>` used in Task 8 so the icon-only state has a visible name.

Also wrap the `<aside>` in `<TooltipProvider>` here — Task 8's collapsed links need it mounted.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

Then in Chrome: expand and collapse the rail, confirm the state still survives a reload (`localStorage` `bravitar.rail`), confirm `Fees & Payments` opens on `/invoices`, and confirm every tooltip appears when collapsed.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/admin-shell.tsx
git commit -m "shell: MAIN/MANAGEMENT rail with a profile block at the foot"
```

---

### Task 10: Charts

**Files:**
- Create: `src/components/dashboard/attendance-overview.tsx`
- Create: `src/components/dashboard/revenue-overview.tsx`
- Modify: `package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `Dashboard["today"]["attendance"]` and `Dashboard["money"]["byMonth"]` from Task 6.
- Produces:
  - `<AttendanceOverview data={{ present: number; absent: number; notMarked: number }} />`
  - `<RevenueOverview months={{ month: string; totalPaise: bigint }[]} collected={bigint} pending={bigint} overdue={bigint} />`

- [ ] **Step 1: Add the dependency**

Run: `pnpm dlx shadcn@latest add chart`

This pulls `recharts@3.10.1`, whose peer range is `^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0` — React 19.2.8 is supported. Confirm with `pnpm why recharts` that exactly one copy is installed.

- [ ] **Step 2: Build the attendance chart**

```tsx
"use client";

import { Check, Minus, X } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

type Split = { present: number; absent: number; notMarked: number };

// Status is never carried by colour alone: every slice repeats as an iconned line.
const ROWS = [
  { key: "present", label: "Present", icon: Check, fill: "var(--color-success-600)" },
  { key: "absent", label: "Absent", icon: X, fill: "var(--color-danger-600)" },
  { key: "notMarked", label: "Not marked", icon: Minus, fill: "var(--color-neutral-300)" },
] as const;

export function AttendanceOverview({ data }: { data: Split }) {
  const total = data.present + data.absent + data.notMarked;
  const slices = ROWS.map((r) => ({ ...r, value: data[r.key] })).filter((r) => r.value > 0);
  return (
    <div className="flex flex-wrap items-center gap-6">
      <figure aria-label={`Attendance today: ${data.present} present, ${data.absent} absent, ${data.notMarked} not marked`} className="h-40 w-40 shrink-0">
        {total > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={slices} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="100%" strokeWidth={0} isAnimationActive={false}>
                {slices.map((s) => (
                  <Cell key={s.key} fill={s.fill} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : null}
      </figure>
      <ul className="min-w-0 flex-1">
        {ROWS.map((r) => {
          const Icon = r.icon;
          return (
            <li key={r.key} className="flex min-h-10 items-center gap-2 text-body">
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 truncate text-muted-foreground">{r.label}</span>
              <span className="ml-auto tabular-nums text-neutral-900">{data[r.key]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

An academy with nothing marked renders the legend of zeroes and no donut, rather than an empty circle.

- [ ] **Step 3: Build the revenue chart**

```tsx
"use client";

import { Bar, BarChart, ResponsiveContainer, XAxis } from "recharts";
import { formatPaise } from "@/lib/money/format";

type Month = { month: string; totalPaise: bigint };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const tick = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1] ?? m;

export function RevenueOverview({ months, collected, pending, overdue }: { months: Month[]; collected: bigint; pending: bigint; overdue: bigint }) {
  // bigint crosses to number only here, at the Recharts boundary, in rupees.
  const data = months.map((m) => ({ tick: tick(m.month), rupees: Number(m.totalPaise / 100n) }));
  const figures = [
    { label: "Collected", value: collected },
    { label: "Pending", value: pending },
    { label: "Overdue", value: overdue },
  ];
  return (
    <div>
      <figure aria-label={`Collection by month: ${months.map((m) => `${tick(m.month)} ${formatPaise(m.totalPaise)}`).join(", ")}`} className="h-44">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="tick" tickLine={false} axisLine={false} tick={{ fontSize: 13, fill: "var(--color-neutral-500)" }} />
              <Bar dataKey="rupees" fill="var(--color-accent-600)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-body text-muted-foreground">No collection yet.</p>
        )}
      </figure>
      <dl className="mt-4 grid grid-cols-3 gap-2">
        {figures.map((f) => (
          <div key={f.label}>
            <dt className="text-caption text-muted-foreground">{f.label}</dt>
            <dd className="text-number text-neutral-900">{formatPaise(f.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
```

The `aria-label` carries every month's value as text, so the chart survives without sight or hover — the same contract `Columns` in `src/components/reports/bars.tsx` already honours.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/components/ui/chart.tsx src/components/dashboard/
git commit -m "dashboard: attendance and revenue charts"
```

---

### Task 11: Dashboard sections and page

**Files:**
- Create: `src/components/dashboard/dashboard-header.tsx`, `todays-schedule.tsx`, `fee-collection.tsx`, `attention-required.tsx`, `pipeline.tsx`, `quick-actions.tsx`
- Modify: `src/components/stat-card.tsx`
- Modify: `src/app/(tenant)/dashboard/page.tsx`

**Interfaces:**
- Consumes: the whole `Dashboard` type from Task 6; `AttendanceOverview` and `RevenueOverview` from Task 10.
- Produces: nothing other tasks depend on.

This task creates six files plus two modifications. The project rule is not to create more than ~6 files in one turn without stopping for review — so split it: Steps 1-4 (header, stat card, schedule, quick actions), then review, then Steps 5-8 (fee collection, attention, pipeline, page).

- [ ] **Step 1: Extend `StatCard`, do not add a second card**

`src/components/stat-card.tsx` already does label, value, icon and "every number links to the list behind it". Add two optional props and nothing else:

```tsx
export function StatCard({ label, value, icon: Icon, href, note, trend }: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  href: string;
  note?: string;
  trend?: number | null | undefined;
}) {
```

Keep the existing body and add, under the value:

```tsx
      {note || (trend !== null && trend !== undefined) ? (
        <span className="flex items-center gap-2 text-caption">
          {trend !== null && trend !== undefined ? (
            // An arrow carries the direction too; colour alone never does.
            <span className={cn("inline-flex items-center gap-0.5 tabular-nums", trend < 0 ? "text-danger-700" : "text-success-700")}>
              {trend < 0 ? <ArrowDown className="size-3.5" aria-hidden /> : <ArrowUp className="size-3.5" aria-hidden />}
              {trend < 0 ? "" : "+"}
              {trend}%
            </span>
          ) : null}
          {note ? <span className="text-muted-foreground">{note}</span> : null}
        </span>
      ) : null}
```

`trend` is `Dashboard["money"]["trendPct"]` passed straight through: `null` means last month collected nothing, and the chip is omitted.

- [ ] **Step 2: `dashboard-header.tsx`**

```tsx
const greeting = (hour: number) => (hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening");

export function DashboardHeader({ name, hour, date, canAddStudent, canCollect }: { name: string; hour: number; date: string; canAddStudent: boolean; canCollect: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-display">{`${greeting(hour)}, ${name.split(" ")[0]} 👋`}</h1>
        <p className="text-caption text-muted-foreground">{date}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {canAddStudent ? <Button render={<Link href="/students/new" />} variant="outline"><Plus />Add student</Button> : null}
        {canCollect ? <Button render={<Link href="/payments/new" />}><Plus />Collect fee</Button> : null}
      </div>
    </div>
  );
}
```

`hour` is the tenant-local hour — the page computes it from the `tz` it already has. The 👋 is a greeting, not a UI icon, and is the only emoji on the page. Collect fee is the page's one accent-filled button.

Use `render={<Link/>}` rather than nesting — this codebase's `Button` is Base UI and a memory note records that link buttons need the render prop, not a nested anchor.

- [ ] **Step 3: `todays-schedule.tsx`**

One row per class, keyed by `c.session.id`, each linking to `/sessions/{id}`, `min-h-14`:

```tsx
        <span className="block text-body font-medium text-neutral-900">{c.batchName}</span>
        <span className="block text-caption text-muted-foreground">
          {formatTimeRange(timeIn(tz, c.session.startsAt), timeIn(tz, c.session.endsAt))}
          {c.coachName ? ` · ${c.coachName}` : ""}
        </span>
```

and on the right, the roster figure then `<ClassStatus c={c} />`:

```tsx
        <span className="tabular-nums text-label">{c.capacity === null ? c.students : `${c.students}/${c.capacity}`}</span>
```

Capacity is nullable — a batch without one shows the student count alone, never `18/null` and never `18/0`. Keep the existing "No classes today." empty state.

- [ ] **Step 4: `quick-actions.tsx`**

Five links — Add student, Create batch, Mark attendance, Collect payment, Send announcement — each permission-gated, each ≥44px, visually secondary (outline or ghost, never accent-filled; the page already has its one accent button in the header).

- [ ] **Step 5: Stop and have the work so far reviewed, then continue.**

- [ ] **Step 6: `fee-collection.tsx` and `attention-required.tsx`**

Fee collection: Collected / Pending / Overdue as three figures plus the existing `Meter` from `src/components/reports/bars.tsx` showing collected against the total.

Attention required: a compact list, each row an icon plus a short line, each linking to the list behind it.

```tsx
export type Alert = { key: string; n: number; text: string; href: string; icon: LucideIcon; tone: "warning" | "danger" | "muted" };

export function AttentionRequired({ alerts }: { alerts: Alert[] }) {
  const shown = alerts.filter((a) => a.n > 0);
  if (!shown.length) return null; // nothing to attend to is not an empty card
  return (
    <Card>
      <CardHeader title="Attention required" />
      <ul className="divide-y divide-neutral-100">
        {shown.map((a) => {
          const Icon = a.icon;
          return (
            <li key={a.key}>
              <Link href={a.href} className="flex min-h-12 items-center gap-3 py-2 text-body hover:bg-neutral-50">
                <Icon className={cn("size-5 shrink-0", a.tone === "danger" && "text-danger-700", a.tone === "warning" && "text-warning-700", a.tone === "muted" && "text-muted-foreground")} aria-hidden />
                <span className="min-w-0">{a.text}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
```

The page builds the list from Task 6's payload — `money.dueTomorrow`, `today.nearCapacity`, `pipeline.month.received`, `roll.waitingForBatch`, and the two `atRisk` counts — omitting any whose slice is absent for this viewer. A row whose count is zero does not render; if every row is zero the card does not render at all.

`nearCapacity` is derived from today's classes, so its text must say so — "near capacity today", not "near capacity". Do not let the label imply all batches.

- [ ] **Step 7: `pipeline.tsx`**

Lift the existing Pipeline block out of `page.tsx` unchanged in behaviour — the four funnel figures and "Your follow-ups".

- [ ] **Step 8: Rewrite `page.tsx`**

Keep it a server component with the same `requireStaffPage()` / `scopedCtx` / `withTenant(dashboardData)` opening. It becomes composition only: header, the four `StatCard`s in `grid-cols-2 lg:grid-cols-4`, then the sections in `lg:grid-cols-2`. Every section renders only when its slice of the payload is present — that is the permission gate. Keep the existing "Nothing to show for your role yet" empty state.

The four KPIs: Active students (`roll.active`, note `+{roll.joinedThisMonth} this month`) · Today's attendance · Fees due (`money.owed.owedPaise`, note from `money.owed.invoices`) · This month (`money.thisMonth.total`, `trend={money.trendPct}`).

The attendance percentage must not divide by zero on a day with no roster:

```tsx
const att = d.today?.attendance;
const seen = att ? att.present + att.absent + att.notMarked : 0;
const pct = seen ? Math.round((att!.present / seen) * 100) : null;
// An academy with no classes today shows a dash, not NaN%.
<StatCard label="Today's attendance" value={pct === null ? "—" : `${pct}%`} note={seen ? `${att!.present} / ${seen}` : "No classes today"} icon={ClipboardCheck} href="/attendance" />
```

- [ ] **Step 9: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/dashboard/ src/components/stat-card.tsx "src/app/(tenant)/dashboard/page.tsx"
git commit -m "dashboard: rebuild on the new sections"
```

---

### Task 12: Seed, full verification, Chrome pass

**Files:**
- Modify: `src/lib/db/seed.ts`

- [ ] **Step 1: Make every new section visibly non-empty**

Read `src/lib/db/seed.ts` (312 lines) first and follow its existing helpers rather than bolting on a new style. After the change, `pnpm seed` must produce, for the demo karate academy, all five of:

1. at least one batch with `capacity` set and a roster at ≥90% of it (feeds `nearCapacity` and the `18/20` figure),
2. at least one batch with `capacity` left `null` (proves the nullable path renders),
3. payments on dates spread across the last eight calendar months (feeds the revenue chart and `trendPct`),
4. at least one issued invoice with `dueDate` = tomorrow (feeds `dueTomorrow`),
5. at least one active student with no active enrollment (feeds `waitingForBatch`).

Without these the new dashboard looks broken in demo.

- [ ] **Step 2: Reseed and verify**

```bash
pnpm db:up && pnpm migrate && pnpm seed
```

- [ ] **Step 3: Full suite**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:isolation`
Expected: all PASS. Report the real output — a failing test reported as passing is the worst outcome here.

- [ ] **Step 4: Chrome pass**

On `<slug>.localhost:3000` (Demo@1234):
- `/dashboard` at desktop width: four KPIs across, two-column sections, no horizontal scroll.
- `/dashboard` at 390px: KPIs two-up, charts resized, no horizontal overflow, quick actions tappable.
- Rail collapsed: every icon has a tooltip; `Fees & Payments` opens on `/invoices`.
- Keyboard only: tab through the page, confirm a visible focus ring everywhere and that the disclosure opens on Enter.
- Spot-check `/students`, `/invoices` and `/settings` under the new tokens — nothing should look broken.
- Sign in as a Coach: confirm no money KPI, no revenue chart, no fee card.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/seed.ts
git commit -m "seed: data behind every dashboard section"
```

---

## Follow-ups (not this plan)

- Rewrite `docs/07-ui-ux.md` §2: one accent, the new palette, the two-tier status tokens, and remove the per-type table.
- Per-page polish for the rest of the tenant area.
- Coach shell, parent portal, platform area.
