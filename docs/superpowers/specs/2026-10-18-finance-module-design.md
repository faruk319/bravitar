# Finance module — design

Date: 2026-10-18 · Status: **approved by the user 2026-10-18** ("go with your suggestion and make build plan")
Builds on: `2026-10-07-finance-module-decisions.md`, `2026-10-07-member-guardian-payer.md`,
`2026-10-07-reports-analytics-decisions.md` · Measured at `f08bca1`

## Why

An academy owner must never ask *"ye ₹2,000 kis cheez ke liye liye?"*. Every rupee
on screen answers: **who** (student, payer), **what** (program, batch), **why** (fee,
installment, advance, one-off charge), **which plan**, **how much**, **allocated to
which invoice**, **what is still due**, **when**, **how** (method, reference).

Positioning: Zen Planner's "billing on autopilot", built for cash and UPI.

## Decided by the user

1. Rebuild the screens, keep the tested money logic: allocation, proration, idempotent billing (2026-10-07).
2. Everything moves under `/finance/*`, no redirects (2026-10-07).
3. Collect payment is a drawer on Collections; `/payments/new` goes away (2026-10-07).
4. The student-side "subscription" gets another name, because Subscriptions already
   means the academy's own Bravitar plan (2026-10-07). Name chosen below.
5. **Advance keeps paying the next invoice automatically**, and every screen shows
   where money came from (2026-10-18). No manual "Apply credit" step.
6. **Modify existing code; write new code only where nothing exists** (2026-10-18).
7. **Invoices can go out by themselves — the owner chooses** (2026-10-18). An academy
   setting, *Send invoices: after I review* (default, today's behaviour) or
   *automatically*. Rules in "Auto-issue" below.
8. **Anyone who can collect may add a one-off charge at the desk, only when it is
   paid in full in the same step** (2026-10-18). A charge left owing needs Create
   invoice and `invoices:manage`.

## What already exists

| The brief asks for | In the code |
|---|---|
| fee_plans, invoices, invoice_items, payments, payment_allocations, discounts, refunds, audit | all exist (`invoice_lines` = invoice items, `audit_log`) |
| Fee plan types, installments, admission fee | `fee_plans.kind` recurring / term / one_time (package stored, not billed); `metadata.installments`; `admission_fee_paise` |
| Subscription (student + plan) | an **enrollment** with `fee_plan_id` and an optional payer override |
| Automatic billing, no duplicates | `invoices.generate` job, 02:00 IST, billing keys; makes **drafts** the owner issues |
| Oldest-first allocation, manual pick, partial, advance | `payments/allocation.ts` (`oldestFirst`, `picked`), `applyAdvance` on issue |
| Overdue derived, never stored by a job | `isOverdue` in `fees/billing.ts` |
| Immutable money | DB refuses edits to payments; allocations and refunds append-only; same-day cancel, refunds with reason |
| Pause, resume, change plan, leave | `pauseEnrollment`, `resumeEnrollment`, `setEnrollmentPlan`, `leaveEnrollment` |
| Student discounts with reason | `discounts` + `student_discounts`, printed per invoice line |
| Receipt, print, WhatsApp | `/payments/[id]`, browser print, `Composer`, public `/r/<token>` |
| Daily cash sheet | `collectionSheet` (by method, by collector, refunds, cash in hand) |
| Collection register, dues, CSV | `/reports/collection`, `/reports/dues`, `/api/reports/<name>` |
| Student finance view | Fees & payments card on `/students/[id]` |

**Genuinely missing:** Finance Overview · Student plans pages · Discounts & credits
page · a filterable Collections table · **Create invoice** (no one-off charges at
all) · a payer picker in collect (a multi-payer family gets a 400 "Say who is
paying") · per-invoice amounts when allocating · revenue by program · a receipt
that says what each invoice was for.

## Goals, non-goals, anti-goals

**Goals:** the eight pages below, one look and one set of words across them; the
collect flow fixed for multi-payer families; one-off charges; numbers that reconcile.

**Non-goals (later, or never):** autopay and UPI AutoPay mandates (docs/04 V2) ·
billing class packs · failed-payment retries · accounting sync · POS and inventory
(CLAUDE.md) · late fees · GST filing · Excel/PDF export (CSV only) · a PDF library
(browser print) · editing issued invoices or any payment · a stored credit table ·
discount approval thresholds · per-plan discount rules · plan descriptions.

**Anti-goals — failure even if it works:**
- A total that doesn't add up: revenue by program must sum to the collection total.
- A rupee shown without its receipt or invoice behind it.
- Losing the daily cash sheet (docs/04: "if this screen matches the drawer, the owner trusts you").
- A link already sent to a parent breaking (they use `/i/<token>`, `/r/<token>`, `/portal/*`, none move).

## Words on screen

| Thing | Screen word | Notes |
|---|---|---|
| fee_plan | **Fee plan** | the template |
| enrollment + fee plan | **Student plan** | the brief's "Subscription" |
| invoice draft | **Draft** | parents never see it |
| issued, not past due | **Due** | the brief's "Issued" |
| part paid, not past due | **Part paid** | |
| issued or part paid, past due | **Overdue** | derived when read; beats Part paid |
| paid | **Paid** | |
| void | **Cancelled** | DB keeps `void`; number kept |
| unused payment money | **Advance** | belongs to the payer (parent), per branch |
| payment confirmed / with refunds / fully refunded / cancelled | **Received / Part refunded / Refunded / Cancelled** | |
| later unpaid installments of a term plan | **Upcoming** | only the earliest unpaid one is Due |

Colours: Paid success, Due warning, Overdue danger, Part paid accent, Draft and
Cancelled neutral. `-700` for text, `-600` for fills (two-tier rule).
Spelling stays "installment", as in the code and existing screens.

## Routes and navigation

Pages move with `git mv` and are then modified. API routes stay where they are.

| Old | New | Permission |
|---|---|---|
| — | `/finance` Overview | `invoices:read` or `payments:read`; each block gated |
| `/payments` | `/finance/collections` | `payments:read`, or `fees:collect` (see Collections) |
| `/payments/[id]` | `/finance/collections/[id]` (receipt) | as today |
| `/payments/new` | deleted; the drawer `?collect=1` | `fees:collect` |
| `/invoices`, `/invoices/[id]` | `/finance/invoices`, `/finance/invoices/[id]` | `invoices:read` |
| — | `/finance/student-plans`, `/finance/student-plans/[id]` | `invoices:read` |
| `/fee-plans` | `/finance/fee-plans` | `fee_plans:manage` |
| — | `/finance/discounts` | `invoices:read` |
| `/reports/collection`, `/reports/dues` | `/finance/reports/collection`, `/finance/reports/dues` | `reports:view` |
| — | `/finance/reports`, `/finance/reports/revenue` | `reports:view` |

Sidebar Finance children, in order: Overview · Collections · Invoices · Student
plans · Fee plans · Discounts & credits · Reports. "Collect payment" leaves the
sidebar. The brief's separate "Payments" page is not built: Collections is the list
of payments.

`NavItem.permission` accepts a list meaning *any of*, so Collections shows for
`payments:read` or `fees:collect` — this keeps Front Desk's path (the reason the
last merge was reverted; `nav.test.ts` protects it). `STATIC_TITLES`, breadcrumbs
and every internal link follow. `/reports` keeps attendance, at-risk, admissions
and enquiries, plus a link to Finance › Reports.

## Shared list pattern

The Students list is the pattern: stat cards, a card holding a URL-driven filter
bar, a table from `md` up and cards below it, paging "1–10 of 142" with
Previous/Next, 10 a page (`students/service.ts` `PAGE_SIZE`). The URL mechanics of
`StudentSearchBar` become a shared filter bar used by Students, Invoices and
Collections. Status tabs are `SegmentedTabs` pills with counts in the label
(docs/07 §6), not the reference image's underlines. A Sort select (newest, oldest,
amount, due date) sits in the filter bar. No bulk checkboxes.

## Pages

### Overview — `/finance` (new page; reuses the dashboard's money queries)

Six stat cards, each linking to the list behind it:

| Card | Definition | Gate |
|---|---|---|
| Today's collection | confirmed + refunded payments recorded today; % vs yesterday; "Refunded ₹X" note when any | `payments:read` |
| This month | same, month to date; refunds note | `payments:read` |
| Outstanding | balance of issued + part-paid invoices | `invoices:read` |
| Overdue | the part of it past due; count | `invoices:read` |
| Due in 7 days | balance with due date today through today + 6 | `invoices:read` |
| Advance held | unused money across payers | `invoices:read` |

Charts — product blue, status colours only on the status bar:
- **Collection trend**, 7 / 30 / 90 days by day (`?days=`): the dashboard's
  Recharts `revenue-overview.tsx`, changed to take day buckets; data from `collectedByDay`.
- **Collected vs outstanding** this month: CSS bars (`components/reports/bars.tsx`).
- **Revenue by program** this month (by activity when the academy has 2+): CSS `BarList`, collected basis (rules below).
- **By method** this month: CSS `BarList` from the register's `byMethod`.
- **Fee status** of invoices issued this month, by amount: a CSS stacked bar like `attendance-overview.tsx`.

**Attention required** reuses `attention-required.tsx`. Each row links to a filtered list:
overdue invoices + amount · due this week + amount · drafts waiting to be issued + total
· part-paid invoices · payers holding advance while they still owe (see Use advance).

On phones a sticky bottom **Collect payment** button (also on Collections).

### Collections — `/finance/collections` (modified `/payments`)

Header: Collections · `+ Collect payment` (`fees:collect`).
Period tabs with counts: **Today · This week · This month · All** (weeks start
Monday, in the academy's timezone). Method is a filter, not tabs (eight tabs don't
fit a phone).
Search: receipt number, payer, student, reference. Filters: dates, program, method,
collected by, status. Sort.

Columns: Date · Receipt · Student(s), payer under · Program · Towards (invoice
numbers, "+ ₹X advance") · Amount · Method · Collected by · Status. Row → receipt.

**The daily cash sheet stays.** On Today, or when the date filter is one day, the
existing `collectionSheet` card (by method, by collector, refunds, cash in hand to
deposit) sits above the table, one per branch as now.

**Front Desk** (`fees:collect` without `payments:read`) sees the Collect button and
only the receipts they recorded today — what they need to hand a receipt over or
cancel a mistake the same day (the existing cancel rule). An owner wanting more
ticks `payments:read` for that role.

CSV of the filtered list, server-side, `reports:export`.

### Collect payment drawer (modified `collect-form.tsx` + `/payments/new` logic)

Opens on Collections from `?collect=1[&student=][&invoice=]`; every other "Collect"
button (dashboard, Overview, student page, invoice page, student plan) links there.
`Sheet side="auto"`: right panel from 768px, full-height sheet on phones.
One scrolling form; sections appear as they apply, no Next buttons.

1. **Student** — search by student, parent or phone (existing `MemberSearch`).
   Shows name, code, branch when there are several.
2. **Who is paying** — only when the student and their guardian-siblings have more
   than one payer with dues, or no single default. Lists payers with what each owes.
   Never guessed; the API already refuses to cross payers.
3. **What they owe** — the payer's student plans ("Swimming Beginner · ₹2,000 a
   month"), open invoices oldest first ("Oct 2026 · Swimming Beginner · INV/2026-27/0042
   · due 5 Oct · ₹2,000 · Overdue"; part paid shows what's left), advance already held.
   When the payer holds advance *and* owes, **Use advance now** sits here too.
4. **What is this payment for?** — **Fees due** (default when anything is open) ·
   **Advance** (nothing open is touched) · **New charge** (admission, exam, uniform &
   kit, other: creates and issues a one-off invoice and pays it in full, in one
   transaction; `fees:collect` is enough; an amount below the charge is refused
   with "A charge added here is paid in full"; anything above it follows the
   usual rules — ticked invoices, then advance; arrives with Create invoice).
5. **Amount received**, numeric keypad, prefilled with what's ticked. Live split:
   each invoice's amount, "₹X kept as advance — pays the next invoice by itself",
   "Still due after this: ₹Y". **Change split** edits per-invoice amounts, checked in
   the browser by the same `picked()` rules the server runs.
6. **Method**: Cash · UPI · Card · Bank · Cheque. Card joins `HAND_METHODS` (the DB
   already allows it; for a swipe machine). Reference optional for all, labelled per
   method. No "Other": it can't be reconciled.
7. Received on (today, up to 7 days back: unchanged) · Notes (the API has it; the
   form didn't). Notes are internal: shown to staff, never on the parent's copy.
8. **Record ₹X** → the receipt page (docs/07 §7.4: never back to a list).

### Receipt — `/finance/collections/[id]` (modified `receipt-card.tsx`)

Adds what the brief asks while staying the receipt *as recorded*:
- **Student(s)** the money was for, beside "Received from" (the payer): the
  students on the invoices it paid; for a payment that is all advance, the payer's
  active children (`activeStudentsOf`), since advance belongs to the payer.
- **Towards**, per invoice: number · what it was for ("Swimming Beginner · Oct 2026",
  "2nd installment · Karate Annual", "Admission · Karate Kids") · student · amount.
  `receiptLines` joins the invoice lines; still `kind = 'receipt'` rows only.
- "Kept as advance ₹X — pays the next invoice by itself".
- **Balance due after this payment** — a snapshot taken when recorded (new column,
  below), so a reprint never changes. Older receipts simply omit it.
- Actions: Print / Save as PDF (browser) · Send on WhatsApp (existing Composer) ·
  Refund · Cancel (existing rules).

### Invoices — `/finance/invoices` (modified `/invoices`)

Header: Invoices · Generate now (exists) · `+ Create invoice` (`invoices:manage`).
Drafts banner stays (count, total, Issue all).
Status tabs with counts: **All · Draft · Due · Part paid · Overdue · Paid · Cancelled**
(replaces `INVOICE_VIEWS` draft/unpaid/overdue/month/void; "This month" becomes a
date filter). Each invoice is in exactly one tab.
Search: number, student, payer. Filters: program, batch, issue dates, due dates. Sort.
Columns: Invoice (number or Draft, issue date) · Student (payer under) · Program
(first, "+1") · Period ("Oct 2026", "Installment 2 of 4") · Total · Paid · Balance ·
Due date · Status. Row → detail.

### Invoice detail — `/finance/invoices/[id]` (modified page; a page, not a drawer)

- Facts: status, issue date, due date, student(s), payer, program(s), **student plan**
  link(s), fee plan(s), period, created by and issued by (new columns), cancel reason.
- Fee breakdown: existing `InvoiceLines` (fee, discount with reason, tax per line).
- Total · Paid · Balance.
- **Money history**, every movement on this invoice: paid at the desk or online
  (receipt, date, method) · **paid from advance** (the original receipt and its
  date: "₹2,000 from advance · RCT/2026-27/0007, received 26 Sep, UPI") · refunded ·
  released when cancelled. From `payment_allocations.kind`.
- Actions: Collect payment · Payment link · Remind (exist) · Issue (draft) ·
  **Edit** (manual drafts only) · **Print** (browser) · **Cancel invoice** (existing
  void with reason and "bill again").

### Create invoice (new; `invoices:manage`)

Sheet from Invoices, the student page and a student plan. Student (search), payer
(the student's default; picker when several), branch from the student. Lines:
kind — Admission · Exam · Uniform & kit · Other (`LINE_KINDS` admission / exam /
item / other) — description, amount, optional program (one of the student's
enrollments, so reports can attribute it). Tax rate only when the academy has a
GSTIN, default 0. Due date default today + 7. **Save as draft** or **Create and
issue**. A hint shows when the plan already billed this student's admission for
that program. Manual drafts (no billing key on any line) can be edited until
issued; generated drafts are fixed by correcting the plan or discount and
cancelling with "bill again", as today. Audited `invoice.create` / `invoice.edit`
(the desk path records `via: "collect"`). Built on `insertInvoice`, `insertLines`,
the existing `retotal` and `issueInvoices`.

### Auto-issue (new academy setting)

On the Settings fee card beside GSTIN and proration (`fee-settings.tsx`,
`saveFeeSettings`, `settings:manage`, audited): **Send invoices — after I review /
automatically**. Default *after I review*.

With *automatically*, every draft `generateInvoices` makes — the nightly run,
Generate now, and the redraft after "cancel and bill again" or a student leaving —
is issued in the same transaction: number taken, bill-to name frozen, advance
applied, reminders follow as for any issued invoice. A draft with no payer name
stays a draft, as today. **Manual drafts are never auto-issued**: staff chose
draft. The issue logic moves into an actor-based core (like `generateInvoices`)
so the job can call it; `issueInvoices` keeps its permission check on top.
The Invoices page says which mode is on beside the drafts banner.

### Student plans — `/finance/student-plans` and `/[enrollmentId]` (new pages)

List: enrollments with a fee plan in the viewer's branches. Tabs **Active · Paused ·
Ended** (left; a transferred link is not listed — it continues as the next one).
Columns: Student · Program / batch · Fee plan (₹ / cycle) · Started · Next bill ·
Payer · Outstanding · Status. Search and filters: program, batch, fee plan.

Detail: student, program, batch, payer · fee plan, cycle, base amount, the
student's running discounts, amount after discount (`lineAmounts`) · start, end ·
**Total billed · Paid · Outstanding · Advance** (payer's) · **timeline**: one row per
billed period or installment ("Sep 2026 · Paid", "Oct · Part paid · ₹1,000 left",
"Installment 3 of 4 · Due 5 Jan", "4 of 4 · Upcoming").
Actions reuse existing services and keys: Pause / Resume / Change plan / Leave
(`enrollments:manage`; change plan applies from the next charge, history
untouched) · Create invoice · Collect payment.

**Next bill**: recurring — the start of the next cycle from `cycleContaining`,
none once ended or paused; term — the next unpaid installment's due date;
one-time — none. A pure helper beside `isOverdue`.

### Fee plans — `/finance/fee-plans` (moved, modified)

List as today (type and cycle, amount, admission fee, program, students, archived).
`plan-editor.tsx` gains **Split into installments**: total, how many, every N
days (installments are stored as days after the start), first due after N days
→ fills the rows, which stay editable, with a
"adds up to ₹X" check. Types read: Recurring (monthly, quarterly, half-yearly,
yearly) · Term in installments · One-time. The Discounts card moves out.

### Discounts & credits — `/finance/discounts` (new page; moved catalogue)

Tabs: **Discounts · Given · Advance**.
- Discounts: the catalogue, moved from Fee plans (`AddDiscount`, `DiscountToggle`; `fee_plans:manage`).
- Given: every student discount — student, discount, value, reason, from–to,
  approved by, running or ended; End (`invoices:manage`, existing). Giving stays on
  the student page. Discount given in a date range (sum of line discounts on
  issued invoices) with CSV.
- Advance: payers holding unused money — payer, children, branch, amount, since,
  the receipts it came from; CSV. **Use advance now** (`fees:collect`) runs the
  existing `applyAdvance` for a payer who also owes: today that money only moves
  when their next invoice is issued, so Overview can show both "advance ₹500" and
  "overdue ₹2,000" for the same parent.

### Student page — Fees & payments card (modified `fees-card.tsx`)

Stays in its slot on the single profile page. Adds: each current plan (program,
batch, ₹ / cycle, next bill, payer) · Total billed · Paid · Outstanding · Advance
(per payer when several) · the existing invoice groups with program, period and
the new statuses · payments marked "from advance" where so · actions Collect
payment, Create invoice, Give discount (exists). Invoices are per member, so these
totals need no attribution.

### Finance reports — `/finance/reports`

Index cards: **Collection register** (moved; gains a program filter and the
period's refunds beside every total — the reports decision's obligation, missing
today) · **Outstanding dues** (moved; its aging columns are the overdue report) ·
**Revenue** (new: by activity, program and batch; billed and collected; range,
program, batch filters) · **Discounts given** and **Advance held** (link to those
tabs). Method breakdown lives in the register; student history is the Collections
student filter. Every report has a CSV through the existing `/api/reports/<name>`
registry, whose gate changes from `reports:view` to `reports:export`.

## How the numbers are worked out

- **Display status** (pure, `fees/billing.ts`): void → Cancelled; draft → Draft;
  paid → Paid; issued or part paid with due date before today → Overdue; part paid
  → Part paid; issued → Due. The same logic in SQL for tab counts.
- **Collected** = payments recorded in the range with status confirmed or refunded
  (`COUNTED`, unchanged), by the day recorded. Refunds always shown beside it.
- **Collected by program**: each counted payment's receipt allocations, spread over
  each invoice's lines in proportion to line total (amount + tax) with the existing
  largest-remainder `split`; the unallocated part is its own row, **Advance**. The
  rows add up exactly to the collection total. Advance applied later is not
  re-counted: that cash arrived when it was received.
- **Billed by program**: lines of invoices issued in the range and not cancelled,
  after discount, before tax.
- **Outstanding by program**, and per student plan (one invoice can carry two of a
  member's enrollments): open balances spread over lines the same way.
- **Installment position**: from the billing key `installment|root|plan|i`; "i+1 of n"
  where n counts that root and plan's installment lines.

## Data changes

No new tables, so no new isolation tests; the suite still runs every slice.

1. `payments.balance_after_paise bigint` nullable: the payer's open balance in that
   branch after the payment, written by `recordPayment` and `recordGatewayPayment`;
   added to the existing no-update guard.
2. `invoices.created_by`, `invoices.issued_by` uuid → staff, nullable (null = the
   nightly job).
3. `tenants.invoice_issue text not null default 'review'`, check `review | auto`.

One migration per change, each with its `-- down`, numbered when built.

## Permissions

No new keys. Refund `fees:refund`; cancel payment as today; cancel invoice, create,
edit, issue `invoices:manage`; collect, use advance, and a charge paid in full at
the desk `fees:collect`; the auto-issue setting `settings:manage`; pause, resume,
change plan, leave `enrollments:manage`; fee plans and the discount catalogue
`fee_plans:manage`; reports `reports:view`, CSV `reports:export`. Every service
calls `assertCan`; routes use the helpers on top; the fees feature flag gates every
finance page.

## Reused and changed, not rebuilt

| Need | Existing code, changed |
|---|---|
| Collect drawer | `collect-form.tsx`, `/payments/new` page logic, `collectScreen`, `paymentSchema` |
| Receipt detail | `receipt-card.tsx`, `receiptLines` |
| Invoice list and statuses | `listInvoices`, `invoiceList`, `InvoiceStatus`, `isOverdue` |
| Money history | `receiptsOnInvoice` (adds the allocation kind) |
| One-off invoices | `insertInvoice`, `insertLines`, `retotal`, `issueInvoices` |
| Collections table | `paymentsRecordedBetween` / `SheetPayment`, `collectionSheet` |
| Overview | dashboard money block, `collectedByDay`, `owedSummary`, `revenue-overview.tsx`, `attention-required.tsx`, `StatCard`, `bars.tsx` |
| Student plans | `enrollmentsOfStudent`, `cycleContaining`, `lineAmounts`, enrollment services |
| Advance list, Use advance | `unusedWhere`, `applyAdvance` |
| Filter bar | `StudentSearchBar` URL mechanics |
| Reports | `collectionRegister`, `outstandingDues`, `csv.ts`, `routes.ts` |

New files only for pages that don't exist yet (Overview, Student plans list and
detail, Discounts & credits, Reports index and Revenue), the shared filter bar,
and the migrations.

## Build order

Each slice: tests first where they pin money rules, then `pnpm typecheck && pnpm
lint && pnpm test && pnpm test:isolation`, then a Chrome check, then a commit.

1. **Move under /finance** — `git mv` the pages, nav and `STATIC_TITLES`, any-of
   permission, every link, nav tests. No behaviour change.
2. **Collect drawer + receipt** — payer step, purpose (fees due, advance), change
   split, Card, notes, balance snapshot, receipt "Towards". Deletes `/payments/new`.
   Its Chrome check needs a split-payer family: set one up through an enrollment's
   payer override and restore it after, or reseed with the user's yes.
3. **Invoices** — statuses, tabs with counts, filters, paging, columns, money
   history, created/issued by, print.
4. **Create invoice** — one-off charges, manual draft edit, New charge in collect.
5. **Auto-issue setting** — migration, actor-based issue core, job, Settings card.
6. **Collections table** — tabs, filters, paging, sheet kept, Front Desk view, CSV.
7. **Student plans** — list, detail, next bill, timeline, actions.
8. **Student page card**.
9. **Fee plans editor + Discounts & credits** — installment split, the three tabs, Use advance.
10. **Overview** — cards, charts, attention; the by-program spread lives here and Reports reuses it.
11. **Finance reports** — moves, Revenue, refunds beside totals, CSV gate.
12. **Seed and docs** — new screens have data (one-off charge, part-paid overdue,
    advance with something owed, a four-installment plan mid-way, a refund); docs/03
    §8–§9 and docs/04 agreed notes; docs/07's stale MONEY group. **Wiping the dev
    database to reseed needs the user's yes first.**

## Calls made without the user — check these

1. "Student plan" for the student-side subscription.
2. Payments page folded into Collections.
3. Method as a filter on Collections, not tabs; pills, not underline tabs.
4. Front Desk sees only their own receipts today.
5. Card added for hand-recording; "Other" not added.
6. **Use advance now** button for a payer who holds advance while owing.
7. Receipt balance snapshot and invoice created/issued by — two small migrations.
8. Revenue by program spreads multi-line invoices in proportion to line totals.
9. Overdue beats Part paid; later installments read Upcoming.
10. Invoice detail stays a page, not a drawer.
11. CSV gate tightened to `reports:export` for every report.
12. Not built: plan descriptions, per-plan discount rules, large-discount approval, bulk select.
13. Auto-issue covers every generated draft (nightly, Generate now, redrafts), never manual drafts.
14. A desk charge below its amount is refused rather than left part paid.
