# Finance module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One coherent Finance module under `/finance` where every rupee shows who, what, why, which plan, how much, where it went and what is still owed — built by changing the existing fees and payments code, not rewriting it.

**Architecture:** Pages move under `src/app/(tenant)/finance/` with `git mv` and are then changed. Money rules stay in `src/modules/fees` and `src/modules/payments`; read-only aggregates go in `src/modules/reports/service.ts`. Lists follow the Students list pattern (URL filters, table from `md`, cards below, 10 a page). Drawers are URL-driven sheets (`?collect=1`, `?create=1`) loaded by the server page.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Drizzle on Supabase Postgres with RLS, Vitest (unit, integration, isolation projects), Tailwind + shadcn/ui, Recharts (time series only).

**Spec:** `docs/superpowers/specs/2026-10-18-finance-module-design.md` — read it with this plan.

## Global Constraints

- Money is `bigint` paise end to end; format only in UI (`formatPaise`, `<Money>`). Paise cross JSON as digit strings.
- IDs from `uuidv7()` (`@/lib/ids`). Dates are the academy's day: `todayIn(tz, now)`; every new service takes `opts: { now?: Date }`.
- Every service calls `assertCan(ctx, key)`; every route uses `withStaffRequest(key, …)`. **No new permission keys. No new dependencies.**
- Screen words, exactly: invoice statuses **Draft · Due · Part paid · Overdue · Paid · Cancelled**; payment statuses **Received · Part refunded · Refunded · Cancelled**; later unpaid installments **Upcoming**; the student-side subscription is **Student plan**; spelling **installment**.
- Status colours: Paid `success`, Due `warning`, Overdue `danger`, Part paid `accent`, Draft and Cancelled `neutral`; `-700` for text, `-600` for fills.
- Tabs are `SegmentedTabs` pills with the count in the label (`Due · 17`). Tables from `md` up, cards below; never a sideways-scrolling table on a phone. Page size 10.
- UI text short: a label or one line, no paragraph hints. Code comments one or two lines.
- Charts: product blue; status colours only on the fee-status bar; Recharts only for the collection trend, CSS (`components/reports/bars.tsx`) for everything else.
- Migrations: next free number, `-- up` and `-- down` sections, never edit an applied one. Nothing new in the `public` schema.
- Parent-facing paths `/i/<token>`, `/r/<token>`, `/portal/*` and every `/api/*` path stay where they are.
- `git add` by explicit path only — never `-A` or `.`: the working tree holds the user's own untracked files (`docs/*.webp`, `docs/bravitar-analysis-report.md`, `.claude/settings.json`).
- Commit subjects follow the repo: `<area>: <what changed>`, lower case, plus the session's attribution lines.
- Every task ends with `pnpm typecheck && pnpm lint && pnpm test && pnpm test:isolation` all passing (needs `pnpm db:up`), then a Chrome check on `<slug>.localhost:3000` (`owner@<slug>.demo` / `Demo@1234`), restoring any dev data the check changed. Report failures as failures.
- Never change the working tree while another agent is running the suite.

## Review Focus

1. **A double tap on Record with a New charge** must make one invoice and one payment, also when both requests arrive together → Task 8 test "the same request id twice makes one charge and one payment".
2. **Front Desk widening the Collections URL** (`?period=all&collector=<someone else>`) must still see only their own receipts today → Task 10 test "Front Desk sees only their own receipts today, whatever the URL asks".
3. **A viewer limited to one branch** must never see another branch in tab counts, Overview totals or the advance list → tests in Tasks 5, 15 and 16 named "… one branch …".
4. **Odd paise on a two-program invoice** must still make revenue by program add up to the collection total exactly → Task 11 unit test on `spreadOver` and Task 16 test "program rows plus advance equal the collection total to the paisa".
5. **A payment recorded at 23:50 IST** belongs to that Indian day in Today and This week → Task 10 test "a payment at 23:50 IST is that day's".

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/lib/auth/nav.ts` (+ tests) | Finance children, any-of permissions, static titles | 1, 4, 11, 15, 16, 17 |
| `src/app/(tenant)/finance/**` | all finance pages (moved and new) | 1–17 |
| `src/modules/fees/billing.ts` | pure rules: display status, installment position, period label, spread, next bill, installment split | 5, 11, 14 |
| `src/modules/fees/repo.ts` | invoice, student plan and discount queries | 5, 7, 11, 15, 16 |
| `src/modules/fees/service.ts` | invoice list, manual invoices, issue core, student plans, settings | 5, 7, 9, 11, 12 |
| `src/modules/fees/invoicing.ts` | generation (manual drafts excluded, auto-issue) | 6, 7, 9 |
| `src/modules/payments/repo.ts` | receipt detail, money history, payment list, advance holders | 2, 6, 10, 15 |
| `src/modules/payments/service.ts` | collect screen, use advance, desk charge, collections list | 2, 3, 4, 8, 10 |
| `src/modules/payments/allocation.ts` | pure split preview | 4 |
| `src/modules/reports/service.ts`, `routes.ts`, `csv.ts` | overview, revenue, register refunds, CSV registry | 10, 15, 16, 17 |
| `src/components/filter-bar.tsx` (new) | URL filter bar shared by Students, Invoices, Collections, Student plans | 5 |
| `src/components/payments/collect-form.tsx` | the collect drawer | 4, 8 |
| `src/components/fees/create-invoice.tsx` (new) | create / edit manual invoice sheet | 7 |
| `src/components/fees/status-bar.tsx` (new) | CSS stacked fee-status bar | 16 |

---

## Slice 1 — Move under /finance

### Task 1: Move the finance pages under /finance

Behaviour does not change; only paths do.

**Files:**
- Move: `src/app/(tenant)/invoices/` → `src/app/(tenant)/finance/invoices/`; `src/app/(tenant)/payments/page.tsx` → `src/app/(tenant)/finance/collections/page.tsx`; `src/app/(tenant)/payments/[id]/page.tsx` → `src/app/(tenant)/finance/collections/[id]/page.tsx`; `src/app/(tenant)/payments/new/page.tsx` → `src/app/(tenant)/finance/collections/new/page.tsx`; `src/app/(tenant)/fee-plans/page.tsx` → `src/app/(tenant)/finance/fee-plans/page.tsx`
- Modify: `src/lib/auth/nav.ts`, every file `grep` finds below
- Test: `src/lib/auth/nav.test.ts`, `src/components/shell/nav-link.test.ts`

**Interfaces:**
- Produces: routes `/finance/invoices`, `/finance/invoices/[id]`, `/finance/collections`, `/finance/collections/[id]`, `/finance/collections/new` (until Task 4), `/finance/fee-plans`.

- [ ] **Step 1: Update the nav tests to the new paths**

In `nav.test.ts`, the owner's list becomes
`["/dashboard","/today","/attendance","/students","/enquiries","/batches","/finance/invoices","/finance/collections","/finance/collections/new","/finance/fee-plans","/reports","/staff","/messages","/settings","/billing"]`;
every other `/invoices`, `/payments`, `/payments/new`, `/fee-plans` in that file and in
`nav-link.test.ts` gets the `/finance/...` form; the receipt crumb test becomes
`crumbsFor("/finance/collections/0192-abc", "Receipt 7")` →
`[{Finance, null}, {Collections, "/finance/collections"}, {Receipt 7, null}]`.

- [ ] **Step 2: Run them — expect FAIL**

Run: `pnpm exec vitest run --project unit src/lib/auth/nav.test.ts src/components/shell/nav-link.test.ts`
Expected: FAIL on the old hrefs.

- [ ] **Step 3: Move the pages and update hrefs**

`git mv` each path above. In `nav.ts` change the four Finance child hrefs. Change each
`PageProps<"/old">` to `PageProps<"/finance/...">`. Then update every link:
`grep -rnE "[\"'\`](/invoices|/payments|/fee-plans)" src --include='*.ts' --include='*.tsx'`
must return only `/api/...` paths and `src/modules/integrations/razorpay.ts` (a Razorpay API path).
Known hits: `dashboard/page.tsx`, `dashboard-header.tsx`, `students/[id]/page.tsx`,
`fees-card.tsx`, `still-due.tsx`, `collect-form.tsx`, `reports/collection/page.tsx`, and the moved pages.

- [ ] **Step 4: Run the full checks — expect PASS**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:isolation`

- [ ] **Step 5: Chrome check**

Sidebar Finance items open; dashboard "Collect payment", the student page "Collect", an invoice's "Collect", a receipt's invoice link and the register's day links all land on `/finance/...`; breadcrumbs read Finance › ….

- [ ] **Step 6: Commit** — `finance: every finance page lives under /finance` (add the moved and edited paths by name).

---

## Slice 2 — Collect payment and receipt

### Task 2: The receipt says what it paid for and what is still owed

**Files:**
- Create: `migrations/0040_receipt_balance.sql`
- Modify: `src/modules/payments/schema.ts`, `src/modules/payments/repo.ts` (`receiptLines`), `src/modules/payments/service.ts` (`recordPayment`, `recordGatewayPayment`, `Receipt`, `receiptOf`), `src/components/payments/receipt-card.tsx`, `src/app/(tenant)/finance/collections/[id]/page.tsx`
- Test: `src/modules/payments/payments.integration.test.ts`

**Interfaces:**
- Produces: `Payment.balanceAfterPaise: bigint | null`;
  `type ReceiptItem = { description: string; studentName: string | null; periodStart: string | null; periodEnd: string | null }`;
  `type ReceiptLine = { invoiceId: string; number: string | null; amountPaise: Paise; items: ReceiptItem[] }`;
  `Receipt` gains `students: string[]` and `balanceAfterPaise: Paise | null`;
  `ReceiptCard({ r, invoiceHref?, showNotes? }: { …; showNotes?: boolean })`.

- [ ] **Step 1: Write the failing tests** (in `describe("payments")`; the `bill` helper makes invoices without lines, so add lines with `insertLines` where a description is asserted)

`kid` is a member made by the file's `family()` helper; `name(kid)` is their full name.

```ts
it("the receipt names what each invoice was for and whose it is", async () => {
  // a ₹1,500 invoice for kid with one line "Karate Kids", period 2026-09-01..2026-09-30
  const r = await receiptOf((await pay(kid, 1500)).id);
  expect(r.lines[0]?.items[0]).toMatchObject({ description: "Karate Kids", studentName: name(kid), periodStart: "2026-09-01", periodEnd: "2026-09-30" });
  expect(r.students).toEqual([name(kid)]);
});
it("balance after counts the payer's other open invoices in the branch", async () => {
  // two ₹1,500 invoices for kid, pay ₹1,500
  expect((await receiptOf(p.id)).balanceAfterPaise).toBe(150_000n);
});
it("an all-advance receipt names the payer's active children", async () => {
  // kid owes nothing; pay ₹500
  expect(r.lines).toEqual([]);
  expect(r.students).toEqual([name(kid)]);
});
it("a later refund leaves the receipt's balance as recorded", async () => {
  // pay ₹1,500 against two ₹1,500 invoices, then refund ₹500 of it
  expect((await receiptOf(p.id)).balanceAfterPaise).toBe(150_000n);
});
it("an online payment records its balance after too", async () => {
  // recordGatewayPayment paying kid's only ₹1,500 invoice in full
  expect(p.balanceAfterPaise).toBe(0n);
});
```
And under `describe("at the database") › "a payment"`: add `{ balanceAfterPaise: 1n }` to the
patches that must fail with `DENIED`.

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm exec vitest run --project integration src/modules/payments/payments.integration.test.ts -t "receipt|balance"`

- [ ] **Step 3: Migration** — up: `ALTER TABLE app.payments ADD COLUMN balance_after_paise bigint CHECK (balance_after_paise >= 0);` down: `ALTER TABLE app.payments DROP COLUMN balance_after_paise;`. The column-level UPDATE grant from 0015 already leaves it un-updatable. Run `pnpm migrate`.

- [ ] **Step 4: Implement**

- `recordPayment` / `recordGatewayPayment`: before `insertPayment`, `owedBefore = sum` of `totalPaise - paidPaise` over `openInvoices(tx, payer, branchId)` (all members); insert `balanceAfterPaise: owedBefore - sum(shares)`.
- `receiptLines`: still only `kind = 'receipt'` rows; fill `items` from `linesOf(tx, invoiceIds)`.
- `receiptOf`: `students` = distinct `items[].studentName`; when there are no lines, the payer's children from `activeStudentsOf(tx, { branchIds: [] }, [payer])`.
- `ReceiptCard`: "For" row (students); each Towards line shows number, item descriptions with period ("Oct 2026"), student and amount; "Kept as advance ₹X — pays the next invoice by itself"; "Balance due after this payment" when not null; notes only when `showNotes`. The staff page passes `showNotes`; the parent's `/r/<token>` page does not.

- [ ] **Step 5: Run the tests, then the full checks — expect PASS**

- [ ] **Step 6: Chrome check** — open a seeded receipt and print preview: For, Towards with descriptions, balance (blank on old receipts is fine), no notes on `/r/<token>`.

- [ ] **Step 7: Commit** — `payments: a receipt says what it paid and what is still owed`.

### Task 3: The collect screen knows every payer; Card; Use advance now

**Files:**
- Modify: `src/modules/payments/service.ts` (`HAND_METHODS`, `collectScreen`, new `useAdvance`), `src/modules/payments/routes.ts`
- Create: `src/app/api/payments/advance/route.ts` (re-exports `useAdvanceRoute as POST`)
- Test: `src/modules/payments/payments.integration.test.ts`

**Interfaces:**
- Consumes: `openInvoicesOfMembers`, `payersOfMembers`, `unusedPayments`, `memberIdsWithSiblings`, `applyAdvance`, `enrollmentsOfStudent`.
- Produces:
  `HAND_METHODS = ["cash", "upi", "card", "bank_transfer", "cheque"] as const`;
  `type DueRow = OpenInvoiceRow & { description: string; students: string[] }`;
  `type PlanLine = { enrollmentId: string; studentName: string; programName: string; batchName: string; planName: string; kind: FeePlan["kind"]; cycle: FeePlan["billingCycle"]; amountPaise: Paise }`;
  `type PayerOption = { key: string; payer: Payer; name: string; relation: string | null; open: DueRow[]; advancePaise: Paise; plans: PlanLine[] }`;
  `type CollectScreen = { memberId: string; memberName: string; branchId: string; branchName: string; today: string; earliest: string; payers: PayerOption[]; defaultPayerKey: string | null; gst: boolean; enrollments: { id: string; programId: string; programName: string; batchName: string }[] }`;
  `collectScreen(tx, ctx, memberId, branchId, opts): Promise<CollectScreen>`;
  `useAdvanceSchema = z.object({ branchId: z.uuid(), payerGuardianId: z.uuid().optional(), payerMemberId: z.uuid().optional() })`;
  `useAdvance(tx, ctx, input): Promise<{ appliedPaise: Paise }>`; `useAdvanceRoute` (`fees:collect`) at `POST /api/payments/advance`.

- [ ] **Step 1: Write the failing tests**

```ts
it("a split-payer family lists each payer with only their own dues", async () => {
  // child with mother paying one enrollment's invoice (₹1,500) and father another (₹2,000)
  const s = await withTenant(T, (tx) => collectScreen(tx, desk, child, main, { now: NOW }));
  expect(s.payers.map((p) => [p.name, p.open.map((o) => o.balancePaise)])).toEqual([["Father", [200_000n]], ["Mother", [150_000n]]]);
  expect(s.defaultPayerKey).toBeNull();
});
it("one payer with dues is the default", async () => { expect(s.defaultPayerKey).toBe(payerKey({ kind: "guardian", guardianId: mother })); });
it("card can be recorded by hand; online cannot", async () => {
  await expect(pay(child, 500, { method: "card" })).resolves.toMatchObject({ method: "card" });
  await expect(pay(child, 500, { method: "online" as never })).rejects.toMatchObject({ status: 400 });
});
it("use advance pays the payer's open invoices oldest first, in that branch only", async () => {
  // ₹1,000 advance in main; open ₹600 (due 5 Sep) and ₹600 (due 10 Sep) in main; ₹600 open in other
  expect((await useAdv(mother, main)).appliedPaise).toBe(100_000n);
  expect(await state(sep5)).toEqual(["paid", 60_000n]);
  expect(await state(sep10)).toEqual(["part_paid", 40_000n]);
  expect(await state(otherBranch)).toEqual(["issued", 0n]);
});
it("use advance with nothing owed moves nothing", async () => { expect((await useAdv(mother, main)).appliedPaise).toBe(0n); });
it("use advance needs fees:collect", async () => { await expect(useAdv(mother, main, teacher)).rejects.toMatchObject({ status: 403 }); });
```

- [ ] **Step 2: Run — expect FAIL**

Test helper: `const useAdv = (guardianId: string, branchId: string, as = desk) => withTenant(T, (tx) => useAdvance(tx, as, { branchId, payerGuardianId: guardianId }, { now: NOW }))`.

- [ ] **Step 3: Implement** — `collectScreen` lists payers (sorted by name) with open invoices or advance in the branch, plus the default payer even with neither; `defaultPayerKey` = the only payer with dues, else (nobody owes) the only live guardian, else the member when there is no guardian, else null. `DueRow.description` from the invoice's lines ("Swimming Beginner · Oct 2026"). `relation` is the guardian's relation to the opened member, else to any of the siblings. `useAdvance` checks the branch is in scope, then calls `applyAdvance(tx, actor(ctx), payer, branchId)`. Update `/finance/collections/new/page.tsx` to the new `CollectScreen` shape (it is deleted in Task 4).

- [ ] **Step 4: Run tests, then full checks — expect PASS**

- [ ] **Step 5: Commit** — `payments: the collect screen lists every payer; card by hand; use advance now`.

### Task 4: The Collect payment drawer on Collections

**Files:**
- Modify: `src/components/payments/collect-form.tsx` (becomes `CollectDrawer` + `MemberSearch`), `src/app/(tenant)/finance/collections/page.tsx`, `src/modules/payments/allocation.ts`, `src/modules/payments/service.ts` (`collectTarget`, `myReceiptsToday`), `src/modules/payments/repo.ts` (`paymentsRecordedOn` gains optional `receivedBy`), `src/lib/auth/nav.ts`, links from Task 1 that point at `/finance/collections/new`
- Delete: `src/app/(tenant)/finance/collections/new/page.tsx`
- Test: `src/modules/payments/allocation.test.ts`, `src/modules/payments/payments.integration.test.ts`, `src/lib/auth/nav.test.ts`, `src/components/shell/nav-link.test.ts`

**Interfaces:**
- Consumes: `CollectScreen`, `useAdvanceRoute` (Task 3).
- Produces:
  `splitPreview(amount: Paise, open: Open[], chosen?: Share[]): Split & { stillDue: Paise }` (allocation.ts; `picked` when `chosen`, else `oldestFirst`);
  `collectTarget(tx, ctx, q: { studentId?: string; invoiceId?: string }): Promise<{ memberId: string; branchId: string; preselect: string[] } | null>`;
  `myReceiptsToday(tx, ctx, opts): Promise<SheetPayment[]>` (`fees:collect`; recorded today by `ctx.staffId`, branches in scope);
  `NavItem.permission: PermissionKey | PermissionKey[] | null` (a list = any of);
  `MemberSearch({ hrefFor }: { hrefFor: (studentId: string) => string })`;
  `CollectDrawer({ screen, preselect, closeHref }: { screen: CollectScreen; preselect: string[]; closeHref: string })`;
  drawer URL: `/finance/collections?collect=1[&student=<id>][&invoice=<id>]`.

- [ ] **Step 1: Write the failing tests**

```ts
// allocation.test.ts
it("previews a split and what is still due", () => {
  expect(splitPreview(200_000n, [{ invoiceId: "a", balance: 150_000n }, { invoiceId: "b", balance: 150_000n }]))
    .toEqual({ shares: [{ invoiceId: "a", amountPaise: 150_000n }, { invoiceId: "b", amountPaise: 50_000n }], advance: 0n, stillDue: 100_000n });
});
// payments.integration.test.ts
it("Front Desk's own receipts today, nobody else's and not yesterday's", async () => {
  // desk pays twice today, desk2 once today, desk once on NOW - 1 day
  expect((await withTenant(T, (tx) => myReceiptsToday(tx, desk, { now: NOW }))).length).toBe(2);
});
it("collectTarget opens an invoice's member with that invoice ticked", async () => { /* inv of child */ expect(t).toEqual({ memberId: child, branchId: main, preselect: [inv.id] }); });
// nav.test.ts
it("Front Desk reaches Collections through fees:collect", () => {
  expect(hrefs(navFor({ isOwner: false, modules: all, permissions: PRESET_ROLES["Front Desk"].permissions }))).toContain("/finance/collections");
});
```
Owner order becomes `"/finance/collections","/finance/invoices","/finance/fee-plans"`; drop every `/finance/collections/new` expectation and the "Collect payment" crumb test.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement the server side** — `allowed()` accepts a list (any key passes); Collections `permission: ["payments:read", "fees:collect"]`, ordered before Invoices; the Collect payment item goes. The Collections page: with `collect=1` it resolves `collectTarget` (or shows `MemberSearch` with `hrefFor = id => ?collect=1&student=id`), loads `collectScreen`, and renders the drawer open. A viewer with only `fees:collect` gets the Collect button and `myReceiptsToday`; `payments:read` keeps today's sheet as now.

- [ ] **Step 4: Implement the drawer** (spec "Collect payment drawer" sections 1–8): `Sheet side="auto"`, full height on phones; payer step only when `defaultPayerKey` is null or the user taps "Change"; purpose radio **Fees due / Advance**; "Change split" edits per-invoice amounts and runs `splitPreview` with the same messages the server throws; methods Cash · UPI · Card · Bank · Cheque; reference label per method; received on; notes; **Use advance now** when the chosen payer has advance and dues (POSTs `/api/payments/advance`, then `router.refresh()`); Record always sends the chosen payer's id, so "Say who is paying" can no longer happen; success → `/finance/collections/<id>`. On phones Collections shows a sticky bottom Collect button. Every Collect link becomes the drawer URL (dashboard header, student page, invoice page).

- [ ] **Step 5: Delete `finance/collections/new/page.tsx`; run tests and full checks — expect PASS**

- [ ] **Step 6: Chrome check** — as owner: drawer from Collections, from a student, from an invoice; a split-payer family (set an enrollment's payer override in the UI if the seed lacks one, and restore it after) asks who is paying; Change split; Card; advance purpose; receipt opens. As a Front Desk user: sidebar shows Collections, the page shows only their receipts today. Phone width: sticky button, full-height drawer.

- [ ] **Step 7: Commit** — `payments: collect is a drawer on Collections and asks who is paying`.

---

## Slice 3 — Invoices

### Task 5: Invoice list — statuses, tabs with counts, filters, paging

**Files:**
- Create: `src/components/filter-bar.tsx`
- Modify: `src/modules/fees/billing.ts`, `src/modules/fees/repo.ts` (`listInvoices`, remove `INVOICE_VIEWS`/`viewFilter`), `src/modules/fees/service.ts` (`invoiceList`, `studentFees`), `src/components/fees/invoice-status.tsx`, `src/components/students/search-bar.tsx` (uses `FilterBar`), `src/app/(tenant)/finance/invoices/page.tsx`, callers of `InvoiceStatus` (`fees-card.tsx`, invoice detail)
- Test: `src/modules/fees/billing.test.ts`, `src/modules/fees/fees.integration.test.ts`

**Interfaces:**
- Produces:
  `DISPLAY_STATUSES = ["draft", "due", "part_paid", "overdue", "paid", "cancelled"] as const`; `type DisplayStatus`;
  `displayStatus(inv: Pick<Invoice, "status" | "dueDate">, today: string): DisplayStatus`;
  `installmentOf(billingKey: string | null): { seq: string; index: number } | null` (`installment|root|plan|i` → seq `root|plan`, index `i`);
  `periodLabel(start: string | null, end: string | null): string | null` ("Oct 2026", "Oct – Dec 2026");
  `type InvoiceStatusFilter = DisplayStatus | "all" | "open"` (`open` = issued or part paid, any due date — for links, not a tab);
  `type InvoiceQuery = { status: InvoiceStatusFilter; q?: string; programId?: string; batchId?: string; issuedFrom?: string; issuedTo?: string; dueFrom?: string; dueTo?: string; sort: "newest" | "oldest" | "amount" | "due"; page: number }`;
  `parseInvoiceQuery(sp): InvoiceQuery`, `invoiceParams(q, page?): URLSearchParams` (names `status q program batch issuedFrom issuedTo dueFrom dueTo sort page`);
  `InvoiceRow` gains `display: DisplayStatus; programs: string[]; installment: { n: number; of: number } | null`;
  `type InvoiceList = { today: string; rows: InvoiceRow[]; matched: number; page: number; pageSize: number; counts: Record<DisplayStatus | "all", number>; drafts: { count: number; total: Paise }; applied: Omit<InvoiceQuery, "page">; options: { programs: Option[]; batches: Option[] } }`;
  `invoiceList(tx, ctx, q: InvoiceQuery, opts): Promise<InvoiceList>`;
  `type Option = { id: string; name: string }` (as in `search-bar.tsx`);
  `FilterBar({ path, search, selects, dates, sorts }: { path: string; search: { placeholder: string }; selects: { name: string; label: string; all: string; options: Option[] }[]; dates: { name: string; label: string }[]; sorts?: { value: string; label: string }[] })` — the URL mechanics of `StudentSearchBar` (replace params, drop `page`, Clear filters).
  `InvoiceStatus({ status }: { status: DisplayStatus })`.

- [ ] **Step 1: Write the failing unit tests** (`billing.test.ts`)

```ts
it("overdue beats part paid; void reads cancelled", () => {
  expect(displayStatus({ status: "part_paid", dueDate: "2026-09-10" }, "2026-09-11")).toBe("overdue");
  expect(displayStatus({ status: "part_paid", dueDate: "2026-09-11" }, "2026-09-11")).toBe("part_paid");
  expect(displayStatus({ status: "issued", dueDate: "2026-09-11" }, "2026-09-11")).toBe("due");
  expect(displayStatus({ status: "void", dueDate: "2026-09-01" }, "2026-09-11")).toBe("cancelled");
});
it("reads an installment key", () => expect(installmentOf("installment|r1|p1|2")).toEqual({ seq: "r1|p1", index: 2 }));
it("labels a period", () => {
  expect(periodLabel("2026-10-01", "2026-10-31")).toBe("Oct 2026");
  expect(periodLabel("2026-10-01", "2026-12-31")).toBe("Oct – Dec 2026");
});
```

- [ ] **Step 2: Write the failing integration tests** (`fees.integration.test.ts`)

Test helper: `const list = (q: Partial<InvoiceQuery>, as = owner) => withTenant(T, (tx) => invoiceList(tx, as, { status: "all", sort: "newest", page: 1, ...q }, { now: NOW }))`; `ids = (l: InvoiceList) => l.rows.map((r) => r.id)`.

```ts
it("each invoice is in one status tab and the tabs add up to All", async () => {
  const l = await list({ status: "all" });
  expect(DISPLAY_STATUSES.reduce((n, s) => n + l.counts[s], 0)).toBe(l.counts.all);
});
it("a part-paid invoice past its due date is listed under Overdue only", async () => {
  // ₹1,500 due the day before NOW, ₹500 paid
  expect(ids(await list({ status: "overdue" }))).toContain(inv.id);
  expect(ids(await list({ status: "part_paid" }))).not.toContain(inv.id);
});
it("filters by program, finds by number, student or payer, and pages by ten", async () => {
  expect(ids(await list({ q: inv.number ?? "" }))).toEqual([inv.id]);
  expect(ids(await list({ q: "Mother 7" }))).toEqual([inv.id]); // the payer's name
  expect(ids(await list({ programId: dance }))).not.toContain(karateInvoice.id);
  expect((await list({ page: 2 })).rows.length).toBe(Math.min(10, total - 10));
});
it("shows the installment position", async () => {
  // a term plan with 3 installments, all billed; the second one
  expect((await list({ q: second.number ?? "" })).rows[0]?.installment).toEqual({ n: 2, of: 3 });
});
it("a viewer limited to one branch never counts another branch's invoices", async () => {
  // one invoice in the second branch; ctx with branchIds [main]
  expect(ids(await list({}, { ...owner, branchIds: [main] }))).not.toContain(otherBranchInvoice.id);
  expect((await list({}, { ...owner, branchIds: [main] })).counts.all).toBe((await list({}, { ...owner, branchIds: [main, other] })).counts.all - 1);
});
```

- [ ] **Step 3: Run both — expect FAIL**

Run: `pnpm exec vitest run --project unit src/modules/fees/billing.test.ts` and `pnpm exec vitest run --project integration src/modules/fees/fees.integration.test.ts -t "tab|filters|installment|one branch"`

- [ ] **Step 4: Implement** — the same display rule as SQL (`CASE` on status and `due_date < today`) for filters and `count(*) FILTER (WHERE …)` counts; program/batch filters through `invoice_lines → enrollments → batches`; search `number`, `bill_to_name`, student name (`ILIKE`, input escaped); `installment.of` = count of distinct installment keys in that seq; default sort newest issue date. Students' fees keep working through `studentId`. Page: tabs `All · Draft · Due · Part paid · Overdue · Paid · Cancelled` with counts, `FilterBar`, table columns per spec (Invoice, Student + payer, Program "+1", Period or "Installment 2 of 4", Total, Paid, Balance, Due date, Status), cards below `md`, paging "1–10 of N", drafts banner kept.

- [ ] **Step 5: Run tests, then full checks — expect PASS**

- [ ] **Step 6: Chrome check** — every tab and its count, search, program filter, paging, phone cards; the Students filter bar still works.

- [ ] **Step 7: Commit** — `invoices: one status per invoice, tabs with counts, filters and paging`.

### Task 6: Invoice detail — money history, who created and issued it, print

**Files:**
- Create: `migrations/0041_invoice_people.sql`
- Modify: `src/modules/fees/schema.ts`, `src/modules/fees/invoicing.ts` (`createdBy`), `src/modules/fees/service.ts` (`issueInvoices` sets `issuedBy`; `invoiceDetail` facts), `src/modules/payments/repo.ts` (`moneyOnInvoice`), `src/modules/payments/service.ts` (`invoiceMoney` replaces `invoiceReceipts`), `src/components/fees/invoice-view.tsx`, `src/components/payments/payment-actions.tsx` (`PrintReceipt` → `PrintButton({ label })`), `src/app/(tenant)/finance/invoices/[id]/page.tsx`, `src/app/(tenant)/finance/collections/[id]/page.tsx`
- Test: `src/modules/fees/fees.integration.test.ts`, `src/modules/payments/payments.integration.test.ts`

**Interfaces:**
- Produces: `Invoice.createdBy`, `Invoice.issuedBy` (`string | null`);
  `type MoneyRow = { kind: AllocationKind; amountPaise: Paise; at: Date; paymentId: string; receiptNumber: string; receivedOn: string; method: PaymentMethod; reason: string | null }`;
  `moneyOnInvoice(tx, invoiceId): Promise<MoneyRow[]>` (oldest first; reason = refund reason, or the invoice's void reason for `void` rows);
  `invoiceMoney(tx, ctx, invoiceId): Promise<MoneyRow[]>` (`invoices:read`);
  `InvoiceDetail` gains `programs: { enrollmentId: string; programName: string; batchName: string; planName: string | null }[]; createdByName: string | null; issuedByName: string | null`.

- [ ] **Step 1: Write the failing tests**

```ts
it("money history shows advance with the receipt it came from", async () => {
  // pay ₹2,000 against nothing (advance), then issue a ₹1,500 invoice
  const rows = await withTenant(T, (tx) => invoiceMoney(tx, owner, inv.id));
  expect(rows).toMatchObject([{ kind: "advance", amountPaise: 150_000n, receiptNumber: p.receiptNumber, receivedOn: p.receivedOn }]);
});
it("a refund is its own negative row with the reason", async () => { expect(rows.at(-1)).toMatchObject({ kind: "refund", amountPaise: -50_000n, reason: "Missed classes" }); });
it("records who issued it; the nightly run creates with nobody, Generate now with the staff member", async () => {
  expect(nightly.createdBy).toBeNull();
  expect(issued.issuedBy).toBe(owner.staffId);
  expect(fromGenerateNow.createdBy).toBe(owner.staffId);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Migration** — up: `ALTER TABLE app.invoices ADD COLUMN created_by uuid REFERENCES app.staff_users(id), ADD COLUMN issued_by uuid REFERENCES app.staff_users(id);` down: drop both. `pnpm migrate`.

- [ ] **Step 4: Implement** — `generateInvoices` sets `createdBy` when `actor.actorType === "staff"`; `issueInvoices` sets `issuedBy: ctx.staffId`. Detail page: facts (issued, due, student(s), payer, programs with batch and fee plan, period, created by, issued by, cancel reason), the existing lines, Total · Paid · Balance, money history ("₹2,000 from advance · RCT/2026-27/0007, received 26 Sep, UPI"; refunds and releases negative), actions Collect (drawer URL), Payment link, Remind, Issue, Print, Cancel invoice (existing void sheet; button text "Cancel invoice"). Print styles hide chrome like the receipt. `PrintButton` reads "Print / Save PDF" on both the invoice and the receipt. Remove `invoiceReceipts` once nothing imports it.

- [ ] **Step 5: Run tests, then full checks — expect PASS**

- [ ] **Step 6: Chrome check** — an invoice paid from advance, one refunded, one cancelled; print preview.

- [ ] **Step 7: Commit** — `invoices: the detail shows every rupee's history and who issued it`.

---

## Slice 4 — One-off charges

### Task 7: Create invoice

**Files:**
- Create: `src/components/fees/create-invoice.tsx`
- Modify: `src/modules/fees/invoicing.ts` (export `retotal`, `defaultPayerFor`), `src/modules/fees/repo.ts` (`memberDraft`, `replaceLines`, `admissionBilled`), `src/modules/fees/service.ts` (`issueDrafts`, `issueInvoices`, `manualInvoiceSchema`, `addCharge`, `createInvoice`, `editDraft`, `createScreen`), `src/modules/fees/routes.ts` (actions `create`, `edit`), `src/app/(tenant)/finance/invoices/page.tsx`, `src/app/(tenant)/finance/invoices/[id]/page.tsx`, `src/app/(tenant)/students/[id]/page.tsx`
- Test: `src/modules/fees/fees.integration.test.ts`

**Interfaces:**
- Consumes: `MemberSearch` (Task 4), `InvoiceDetail` (Task 6).
- Produces:
  `issueDrafts(tx, actor: Actor, drafts: Invoice[], opts: { now: Date; applyAdvance?: boolean }): Promise<Invoice[]>` — today's issue loop without the permission check (`issuedBy` = staff actor id, else null; `applyAdvance` default true); `issueInvoices` = `assertCan` + `lockDrafts` + `issueDrafts`;
  `type ManualLine = { kind: "admission" | "exam" | "item" | "other"; description: string; amountPaise: Paise; enrollmentId?: string; taxRateBp?: number }`;
  `manualInvoiceSchema = z.object({ studentId: z.uuid(), payerGuardianId: z.uuid().optional(), payerMemberId: z.uuid().optional(), dueDate: isoDate.optional(), lines: z.array(manualLine).min(1).max(20), issue: z.boolean().default(false) })`;
  `defaultPayerFor(tx, studentId, enrollmentId?): Promise<Payer>` — the enrollment's payer, else the lead guardian, else the member;
  `addCharge(tx, actor: Actor, input: { studentId: string; branchId: string; payer: Payer; lines: ManualLine[]; dueDate: string }): Promise<Invoice>` — a draft with `billingKey` null on every line, `createdBy` the staff actor, totals via `retotal`, tax only with a GSTIN; audited `invoice.create`;
  `createInvoice(tx, ctx, input, opts): Promise<Invoice>` (`invoices:manage`); `editDraft(tx, ctx, id, input): Promise<Invoice>` (`invoices:manage`, manual drafts only, audited `invoice.edit`);
  `type CreateScreen = { student: { id: string; name: string; code: string; branchId: string }; payers: { key: string; payer: Payer; name: string; relation: string | null }[]; defaultPayerKey: string; enrollments: { id: string; programId: string; programName: string; batchName: string }[]; gst: boolean; admissionBilled: Record<string, string> }` (programId → invoice number);
  `createScreen(tx, ctx, studentId): Promise<CreateScreen>`;
  URL: `/finance/invoices?create=1[&student=<id>]`, edit `?edit=<invoiceId>`.

- [ ] **Step 1: Write the failing tests**

Test helpers: `const exam = { kind: "exam", description: "Grading exam", amountPaise: "50000" } as const`; `create = (input, as = owner) => withTenant(T, (tx) => createInvoice(tx, as, input, { now: NOW }))`; `edit = (id, input, as = owner) => withTenant(T, (tx) => editDraft(tx, as, id, input))`.

```ts
it("creates a draft from the lines given; the number comes on issue", async () => {
  const d = await create({ studentId: kid, lines: [exam] });
  expect(d).toMatchObject({ status: "draft", number: null, totalPaise: 50_000n, createdBy: owner.staffId });
  expect((await create({ studentId: kid, lines: [exam], issue: true })).number).toMatch(/^INV\//);
});
it("create and issue lets the payer's advance pay it", async () => {
  // kid's payer holds ₹1,000 advance
  expect((await create({ studentId: kid, lines: [exam], issue: true })).status).toBe("paid");
});
it("charges tax only with a GSTIN", async () => {
  expect((await create({ studentId: kid, lines: [{ ...exam, taxRateBp: 1800 }] })).totalPaise).toBe(50_000n); // no GSTIN yet
  // set a GSTIN with saveFeeSettings, then:
  expect((await create({ studentId: kid, lines: [{ ...exam, taxRateBp: 1800 }] })).taxPaise).toBe(9_000n);
});
it("edits a manual draft; refuses a generated draft and an issued invoice", async () => {
  expect((await edit(manual.id, { studentId: kid, lines: [{ ...exam, amountPaise: "60000" }] })).totalPaise).toBe(60_000n);
  await expect(edit(generatedDraft.id, { studentId: kid, lines: [exam] })).rejects.toMatchObject({ status: 409 });
  await expect(edit(issued.id, { studentId: kid, lines: [exam] })).rejects.toMatchObject({ status: 409 });
});
it("the nightly run never adds charges to a manual draft", async () => {
  // manual draft for kid dated NOW's day; kid's recurring charge falls on the same day; run generateInvoices
  expect((await withTenant(T, (tx) => linesOf(tx, [manual.id]))).every((l) => l.billingKey === null)).toBe(true);
});
it("needs invoices:manage", async () => { await expect(create({ studentId: kid, lines: [exam] }, desk)).rejects.toMatchObject({ status: 403 }); });
it("the payer must be one of the student's payers", async () => {
  await expect(create({ studentId: kid, payerGuardianId: strangersMother, lines: [exam] })).rejects.toMatchObject({ status: 400 });
});
it("an exam fee for one enrollment goes to that enrollment's payer", async () => {
  // split payers: mother pays Teens Morning, father pays Advanced A
  expect((await create({ studentId: riya, lines: [{ ...exam, enrollmentId: advancedA }] })).payerGuardianId).toBe(father);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** — `memberDraft` adds `AND NOT EXISTS (SELECT 1 FROM app.invoice_lines l WHERE l.invoice_id = invoices.id AND l.billing_key IS NULL)`; `editDraft` refuses unless draft and every line has a null billing key ("Only a charge added by hand can be edited"), then `replaceLines` (delete the draft's lines, insert the new) and `retotal`; due date default today + 7. Sheet: student (MemberSearch with `hrefFor = id => ?create=1&student=id`), payer, lines (kind Admission · Exam · Uniform & kit · Other, description, amount, program optional, tax rate only with GST), "Admission already billed on INV/…" hint from `admissionBilled`, due date, **Save as draft** / **Create and issue**. Entry points: Invoices header `+ Create invoice`, student page, and **Edit** on a manual draft's detail.

- [ ] **Step 4: Run tests, then full checks — expect PASS**

- [ ] **Step 5: Chrome check** — create a uniform charge as draft, edit it, issue it; create-and-issue an exam fee for a split-payer child's second enrollment; the nightly-run case is covered by the test.

- [ ] **Step 6: Commit** — `invoices: add a one-off charge by hand`.

### Task 8: New charge in the collect drawer

**Files:**
- Modify: `src/modules/payments/service.ts` (`paymentSchema.charge`, `recordPayment`), `src/components/payments/collect-form.tsx`
- Test: `src/modules/payments/payments.integration.test.ts`

**Interfaces:**
- Consumes: `addCharge`, `issueDrafts` (Task 7), `CollectScreen.enrollments`, `CollectScreen.gst` (Task 3).
- Produces: `paymentSchema.charge?: { kind: ManualLine["kind"]; description: string; amountPaise: paise; enrollmentId?: z.uuid() }`.

- [ ] **Step 1: Write the failing tests**

Test helpers: `const uniform = { kind: "item", description: "Uniform", amountPaise: "120000" } as const`; `uniforms = (memberId) => withTenant(T, (tx) => tx.select().from(invoiceLines).where(and(eq(invoiceLines.studentId, memberId), eq(invoiceLines.description, "Uniform"))))`.

```ts
it("a charge added at the desk is issued and paid in full in one step", async () => {
  const p = await pay(kid, 1200, { charge: uniform });
  expect((await receiptOf(p.id)).lines.map((l) => l.items[0]?.description)).toEqual(["Uniform"]);
  const [line] = await uniforms(kid);
  expect(await state(line?.invoiceId ?? "")).toEqual(["paid", 120_000n]);
  expect(await actions(line?.invoiceId ?? "")).toContain("invoice.create");
});
it("paying less than the charge is refused and nothing is created", async () => {
  await expect(pay(kid, 1000, { charge: uniform })).rejects.toMatchObject({ status: 400, message: "A charge added here is paid in full" });
  expect(await uniforms(kid)).toEqual([]);
});
it("the same request id twice makes one charge and one payment", async () => {
  const input = { requestId: uuidv7(), charge: uniform };
  const [a, b] = await Promise.all([pay(kid, 1200, input), pay(kid, 1200, input)]);
  expect(a.id).toBe(b.id);
  expect((await uniforms(kid)).length).toBe(1);
});
it("above the charge pays the ticked invoices, then advance", async () => {
  // open ₹1,500 for kid; pay ₹3,000 with the uniform and the open one ticked
  const p = await pay(kid, 3000, { charge: uniform, allocations: [{ invoiceId: open.id, amountPaise: "150000" }] });
  expect(await state(open.id)).toEqual(["paid", 150_000n]);
  expect(await advanceOf(kid)).toBe(30_000n);
});
it("a desk charge leaves the payer's advance alone", async () => {
  // kid's payer holds ₹500 advance
  await pay(kid, 1200, { charge: uniform });
  expect(await advanceOf(kid)).toBe(50_000n);
});
it("a desk charge needs only fees:collect", async () => { await expect(pay(kid, 1200, { charge: uniform }, desk)).resolves.toMatchObject({ amountPaise: 120_000n }); });
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** — in `recordPayment`, after the payer lock and the request-id replay check (so a retry returns the first payment before anything is made): refuse when `amountPaise < charge.amountPaise`; `addCharge` for the payer with due date today; `issueDrafts(tx, actor(ctx), [draft], { now, applyAdvance: false })`; allocate the charge in full first, then the rest by the usual rules (`picked` when invoices are ticked, else `oldestFirst`). Drawer: third purpose **New charge** (kind, description, amount, program; amount received prefilled to the charge plus anything ticked).

- [ ] **Step 4: Run tests, then full checks — expect PASS**

- [ ] **Step 5: Chrome check** — as a Front Desk user: new charge for a uniform, receipt shows it; a lower amount shows the error.

- [ ] **Step 6: Commit** — `payments: a one-off charge can be added and paid at the desk`.

---

## Slice 5 — Auto-issue

### Task 9: Send invoices automatically (academy setting)

**Files:**
- Create: `migrations/0042_invoice_issue.sql`
- Modify: `src/modules/tenancy/schema.ts`, `src/modules/fees/service.ts` (`feeSettingsSchema`, `saveFeeSettings`), `src/modules/fees/invoicing.ts` (`generateInvoices`), `src/components/fees/fee-settings.tsx`, `src/app/(tenant)/settings/page.tsx`, `src/app/(tenant)/finance/invoices/page.tsx`
- Test: `src/modules/fees/fees.integration.test.ts`

**Interfaces:**
- Consumes: `issueDrafts` (Task 7).
- Produces: `Tenant.invoiceIssue: "review" | "auto"`; `feeSettingsSchema.invoiceIssue?: "review" | "auto"`; `saveFeeSettings` returns `{ gstin, proration, invoiceIssue }`; `GenerateResult.issued: number`; `FeeSettings({ gstin, proration, invoiceIssue })`.

- [ ] **Step 1: Write the failing tests**

```ts
it("review mode: the nightly run leaves drafts", async () => { expect(made.every((i) => i.status === "draft")).toBe(true); });
it("auto mode: the nightly run issues what it makes, numbers it and applies advance", async () => {
  // invoiceIssue auto; payer advance ₹2,000; ₹1,500 monthly plan
  expect(r.issued).toBe(1);
  expect(inv).toMatchObject({ status: "paid", issuedBy: null });
  expect(inv.number).toMatch(/^INV\//);
});
it("auto mode never issues a manual draft", async () => { expect(manual.status).toBe("draft"); });
it("auto mode issues the redraft after cancel and bill again", async () => { expect(redraft.status).not.toBe("draft"); });
it("an auto-issued invoice paid by advance gets no reminder", async () => {
  // run queueReminders at the academy's send hour on each day from issue to 3 days past due
  expect(await messagesAbout(inv.id)).toEqual([]);
});
it("the setting needs settings:manage and is audited", async () => {
  await expect(save({ invoiceIssue: "auto" }, desk)).rejects.toMatchObject({ status: 403 });
  await save({ invoiceIssue: "auto" }, owner);
  expect(await lastAudit("settings.fees")).toMatchObject({ after: { invoiceIssue: "auto" } });
});
```

Test helpers: `save = (input, as) => withTenant(T, (tx) => saveFeeSettings(tx, as, input))`; `messagesAbout(id)` selects the messaging rows whose related id is `id`; `lastAudit(action)` reads the newest `audit_log` row with that action.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Migration** — up: `ALTER TABLE app.tenants ADD COLUMN invoice_issue text NOT NULL DEFAULT 'review' CHECK (invoice_issue IN ('review','auto'));` down: drop it. `pnpm migrate`.

- [ ] **Step 4: Implement** — `generateInvoices` collects the ids of drafts it inserted or appended to; when `tenant.invoiceIssue === "auto"`, locks and passes exactly those to `issueDrafts(tx, actor, drafts, { now })`. Settings fee card: "Send invoices" radio — **After I review** / **Automatically**. Invoices page: under the drafts banner, one line saying which mode is on.

- [ ] **Step 5: Run tests, then full checks — expect PASS**

- [ ] **Step 6: Chrome check** — switch to Automatically, Generate now, invoices arrive issued; switch back to After I review.

- [ ] **Step 7: Commit** — `invoices: an academy can send invoices automatically`.

---

## Slice 6 — Collections

### Task 10: Collections table — periods, filters, paging, the day sheet, CSV

**Files:**
- Modify: `src/modules/payments/repo.ts` (`paymentList`, `countPayments`, `periodCounts`), `src/modules/payments/labels.ts` (`paymentDisplay`), `src/modules/payments/service.ts` (`COLLECTION_PERIODS`, `periodRange`, `CollectionQuery`, `parseCollectionQuery`, `collectionParams`, `collectionList`), `src/modules/reports/routes.ts` (CSV gate and builder signature), `src/modules/reports/csv.ts` (`collectionsRows`), `src/app/(tenant)/finance/collections/page.tsx`
- Test: `src/modules/payments/service.test.ts` (new, unit), `src/modules/payments/payments.integration.test.ts`, `src/modules/reports/reports.integration.test.ts`

**Interfaces:**
- Produces:
  `COLLECTION_PERIODS = ["today", "week", "month", "all"] as const`;
  `periodRange(period, today): { from: string | null; to: string | null }` — weeks start Monday;
  `type PaymentDisplay = "received" | "part_refunded" | "refunded" | "cancelled"`; `paymentDisplay(p: { status; amountPaise }, refundedPaise): PaymentDisplay`;
  `type PaymentRow = SheetPayment & { students: string[]; programs: string[]; towards: { invoiceId: string; number: string | null; amountPaise: Paise }[]; advancePaise: Paise; refundedPaise: Paise; display: PaymentDisplay }`;
  `type CollectionQuery = { period: CollectionPeriod; from?: string; to?: string; q?: string; method?: PaymentMethod; collectorId?: string; programId?: string; status?: PaymentDisplay; sort: "newest" | "oldest" | "amount"; page: number }` (URL names `period from to q method collector program status sort page`);
  `type CollectionList = { today: string; rows: PaymentRow[]; matched: number; page: number; pageSize: number; counts: Record<CollectionPeriod, number>; sheets: CollectionSheet[] | null; own: boolean; applied: Omit<CollectionQuery, "page">; options: { collectors: Option[]; programs: Option[] } }`;
  `collectionList(tx, ctx, q, opts): Promise<CollectionList>` (`payments:read`, or `fees:collect` alone → `own: true`, forced to today and `receivedBy = ctx.staffId`);
  CSV builder: `(tx, ctx, range: Range, params: URLSearchParams) => Promise<Csv>`, route gate `reports:export`, new entry `collections`.

- [ ] **Step 1: Write the failing unit tests** (`service.test.ts`)

```ts
it("weeks start Monday", () => {
  expect(periodRange("week", "2026-09-24")).toEqual({ from: "2026-09-21", to: "2026-09-24" }); // Thursday
  expect(periodRange("week", "2026-09-27")).toEqual({ from: "2026-09-21", to: "2026-09-27" }); // Sunday
  expect(periodRange("month", "2026-09-24")).toEqual({ from: "2026-09-01", to: "2026-09-24" });
  expect(periodRange("all", "2026-09-24")).toEqual({ from: null, to: null });
});
```

- [ ] **Step 2: Write the failing integration tests**

```ts
it("a payment at 23:50 IST is that day's", async () => {
  const p = await pay(child, 500, {}, desk, new Date("2026-09-24T18:20:00Z"));
  expect(ids(await list({ period: "today" }, owner, new Date("2026-09-24T18:25:00Z")))).toContain(p.id);
  expect(ids(await list({ period: "today" }, owner, new Date("2026-09-25T04:00:00Z")))).not.toContain(p.id);
  expect(ids(await list({ period: "week" }, owner, new Date("2026-09-25T04:00:00Z")))).toContain(p.id);
});
it("filters by method, collector, program and status; finds by receipt, payer, student or reference", async () => {
  // today: desk records cash ₹500 (kid, Karate) and UPI ₹700 ref "UPI 4471"; desk2 records cash ₹300; one cancelled
  expect(ids(await list({ period: "today", method: "upi" }))).toEqual([upi.id]);
  expect(ids(await list({ period: "today", collectorId: desk2.staffId }))).toEqual([byDesk2.id]);
  expect(ids(await list({ period: "today", programId: karate }))).toContain(cash.id);
  expect(ids(await list({ period: "today", status: "cancelled" }))).toEqual([cancelled.id]);
  for (const q of [upi.receiptNumber, "UPI 4471", name(kid), "Mother"]) expect(ids(await list({ period: "today", q }))).toContain(upi.id);
});
it("towards and advance add up to each amount", async () => {
  for (const r of rows) expect(r.towards.reduce((n, t) => n + t.amountPaise, 0n) + r.advancePaise).toBe(r.amountPaise);
});
it("Front Desk sees only their own receipts today, whatever the URL asks", async () => {
  const l = await list({ period: "all", collectorId: desk2.staffId }, desk);
  expect(l.own).toBe(true);
  expect(l.rows.every((r) => r.receivedBy === desk.staffId && r.recordedOn === "2026-09-24")).toBe(true);
});
// reports.integration.test.ts — call csvRoute with a signed-in session, as the file already does
it("the collections CSV holds exactly the filtered rows and needs reports:export", async () => {
  const res = await csvAs(ownerCookie, "/api/reports/collections?period=today&method=upi");
  expect(res.status).toBe(200);
  expect((await res.text()).trim().split("\n").length).toBe(1 + upiCountToday); // header + rows
  expect((await csvAs(viewOnlyCookie, "/api/reports/collections?period=today")).status).toBe(403); // a role with reports:view, without reports:export
});
```

Test helpers: `list = (q: Partial<CollectionQuery>, as = owner, now = NOW) => withTenant(T, (tx) => collectionList(tx, as, { period: "all", sort: "newest", page: 1, ...q }, { now }))`; `ids = (l) => l.rows.map((r) => r.id)`.

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Implement** — rows from the existing `recorded` select plus receipt allocations (`kind = 'receipt'`), lines' students and programs, refund sums; `advancePaise = amount − receipt allocations`; default sort newest. The `own` view uses the same filter as Task 4's `myReceiptsToday`, which the page stops calling (remove it if nothing else imports it). Existing CSV tests that sign in with `reports:view` alone move to a role holding `reports:export`. Page: header + Collect button; period tabs with counts; `FilterBar` (method, collected by, program, status, dates, sort); on Today or a one-day range the existing `collectionSheet` cards sit above the table; table columns per spec, cards below `md`; paging; "Download CSV" when the viewer has `reports:export`. Every existing CSV keeps working through the new builder signature (they ignore `params`).

- [ ] **Step 5: Run tests, then full checks — expect PASS**

- [ ] **Step 6: Chrome check** — tabs, method filter, a cancelled receipt struck through, the sheet on Today, CSV download, Front Desk view.

- [ ] **Step 7: Commit** — `collections: every payment in one table with the day sheet kept`.

---

## Slice 7 — Student plans

### Task 11: Student plans list

**Files:**
- Create: `src/app/(tenant)/finance/student-plans/page.tsx`
- Modify: `src/modules/fees/billing.ts` (`spreadOver`, `nextRecurringBill`), `src/modules/fees/repo.ts` (`studentPlanRows`, `countStudentPlans`, `studentPlanTabCounts`), `src/modules/fees/service.ts` (`StudentPlanQuery`, `parseStudentPlanQuery`, `studentPlanParams`, `studentPlanList`), `src/lib/auth/nav.ts`
- Test: `src/modules/fees/billing.test.ts`, `src/modules/fees/fees.integration.test.ts`, `src/lib/auth/nav.test.ts`

**Interfaces:**
- Produces:
  `spreadOver(amount: Paise, parts: { id: string; weight: Paise }[]): Map<string, Paise>` — largest remainder via `split`; all-zero weights → every part 0n;
  `nextRecurringBill(p: RecurringInput, today: string): string | null` — first `recurringCharges(p, addDays(today, 1), addMonths(today, 13))` issue date;
  `type StudentPlanTab = "active" | "paused" | "ended"`;
  `type StudentPlanRow = { enrollmentId: string; studentId: string; studentName: string; studentCode: string; programName: string; batchName: string; planId: string; planName: string; kind: FeePlan["kind"]; cycle: FeePlan["billingCycle"]; amountPaise: Paise; startDate: string; endDate: string | null; status: Enrollment["status"]; payerName: string; nextBill: string | null; outstandingPaise: Paise }`;
  `type StudentPlanQuery = { tab: StudentPlanTab; q?: string; programId?: string; batchId?: string; planId?: string; page: number }` (URL `tab q program batch plan page`);
  `studentPlanList(tx, ctx, q, opts): Promise<{ today: string; rows: StudentPlanRow[]; matched: number; page: number; pageSize: number; counts: Record<StudentPlanTab, number>; applied; options }>` (`invoices:read`).

- [ ] **Step 1: Write the failing unit tests**

```ts
it("spreads odd paise so the parts add back exactly", () => {
  expect([...spreadOver(50_001n, [{ id: "a", weight: 33_333n }, { id: "b", weight: 66_667n }]).values()]).toEqual([16_667n, 33_334n]);
  expect([...spreadOver(100n, [{ id: "a", weight: 0n }]).values()]).toEqual([0n]);
});
it("finds the next bill", () => {
  const p = { cycle: "monthly", billingDay: 1, amount: 200_000n, proration: "full", anchor: "2026-09-01", start: "2026-09-01", end: null, pausedOn: null, continuing: false } as const;
  expect(nextRecurringBill(p, "2026-09-24")).toBe("2026-10-01");
  expect(nextRecurringBill({ ...p, cycle: "quarterly", anchor: "2026-07-01", start: "2026-07-01" }, "2026-09-24")).toBe("2026-10-01");
  expect(nextRecurringBill({ ...p, pausedOn: "2026-09-20" }, "2026-09-24")).toBeNull();
  expect(nextRecurringBill({ ...p, end: "2026-09-30" }, "2026-09-24")).toBeNull();
});
```

- [ ] **Step 2: Write the failing integration tests**

Test helper: `plans = (q: Partial<StudentPlanQuery>, as = owner) => withTenant(T, (tx) => studentPlanList(tx, as, { tab: "active", page: 1, ...q }, { now: NOW }))`.

```ts
it("tabs: active, paused, ended; a transferred enrollment is not listed", async () => {
  // a fresh academy: one active, one paused, one left, and one moved (transferred → its next enrollment is active)
  expect((await plans({})).counts).toEqual({ active: 2, paused: 1, ended: 1 });
  expect((await plans({ tab: "ended" })).rows.map((r) => r.enrollmentId)).toEqual([left.id]);
});
it("outstanding per plan when one invoice carries two enrollments", async () => {
  // one invoice: ₹1,000 Karate line + ₹2,000 Dance line, ₹1,500 paid
  const byPlan = new Map((await plans({})).rows.map((r) => [r.enrollmentId, r]));
  expect(byPlan.get(karate)?.outstandingPaise).toBe(50_000n);
  expect(byPlan.get(dance)?.outstandingPaise).toBe(100_000n);
});
it("a viewer limited to one branch sees only that branch's plans", async () => {
  expect((await plans({}, { ...owner, branchIds: [main] })).rows.map((r) => r.enrollmentId)).not.toContain(secondBranchEnrollment.id);
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Implement** — enrollments with a fee plan in the viewer's branches (`active`→Active, `paused`→Paused, `left`→Ended; `transferred` excluded); payer = override else lead guardian else the member, named via `payerNames`; outstanding = each open invoice's balance spread over its lines by `amountPaise + taxPaise`, summed per enrollment; next bill per kind (recurring `nextRecurringBill`, term the earliest unpaid installment's due date, one-time none). Page with tabs, `FilterBar`, table/cards, paging. Nav: **Student plans** (`invoices:read`) after Invoices.

- [ ] **Step 5: Run tests, then full checks — expect PASS**

- [ ] **Step 6: Chrome check** — the three tabs, next bill dates, outstanding on a two-program child.

- [ ] **Step 7: Commit** — `finance: student plans, each enrollment's fee arrangement in one list`.

### Task 12: Student plan detail

**Files:**
- Create: `src/app/(tenant)/finance/student-plans/[id]/page.tsx`
- Modify: `src/modules/fees/service.ts` (`studentPlanDetail`), `src/modules/fees/repo.ts` (lines of an enrollment), `src/app/(tenant)/finance/invoices/[id]/page.tsx` (program rows link to the plan)
- Test: `src/modules/fees/fees.integration.test.ts`

**Interfaces:**
- Consumes: `spreadOver`, `nextRecurringBill` (Task 11), `displayStatus`, `installmentOf`, `periodLabel` (Task 5), `EnrollmentActions`, `PlanSelect` (`components/enrollments/student-batches.tsx`).
- Produces:
  `type TimelineRow = { invoiceId: string; number: string | null; label: string; status: DisplayStatus | "upcoming"; amountPaise: Paise; paidPaise: Paise; dueDate: string }`;
  `type StudentPlanDetail = { row: StudentPlanRow; branchId: string; discounts: GivenDiscount[]; afterDiscountPaise: Paise; totals: { billedPaise: Paise; paidPaise: Paise; outstandingPaise: Paise; advancePaise: Paise }; timeline: TimelineRow[] }`;
  `studentPlanDetail(tx, ctx, enrollmentId, opts): Promise<StudentPlanDetail>` (`invoices:read`).

- [ ] **Step 1: Write the failing tests**

```ts
it("a monthly plan's timeline: Sep paid, Oct part paid, Nov due", async () => {
  expect(d.timeline.map((t) => [t.label, t.status])).toEqual([["Sep 2026", "paid"], ["Oct 2026", "part_paid"], ["Nov 2026", "due"]]);
});
it("only the earliest unpaid installment is due; later ones are upcoming", async () => {
  expect(d.timeline.map((t) => [t.label, t.status])).toEqual([["Installment 1 of 4", "paid"], ["Installment 2 of 4", "paid"], ["Installment 3 of 4", "due"], ["Installment 4 of 4", "upcoming"]]);
});
it("totals: billed, paid by spread, outstanding, the payer's advance", async () => {
  // the monthly ₹2,000 plan above (Sep paid, Oct ₹1,000 paid, Nov unpaid), payer holds ₹300 advance
  expect(d.totals).toEqual({ billedPaise: 600_000n, paidPaise: 300_000n, outstandingPaise: 300_000n, advancePaise: 30_000n });
});
it("changing the plan leaves earlier rows as billed", async () => { expect(after.timeline.slice(0, 2)).toEqual(before.timeline.slice(0, 2)); });
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** — timeline from this enrollment's lines on non-void invoices, oldest first; `afterDiscountPaise` from `lineAmounts(plan.amountPaise, 1, runningDiscounts, 0).net`. Page: facts, the four totals, timeline rows linking to invoices, actions `EnrollmentActions` and `PlanSelect` (gated `enrollments:manage`), Create invoice (`?create=1&student=`), Collect payment (drawer URL). The invoice detail's program rows link here.

- [ ] **Step 4: Run tests, then full checks — expect PASS**

- [ ] **Step 5: Chrome check** — a monthly and a term plan; pause and resume from the page (restore after).

- [ ] **Step 6: Commit** — `finance: a student plan shows its whole billing story`.

---

## Slice 8 — Student page

### Task 13: The Fees & payments card on the student page

**Files:**
- Modify: `src/modules/students/profile.ts` (`feeCard`), `src/modules/payments/service.ts` (`receiptsOfInvoices` returns `fromAdvance`), `src/components/students/fees-card.tsx`, `src/app/(tenant)/students/[id]/page.tsx`
- Test: `src/modules/students/profile.integration.test.ts`

**Interfaces:**
- Consumes: `PlanLine` (Task 3), `nextRecurringBill` (Task 11), `moneyOnInvoice` (Task 6), `DisplayStatus` (Task 5).
- Produces: `feeCard` adds `plans: (PlanLine & { nextBill: string | null; payerName: string })[]`, `totals: { billedPaise: Paise; paidPaise: Paise; outstandingPaise: Paise }`, `advance: { payerName: string; advancePaise: Paise }[]`; `InvoiceReceiptRow` gains `fromAdvance: boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
it("totals are this student's issued invoices", async () => { expect(f.totals).toEqual({ billedPaise: sumTotals, paidPaise: sumPaid, outstandingPaise: sumTotals - sumPaid }); });
it("advance is shown per payer when two payers pay", async () => { expect(f.advance.map((a) => a.payerName).sort()).toEqual(["Father", "Mother"]); });
it("a payment that reached the invoice from advance is marked so", async () => { expect(f.receipts[0]?.fromAdvance).toBe(true); });
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** — card per spec: current plans (program, batch, ₹/cycle, next bill, payer), the four figures, the existing invoice groups with `displayStatus` and installment/period labels, payments with "from advance", actions Collect payment, Create invoice, Give discount.

- [ ] **Step 4: Run tests, then full checks — expect PASS**

- [ ] **Step 5: Chrome check** — a split-payer child and a term-plan child, phone width.

- [ ] **Step 6: Commit** — `students: the fees card shows plans, totals and where money came from`.

---

## Slice 9 — Fee plans, discounts and credits

### Task 14: Split a term fee into installments

**Files:**
- Modify: `src/modules/fees/billing.ts` (`splitInstallments`), `src/components/fees/plan-editor.tsx`
- Test: `src/modules/fees/billing.test.ts`

**Interfaces:**
- Produces: `splitInstallments(input: { totalPaise: Paise; count: number; everyDays: number; firstAfterDays: number }): { label: string; amountPaise: Paise; dueOffsetDays: number }[]`. The plan stores days, so the helper takes days; the editor shows "every 90 days".

- [ ] **Step 1: Write the failing test**

```ts
it("splits ₹10,000 three ways, 90 days apart", () => {
  expect(splitInstallments({ totalPaise: 1_000_000n, count: 3, everyDays: 90, firstAfterDays: 0 })).toEqual([
    { label: "1st installment", amountPaise: 333_334n, dueOffsetDays: 0 },
    { label: "2nd installment", amountPaise: 333_333n, dueOffsetDays: 90 },
    { label: "3rd installment", amountPaise: 333_333n, dueOffsetDays: 180 },
  ]);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** — amounts by `split`; labels with the editor's `ordinal` (moved into `billing.ts`). Editor, term type: a "Split" row (total, how many, every N days, first due after N days) that fills the editable rows, and an "Adds up to ₹X" line under them. Type options read Recurring · Term in installments · One-time.

- [ ] **Step 4: Run tests, then full checks — expect PASS**

- [ ] **Step 5: Chrome check** — make a 4-installment term plan with the helper, adjust one row, save.

- [ ] **Step 6: Commit** — `fee plans: split a term fee into installments in one step`.

### Task 15: Discounts & credits page

**Files:**
- Create: `src/app/(tenant)/finance/discounts/page.tsx`
- Modify: `src/modules/fees/repo.ts` (`givenDiscounts`, `discountLines`), `src/modules/payments/repo.ts` (`advanceHolders`), `src/modules/fees/service.ts` (`discountsPage`), `src/modules/payments/service.ts` (`advanceHeld`), `src/modules/reports/routes.ts` + `csv.ts` (entries `discounts`, `advance`), `src/app/(tenant)/finance/fee-plans/page.tsx` (Discounts card removed), `src/lib/auth/nav.ts`
- Test: `src/modules/fees/fees.integration.test.ts`, `src/modules/payments/payments.integration.test.ts`, `src/lib/auth/nav.test.ts`

**Interfaces:**
- Consumes: `useAdvanceRoute` (Task 3), CSV builder signature (Task 10).
- Produces:
  `type AdvanceHolder = { payerKey: string; payer: Payer; name: string; children: string[]; branchId: string; branchName: string; advancePaise: Paise; since: string; receipts: { paymentId: string; receiptNumber: string }[]; owesPaise: Paise }`;
  `advanceHolders(tx, branchIds): Promise<AdvanceHolder[]>`; `advanceHeld(tx, ctx, opts): Promise<AdvanceHolder[]>` (`invoices:read`);
  `type GivenRow = GivenDiscount & { studentName: string; running: boolean }`; `givenDiscounts(tx, branchIds, f: { state?: "running" | "ended"; q?: string }, today)`;
  `type DiscountLine = { invoiceId: string; number: string | null; issueDate: string; studentName: string | null; description: string; discountPaise: Paise; discountNote: string | null }`; `discountLines(tx, branchIds, range: Range)`;
  `discountsPage(tx, ctx, q: { tab: "discounts" | "given" | "advance"; state?: "running" | "ended"; q?: string; from?: string; to?: string }, opts): Promise<{ catalogue: Discount[]; given: GivenRow[]; lines: DiscountLine[]; linesTotal: Paise }>` (`invoices:read`; the catalogue also for `fee_plans:manage`);
  page URL `/finance/discounts?tab=discounts|given|advance[&owes=1]`.

- [ ] **Step 1: Write the failing tests**

```ts
it("advance is one row per payer per branch and adds up to the unused money", async () => {
  // mother: ₹500 unused in main, ₹200 in other
  expect(rows.map((r) => [r.branchName, r.advancePaise])).toEqual([["Main", 50_000n], ["Second branch", 20_000n]]);
});
it("a viewer limited to one branch sees only that branch's advance", async () => {
  expect((await held({ ...owner, branchIds: [main] })).map((r) => r.branchName)).toEqual(["Main"]);
});
it("flags advance held while the payer still owes", async () => {
  // mother also has a ₹1,500 invoice open in main
  expect(rows.find((r) => r.branchName === "Main")?.owesPaise).toBe(150_000n);
});
it("given discounts: running and ended", async () => {
  // two given to kid; end one with endDiscount
  expect((await given({ state: "running" })).map((g) => g.id)).toEqual([kept.id]);
  expect((await given({ state: "ended" })).map((g) => g.id)).toEqual([ended.id]);
});
it("discount lines in a range add up to the invoices' discounts", async () => {
  const lines = await discountLinesIn({ from: "2026-09-01", to: "2026-09-30" });
  expect(lines.reduce((n, l) => n + l.discountPaise, 0n)).toBe(sumOfIssuedInvoiceDiscountsInSeptember);
});
```

Test helpers: `held = (as = owner) => withTenant(T, (tx) => advanceHeld(tx, as, { now: NOW }))`; `rows = await held()`; `given` and `discountLinesIn` call `discountsPage` with that tab and range; `sumOfIssuedInvoiceDiscountsInSeptember` = `sum(invoices.discount_paise)` over issued, part-paid or paid invoices issued in September, read with a direct select.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** — `advanceHolders` groups the `unusedWhere` rows by payer and branch; `since` = the oldest unused payment's `recordedOn`; `owesPaise` = open balance for that payer and branch; children via `activeStudentsOf`. Page tabs: **Discounts** (catalogue moved from Fee plans, `fee_plans:manage` to edit), **Given** (list, End with `invoices:manage`, range + discount-lines total, CSV), **Advance** (list, `owes=1` filter, **Use advance now** when `owesPaise > 0` and the viewer has `fees:collect`, CSV). Nav: **Discounts & credits** (`invoices:read`) after Fee plans.

- [ ] **Step 4: Run tests, then full checks — expect PASS**

- [ ] **Step 5: Chrome check** — the three tabs, Use advance now on a payer who owes, both CSVs.

- [ ] **Step 6: Commit** — `finance: discounts and credits in one place`.

---

## Slice 10 — Overview

### Task 16: Finance overview

**Files:**
- Create: `src/app/(tenant)/finance/page.tsx`, `src/components/fees/status-bar.tsx`
- Modify: `src/modules/fees/repo.ts` (`owedSummary`, `statusMix`), `src/modules/payments/repo.ts` (`receiptAllocationsBetween`), `src/modules/reports/service.ts` (`revenueReport`, `financeOverview`), `src/components/dashboard/revenue-overview.tsx` (`bars` prop), `src/app/(tenant)/dashboard/page.tsx` (passes month bars), `src/lib/auth/nav.ts`
- Test: `src/modules/reports/reports.integration.test.ts`, `src/modules/dashboard/dashboard.integration.test.ts` (still passes), `src/lib/auth/nav.test.ts`

**Interfaces:**
- Consumes: `spreadOver` (Task 11), `advanceHolders` (Task 15), `displayStatus` (Task 5), `collectedByDay`, `collectedOn`, `collectionRegister`.
- Produces:
  `owedSummary` adds `dueSoonCount: number; dueSoonPaise: Paise; partPaidCount: number` (due today … today + 6);
  `statusMix(tx, branchIds, from, to, today): Promise<Record<"paid" | "part_paid" | "due" | "overdue", Paise>>` (invoices issued in range, by total);
  `type RevenueRow = { activityKey: string; programId: string | null; programName: string; batchId: string | null; batchName: string | null; billedPaise: Paise; collectedPaise: Paise; outstandingPaise: Paise }`;
  `type RevenueReport = Range & { rows: RevenueRow[]; advancePaise: Paise; collectedPaise: Paise; refundsPaise: Paise }`;
  `revenueReport(tx, ctx, range): Promise<RevenueReport>` (`payments:read` for collected, `invoices:read` for billed and outstanding);
  `type OwedSummary = Awaited<ReturnType<typeof owedSummary>>`; `type StatusMix = Awaited<ReturnType<typeof statusMix>>`; `type Collected = { count: number; total: Paise }`;
  `type FinanceOverview = { today: string; days: 7 | 30 | 90; collected?: { today: Collected; yesterday: Collected; month: Collected; refundsToday: Paise; refundsMonth: Paise; trend: { key: string; totalPaise: Paise }[]; byMethod: Total[] }; owed?: OwedSummary; advance?: { payers: number; owing: number; paise: Paise }; revenue?: RevenueReport; mix?: StatusMix; drafts?: { count: number; total: Paise } }`;
  `financeOverview(tx, ctx, opts: { now?: Date; days?: 7 | 30 | 90 }): Promise<FinanceOverview>` — blocks absent without their key, as `dashboardData` does;
  `RevenueOverview({ bars, label }: { bars: { label: string; totalPaise: bigint }[]; label: string })`.

- [ ] **Step 1: Write the failing tests**

Test helper: `overview = (as = owner, now = NOW) => withTenant(T, (tx) => financeOverview(tx, as, { now }))`.

```ts
it("today's collection equals the day sheets added up", async () => {
  const sheets = await Promise.all([main, other].map((b) => withTenant(T, (tx) => collectionSheet(tx, owner, { branchId: b }, { now: NOW }))));
  expect((await overview()).collected?.today.total).toBe(sheets.reduce((n, s) => n + s.total.totalPaise, 0n));
});
it("program rows plus advance equal the collection total to the paisa", async () => {
  // one invoice for kid: ₹333.33 Karate line + ₹666.67 Dance line; pay ₹500.01 on it, then ₹200 more as advance
  const r = await withTenant(T, (tx) => revenueReport(tx, owner, { from: "2026-09-24", to: "2026-09-24" }));
  expect(r.rows.reduce((n, x) => n + x.collectedPaise, 0n) + r.advancePaise).toBe(r.collectedPaise);
  expect(r.collectedPaise).toBe(70_001n);
});
it("due in 7 days counts today through today + 6", async () => {
  // ₹1,000 due 2026-09-30 (today + 6) and ₹2,000 due 2026-10-01 (today + 7)
  expect((await overview()).owed).toMatchObject({ dueSoonCount: 1, dueSoonPaise: 100_000n });
});
it("a viewer limited to one branch sees only that branch's totals", async () => {
  // ₹700 collected today in the second branch only
  const all = await overview();
  const mainOnly = await overview({ ...owner, branchIds: [main] });
  expect((all.collected?.today.total ?? 0n) - (mainOnly.collected?.today.total ?? 0n)).toBe(70_000n);
});
it("no trend chip when yesterday had nothing", async () => { expect((await overview()).collected?.yesterday.total).toBe(0n); });
it("a viewer without payments:read gets no collection block", async () => { expect((await overview(desk)).collected).toBeUndefined(); });
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** — collected by program: each counted payment's `receipt` allocations in the range, spread over that invoice's lines by `amountPaise + taxPaise`, grouped by the line's enrollment → batch → program → activity; unallocated part → `advancePaise`; lines with no enrollment → a "Not linked to a program" row. Billed: lines of invoices issued in range, not void, `amountPaise` (after discount, before tax). Outstanding: open balances spread the same way. Page per spec: six stat cards (refunds note, % vs yesterday), trend with `?days=7|30|90` (Recharts), collected vs outstanding (CSS), revenue by program or by activity when 2+ activities (`BarList`), by method (`BarList`), `StatusBar`, Attention required (overdue, due this week → `/finance/invoices?status=open&dueFrom=…&dueTo=…`, drafts, part paid, advance while owing → `/finance/discounts?tab=advance&owes=1`), sticky Collect button on phones. Nav: **Overview** first, `permission: ["invoices:read", "payments:read"]`.

- [ ] **Step 4: Run tests, then full checks — expect PASS** (the dashboard tests too)

- [ ] **Step 5: Chrome check** — every card links to its list; 7/30/90; phone layout; a Front Desk user sees only the blocks their keys allow.

- [ ] **Step 6: Commit** — `finance: the overview, with revenue by program that adds up`.

---

## Slice 11 — Reports

### Task 17: Finance reports

**Files:**
- Move: `src/app/(tenant)/reports/collection/page.tsx` → `src/app/(tenant)/finance/reports/collection/page.tsx`; `src/app/(tenant)/reports/dues/page.tsx` → `src/app/(tenant)/finance/reports/dues/page.tsx`
- Create: `src/app/(tenant)/finance/reports/page.tsx`, `src/app/(tenant)/finance/reports/revenue/page.tsx`
- Modify: `src/modules/reports/service.ts` (`collectionRegister`: `refunds`, `programId`), `src/modules/reports/routes.ts` + `csv.ts` (entry `revenue`), `src/app/(tenant)/reports/page.tsx`, `src/lib/auth/nav.ts` (Finance › Reports, `STATIC_TITLES` for the moved pages)
- Test: `src/modules/reports/reports.integration.test.ts`, `src/lib/auth/nav.test.ts`

**Interfaces:**
- Consumes: `revenueReport` (Task 16), CSV builder (Task 10).
- Produces: `CollectionRegister` adds `refunds: { count: number; totalPaise: Paise; byDay: Total[] }` and accepts `programId?: string`; routes `/finance/reports`, `/finance/reports/collection`, `/finance/reports/dues`, `/finance/reports/revenue`.

- [ ] **Step 1: Write the failing tests**

```ts
it("the register shows the range's refunds beside its total", async () => {
  // ₹1,500 paid on 2026-09-24, ₹500 of it refunded the same day
  expect(r.total.totalPaise).toBe(150_000n);
  expect(r.refunds.totalPaise).toBe(50_000n);
});
it("the register filters by program", async () => {
  // one payment on a Karate invoice, one on a Dance invoice
  expect((await register({ programId: karate })).rows.map((p) => p.id)).toEqual([karatePayment.id]);
});
it("the revenue CSV has one row per program with billed, collected, outstanding", async () => {
  const lines = (await (await csvAs(ownerCookie, "/api/reports/revenue?from=2026-09-01&to=2026-09-30")).text()).trim().split("\n");
  expect(lines[0]).toBe("Activity,Program,Billed,Collected,Outstanding");
  expect(lines.length).toBe(1 + programsWithMoneyInSeptember + 1); // header, programs, the Advance row
});
// nav.test.ts
it("Finance › Reports and the moved pages have their titles", () => {
  expect(crumbsFor("/finance/reports/collection")).toEqual([{ label: { text: "Finance" }, href: null }, { label: { text: "Reports" }, href: "/finance/reports" }, { label: { text: "Collection register" }, href: null }]);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** — `git mv` the two pages; register page shows refunds beside every total and gains a program select; Revenue page: range, by activity / program / batch, billed · collected · outstanding columns, advance row, CSV; Finance reports index cards (Collection register, Outstanding dues, Revenue, Discounts given → `/finance/discounts?tab=given`, Advance held → `?tab=advance`). `/reports` index drops the two moved cards and adds "Finance reports" linking to `/finance/reports`. Nav: **Reports** (`reports:view`) last under Finance; `STATIC_TITLES` gets `/finance/reports/collection`, `/finance/reports/dues`, `/finance/reports/revenue` and loses the old two.

- [ ] **Step 4: Run tests, then full checks — expect PASS**

- [ ] **Step 5: Chrome check** — each report, CSVs, the day links from the register open the Collections Today view for that day.

- [ ] **Step 6: Commit** — `finance: reports live with the money, refunds beside every total`.

---

## Slice 12 — Seed and docs

### Task 18: Seed, docs and a final sweep

**Files:**
- Modify: `src/lib/db/seed.ts`, `docs/03-module-specs.md` (§8, §9 "Agreed 2026-10-18"), `docs/04-fees-and-payments.md` (test list), `docs/07-ui-ux.md` (§4 sidebar groups), `docs/superpowers/specs/2026-10-18-finance-module-design.md` (status: built)
- Test: whole suite

- [ ] **Step 1: Seed** — in `seedFees` / `seedPayments`: a uniform charge added by hand and paid at the desk (Card); a part-paid invoice past due; a payer holding advance while owing; a four-installment term plan with two paid; a refund; Bright Future set to send invoices automatically, the other academy left on review.

- [ ] **Step 2: Ask the user before wiping the dev database**, then `pnpm seed` on the fresh database and open every finance page once.

- [ ] **Step 3: Docs** — the decisions from the spec's "Decided by the user" and the auto-issue and desk-charge rules into docs/03 §8–§9; the new tests into docs/04's list; docs/07 §4's MONEY group replaced by the built Finance group.

- [ ] **Step 4: Sweep** — `grep` for exports with no importer left by this work (`INVOICE_VIEWS`, `invoiceReceipts`, `myReceiptsToday`, `familyAccount` if unused, `PrintReceipt`); remove them. `grep -rnE "[\"'\`](/invoices|/payments|/fee-plans|/reports/(collection|dues))" src --include='*.ts' --include='*.tsx'` returns only `/api/` paths and the Razorpay call.

- [ ] **Step 5: Full checks — expect PASS**, then a last Chrome pass through Overview → Collections → collect → receipt → invoice → student plan → student page.

- [ ] **Step 6: Commit** — `finance: seed, docs and the last of the old paths`.
