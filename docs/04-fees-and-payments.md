# 04 — Fees and Payments

The hardest module. Get it wrong and academies stop trusting the product within a
week, because money is the one thing they check against their own memory.

## The core principle

**Build a ledger, not a subscription engine.**

```
fee_plan  →  invoice (what is owed)
                 ▲
                 │ payment_allocations
                 │
          payment (what came in, by any method)
```

An invoice is a claim. A payment is cash arriving. Allocations connect them. Any
model where "paid" is a boolean on a subscription row will break the first time a
parent pays ₹800 of a ₹1,500 fee, which will happen on day one.

## Reality check: how Indian academies actually collect

| Method | Share in year one | Notes |
|---|---|---|
| Cash | 50–70% | Handed to the teacher or front desk. Must be first-class. |
| UPI to a personal/merchant QR | 20–40% | Money arrives outside your system; staff records it manually with the UPI reference |
| Razorpay payment link | 5–20% | Grows once parents see it works |
| Bank transfer / cheque | small | Larger tuition centres, term fees |
| Razorpay auto-debit mandate | near zero at first | High friction for a ₹800/month class |

Consequences for the build:

1. **"Record cash payment" is the primary button**, not a fallback. Two taps:
   amount, done. Receipt number auto-assigned, collector recorded.
2. **UPI manual** needs a reference field and ideally a photo of the parent's
   payment screenshot attached to the payment row.
3. **Razorpay payment links** are the online method for V1. No mandate, no
   card storage, parent pays by UPI in their own app, webhook confirms.
4. **Auto-debit is V2 and optional.** Recurring mandates in India need explicit
   customer authorisation, carry per-transaction authentication rules above
   certain amounts, and require pre-debit notification. Real, but not worth it
   before you have customers. Verify the current Razorpay and RBI rules at build
   time; they change.

## Who receives the money

**Each academy connects their own Razorpay account.** Fees land in the academy's
own bank account, under the academy's own KYC. You store their key id, key secret
and webhook secret encrypted in `tenant_integrations`.

Do **not** let fees land in your account and pay academies later. In India that
makes you look like an unlicensed payment aggregator and it is not a position you
want to be in as a solo founder. If you later want a cut of transaction volume,
the correct structure is Razorpay Route with linked sub-accounts under a partner
arrangement. Treat that as a V3 business decision, not a V1 technical one.

Your own SaaS subscription revenue is separate, on **your** Razorpay account,
through `tenant_subscriptions`. Keep the two code paths apart. Never share a
credential resolver between "academy collecting fees" and "you collecting SaaS
fees". It is the kind of mistake that is invisible until it is catastrophic.

## Fee plan types

| Type | Example | Behaviour |
|---|---|---|
| `recurring` | Karate ₹800/month | Invoice generated every cycle while enrollment is active |
| `term` | Class 9 tuition ₹18,000/year in 3 installments | One fee, split into scheduled installments |
| `package` | 10 swim sessions ₹3,000 | Credits, V2 |
| `one_time` | Admission fee ₹500, uniform ₹1,200 | Single invoice line |

Admission fee is charged once per student per program, on the first invoice.

### Installments for term fees

```jsonc
// fee_plans.metadata for a term plan
{
  "installments": [
    { "label": "1st installment", "amount_paise": 700000, "due_offset_days": 0 },
    { "label": "2nd installment", "amount_paise": 600000, "due_offset_days": 120 },
    { "label": "3rd installment", "amount_paise": 500000, "due_offset_days": 240 }
  ]
}
```

Each installment becomes its own invoice at enrollment time, with due dates
computed from the enrollment start date. All three visible to the parent from day
one, which is what they ask for.

## Discounts and waivers

Three kinds, all as invoice-line or invoice-level discounts with a **mandatory
reason**:

- **Sibling discount**: second child 10%, third 15%. In V1, apply manually and
  record the reason. Automate in V2 once you have seen ten real families.
- **Scholarship / fee waiver**: full or partial. Common in deeniyat classes, which
  are often subsidised or donation-funded. Needs `approved_by` and shows on the
  invoice as a discount line, not a silently reduced amount.
- **Promotional**: joining offer, annual-payment discount.

Rule: never silently change the fee amount. Always show full fee, then discount,
then net. Parents compare notes with each other and the academy must be able to
explain every rupee.

## Late fees

Configurable per tenant: flat amount or percentage, applied N days after due date,
capped. Default **off**. Many academies do not charge late fees and will be
annoyed if the software invents them.

## Invoice numbering (statutory)

Invoice and receipt numbers must be **sequential and gapless within a financial
year**, per tenant (and per branch if the tenant wants separate series).

Implementation:

```sql
-- inside the same transaction as the invoice insert
UPDATE number_series
   SET next_number = next_number + 1
 WHERE tenant_id = $1 AND branch_id = $2 AND doc_type = 'invoice' AND fin_year = $3
RETURNING prefix, next_number - 1 AS assigned;
```

The `UPDATE ... RETURNING` takes a row lock, which serialises concurrent
allocation. Two front-desk staff collecting simultaneously cannot get the same
number.

Rules:
- A number is assigned only when an invoice moves from `draft` to `issued`.
- Cancelled invoices keep their number. Never reuse it, never renumber.
- Indian financial year is 1 April to 31 March. `fin_year` = `'2026-27'`.
- A job creates next year's series on 1 April automatically.

**Agreed 2026-09-24** (`src/lib/money/`, `src/modules/numbering/`)

- One series per academy per kind per financial year: `INV/2026-27/0042`,
  `RCT/2026-27/0007`. Columns follow docs/02 (`kind`, `fy`, `next_value`).
- The number is taken inside the transaction that creates the document, so a
  rollback returns it. A missing year row is created on first use.
- Money helpers: `bigint` paise, percentages in basis points, half-up rounding
  (away from zero), `split` gives leftover paise to the first parts, so parts
  always add back to the total.
- `numbers.open_year` runs daily at 00:05 IST and opens the new year's series on
  the first day of the tenant's financial year (`tenants.fy_start_month`).

## GST

Most small academies are below the registration threshold and charge no GST.
Some, especially larger gyms and coaching institutes, are registered.

- `tenants.gstin` optional. If absent, no tax lines, invoice says nothing about GST.
- If present: `tax_rate_bp` per fee plan, tax shown per line, GSTIN printed on the
  invoice, and the invoice must carry the tenant's registered name and address.
- Do not attempt GST return filing, HSN/SAC classification or e-invoicing. Out of
  scope permanently. Export a CSV their accountant can use.

## Payment recording

```
POST /api/payments
{
  householdId, amountPaise, method, reference?, receivedAt,
  allocations: [{ invoiceId, amountPaise }]   // optional
}
```

Rules:
- If `allocations` is omitted, auto-allocate oldest-invoice-first, and leave any
  remainder as an advance on the household.
- Sum of allocations must be ≤ payment amount. Enforce with a check in the service
  and a test.
- Invoice `status` recomputed after every allocation change:
  `paid_paise = 0` → issued/overdue; `0 < paid < total` → partially_paid;
  `paid >= total` → paid.
- A payment cannot be edited after the day it was recorded. Correct it with a
  refund or an adjustment entry, both audited. Editable payment history is how
  cash disappears.

## Razorpay payment link flow

```
1. Staff taps "Send payment link" on an invoice
2. Backend creates a Razorpay Payment Link using the TENANT's credentials,
   amount = invoice balance, with notes { tenantId, invoiceId }
3. Link is sent to the guardian over WhatsApp
4. Parent pays via UPI in their own app
5. Razorpay fires a webhook to /api/webhooks/razorpay/:tenantSlug
6. Backend verifies the signature with THAT TENANT's webhook secret,
   stores the event, creates a payment with method='razorpay_link',
   allocates it to the invoice, generates a receipt, sends it on WhatsApp
```

Webhook rules:
- Verify the signature **before** parsing anything. Reject on mismatch, log, do not
  retry-loop.
- Insert into `webhook_events` first, unique on `(provider, event_id)`. If the
  insert conflicts, the event is a duplicate: return 200 and stop.
- Process inside a transaction with the tenant context set.
- Return 200 quickly. Do the heavy work in a job if it takes more than a second.
- Events to handle in V1: `payment_link.paid`, `payment.captured`,
  `payment.failed`, `refund.processed`.
- Handle out-of-order delivery: `payment.captured` may arrive before
  `payment_link.paid`. Key on the gateway payment id, which is unique.
- **Reconciliation job**: hourly, find invoices with a link created more than 30
  minutes ago and no payment, query Razorpay directly. Webhooks get lost. This job
  is what stops an angry "I paid and it still shows pending" call.

## Refunds

- Requires `fees:refund`, a reason, and creates a `refunds` row.
- Online payments refund through the gateway. Cash refunds are recorded only.
- Refunding reduces the allocation and reopens the invoice.
- Never delete a payment. Ever.

## Money arithmetic rules

- All amounts `bigint` paise.
- Discount and tax computed per line, rounded half-up to the paisa, then summed.
  Never compute tax on the rounded total.
- Invoice total = `sum(lines.amount) - invoice_discount + tax`.
- Write a test with `₹1,500 / 3 children` and `18% tax on ₹833.33` to pin the
  rounding behaviour before anyone builds a report on it.

## The daily reconciliation screen

Every academy owner wants one screen at closing time:

```
Today, 19 Sep 2026 — Main Branch

Cash collected          ₹ 12,400   (8 receipts)  — collected by Priya ₹8,200, Amit ₹4,200
UPI (manual)            ₹  6,800   (4 receipts)
Razorpay links          ₹  4,500   (3 payments)
─────────────────────────────────────
Total                   ₹ 23,700   (15 receipts)

Cash in hand to deposit ₹ 12,400
```

If this screen matches the cash in the drawer, the owner trusts your software.
If it doesn't, nothing else you built matters. Build it in the first fee sprint,
not later.

## Test list (write these first)

Written before the payments code (Prompt 15, slice 16), to the rules agreed in
docs/03 §9. Tests live in `src/modules/payments/payments.integration.test.ts`
unless marked.

**Recording and allocation**

- [x] ₹1,500 invoice, pay ₹800 then ₹700 → paid, zero balance
- [x] ₹1,000 against a ₹1,500 invoice → `part_paid`, ₹500 outstanding
- [x] ₹3,000 payment across two ₹1,500 invoices for two siblings
- [x] ₹2,000 payment on a ₹1,500 invoice → ₹500 household advance
- [x] ₹5,000 against ₹3,000 of invoices → ₹2,000 advance, visible on the family
- [x] No allocation given → oldest due date first, then invoice number
- [x] Invoices picked by hand → only those; the rest is advance
- [x] Allocations above the payment, or above an invoice's balance → refused
- [x] A draft, void, paid, other family's or other branch's invoice → refused
- [x] Received date: today back to 7 days; future or before the financial year → refused
- [x] Advance auto-applied to next month's invoice when it is issued
- [x] Voiding an invoice with ₹800 on it → ₹800 advance, receipt unchanged, audited
- [x] Leaving after the family paid → that invoice is voided all the same, its
      money becomes advance and pays the sibling's redraft when issued (fees tests)
- [x] The same request id twice, also at the same moment → one payment, one number
- [x] Two payments for one invoice at the same moment → never paid above its total

**Receipts and numbering**

- [x] Concurrent receipt creation from two sessions → no duplicate number
- [x] 50 concurrent payments → 50 consecutive numbers, no duplicates; the year's
      receipts run from 0001 with no gap, cancelled ones included
- [x] A payment that fails and rolls back leaves no gap
- [x] The receipt shows what the payment paid when it was recorded

**Cancel and refund**

- [x] Cancel on the day → number kept, invoices reopened, audited
- [x] Cancel on a later day → refused; someone else's needs `fees:refund`
- [x] Cancel once part of it is refunded → refused
- [x] Refund of ₹500 on a paid ₹1,500 invoice → status back to `part_paid`
- [x] A refund comes out of the unused advance first, then a picked invoice
- [x] A refund above what is left on the payment → refused
- [x] Refunding does not change the original receipt
- [x] Refund without `fees:refund` → 403

**Collection sheet**

- [x] Day's collection total equals the sum of payments to the paisa
- [x] Split by method and by collector; cancelled receipts listed, not counted
      (a cancel takes the payment off the day's total)
- [x] Cash in hand = cash collected − cash refunded that day
- [x] A payment at 23:50 IST counts on that IST day, not the UTC one
- [x] A back-dated payment counts on the day it was recorded
- [x] The dashboard's "Collected today" is the sheet's total
- [x] Routes: recording needs `fees:collect`, refunding `fees:refund`; a
      repeated request returns the same payment

**After every scenario above**

- [x] `invoices.paid_paise` = the sum of that invoice's allocations
- [x] A payment's allocations plus refunds ≤ its amount
- [x] Status matches paid against total (also a database check)
- [x] Payments, allocations and refunds: tenant isolation (`pnpm test:isolation`)
- [x] At the database: a payment's amount, method, dates and number cannot be
      updated; allocations and refunds are append-only; checks on sign, reason,
      cancel and invoice status (migration 0015)

**Later**

- [ ] Duplicate webhook → exactly one payment (Prompt 16)
- [ ] `payment.captured` arriving before `payment_link.paid` → one payment (Prompt 16)
- [ ] Tenant A's Razorpay webhook cannot create a payment in tenant B (Prompt 16)
- [ ] Late fee applied once, not once per reminder run. Not scheduled: late fees
      aren't built, and docs/03 §8 adds a line to an issued invoice, which §8
      also forbids. Decide that first.

## What could go wrong with payments

| Risk | Guard | Test |
|---|---|---|
| A double tap on a slow network makes two receipts | request id, unique per academy | same id twice, at once |
| Two desks pay one invoice at the same moment | the family is locked while money moves; database check paid ≤ total | concurrent payments |
| Receipt numbers skip or repeat | number taken in the payment's transaction | 50 concurrent, rollback |
| `paid_paise` drifts from the allocations | one function moves money; invariant check | after every scenario |
| Money lands on the wrong invoice | invoice read under RLS; same family, same branch, issued or part paid | refused cases |
| Someone edits a payment afterwards | database refuses updates to amount, method, dates and number; allocations and refunds append-only | database guards |
| The wrong day on the sheet | the day is stored at recording, in the academy's timezone | 23:50 IST |
| A refund rewrites the receipt | the receipt reads only the allocations made at recording | refund test |
