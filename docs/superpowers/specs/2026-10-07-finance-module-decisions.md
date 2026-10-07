# Finance / Fees & Payments module — decision record

Date: 2026-10-07 · Status: **decisions taken, not yet specced into tasks**
Builds on: `docs/superpowers/specs/2026-10-07-member-guardian-payer.md`

## The important finding: ~75% already exists

Measured against the codebase at `4a5adec`. The brief reads as a greenfield
build; it is largely a **redesign of working pages**.

| The brief asks for | Already built |
|---|---|
| `fee_plans`, `invoices`, `invoice_items`, `payments`, `payment_allocations`, `discounts`, `refunds`, audit | all of them (`invoice_lines` is `invoice_items`) |
| Oldest-invoice-first allocation, advance as the remainder | `payments/allocation.ts` — *"Oldest invoice first until the money runs out; what is left is advance"* |
| Installments | `PlanMetadata = { installments?: Installment[] }` |
| Partial payment, overdue derivation, immutable records | built |
| Student finance view | `/students/[id]` already has a **fees** tab |
| `/finance/collections`, `/finance/invoices`, `/finance/fee-plans` | exist as `/payments`, `/invoices`, `/fee-plans` |

**Genuinely new:** the Finance **Overview** (KPIs + charts), a **Subscriptions**
view, a **Discounts & Credits** page, and revenue-by-course / payment-method
reports.

## Decisions

### 1. Rebuild the surface, keep the money logic

One coherent Finance module — shared layout, tabs, filters, tables, detail
drawers — but **allocation, proration and idempotent billing stay as they are**.
They already implement what the brief describes, they are tested, and a
migration is mid-flight through the same files.

The user confirmed this is what "rebuild as one coherent module" meant: UX
coherence, not rewriting tested money rules.

### 2. Everything moves under `/finance/*`

`/invoices` → `/finance/invoices`, `/payments` → `/finance/collections`,
`/fee-plans` → `/finance/fee-plans`, plus new `/finance` (Overview),
`/finance/subscriptions`, `/finance/discounts`, `/finance/reports`.

**No redirects** — the user's call: *"this is development phase so move them."*
Nothing is deployed and the demo data is reseeded freely.

**Knock-on work this creates**, none of it optional:
- `src/lib/auth/nav.ts` — the Finance parent's children and `STATIC_TITLES`.
- Route-derived breadcrumbs (built in S1/S3) resolve from the nav config, so
  they follow automatically **only if** the nav is updated correctly.
- Every internal `Link` to a moved path, including the dashboard's quick
  actions and KPI drill-throughs.
- **Payment links sent over WhatsApp**: check `payment_links` and the portal's
  pay route for embedded paths before moving anything. A link already sent to a
  parent must not 404.

### 3. "Subscription" keeps its existing meaning

`app.activity_subscriptions` is **the academy's own Bravitar subscription** —
what the academy pays us. The brief's "subscription" is a student's recurring
fee arrangement, which in this codebase is an **enrollment plus a fee plan**,
and now carries the payer.

The student-facing concept gets a **different name** — "Fee arrangement" or
"Billing plan", decided when the page is specced. Two things called
Subscriptions in one product is the same trap the migration spec already hit
once with the word "payer on the subscription".

## Sequencing

1. Finish the Member + Guardian + Payer migration (Tasks 5-10). Finance is the
   main consumer of that model; building it first means building it twice.
2. Then this module, specced properly with the route move planned as its own
   task.

## Open, to settle when this is specced

- What the student-side "subscription" is actually called on screen.
- Whether a Finance Overview belongs at `/finance` or folds into the dashboard.
- Whether advance credit becomes a stored balance or stays derived (it is
  derived today; Task 6 moves it onto the payer).
