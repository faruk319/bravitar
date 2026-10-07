# Reports & Analytics — decision record

Date: 2026-10-07 · Status: **inventory done, decisions open**
Related: `docs/superpowers/specs/2026-10-07-finance-module-decisions.md`

## Inventory, measured at `b2f8fed`

Like the finance brief, much of this exists. `/reports` has six pages
(index, admissions, at-risk, attendance, collection, dues) and
`modules/reports/service.ts` already provides:

| Brief asks for | Exists |
|---|---|
| Collection trend, by method, by collector | `collectionRegister` → `byDay`, `byMethod`, `byCollector` |
| Daily/monthly grouping | `collectionBuckets` (`unit: "day" \| "month"`) |
| Outstanding / overdue | `outstandingDues` |
| Attendance by batch and by student | `attendanceReport` |
| Enquiry funnel | `enquiryFunnel` |
| New/exited students | `admissionsReport` (`joined`, `left`) |
| At-risk students | `atRisk` |
| `reports:view`, `reports:export` | both already in `lib/auth/permissions.ts` |
| Chart primitives | `components/reports/bars.tsx` — `Meter`, `BarList`, `Columns` |

**Genuinely new:** the unified `/reports` shell (filter bar, tabs, presets,
persistence), program and batch analytics, staff analytics, student growth and
status charts, period-over-period comparison, drill-down, and **export**.

## Conflicts between the brief and the data model

The brief names things this product does not have. None are bugs; they need a
decision each.

1. **"Suspended" student status.** `STUDENT_STATUSES` is
   `active | paused | left | prospect`. There is no suspended. The students-pages
   spec hit this too. Likely answer: "paused" is the brief's inactive, and
   suspended is not a concept here.
2. **Enquiry funnel stages.** The brief lists New → Contacted → Follow-up →
   Trial/Demo → Interested → Enrolled. The real stages are
   `new, contacted, trial_booked, trial_done, won, lost` (agreed 2026-09-25,
   `modules/enquiries/lists.ts`). There is no Follow-up or Interested stage.
   **Use the real stages** — inventing two more changes the enquiry board.
3. **Enquiry sources** nearly match. Real: walk-in, phone call, WhatsApp,
   referral, Instagram, Facebook, Google, poster/banner, other. The brief's
   "Website" does not exist; WhatsApp and poster do.
4. **"Subscription"** again means a student's fee arrangement in the brief, but
   `activity_subscriptions` is the academy's own Bravitar plan. Same resolution
   as the finance record: the student-side concept gets a different name.
5. **"Do not expose attendance outside the user's scope"** is already how this
   works — RLS plus `ctx.branchIds`. No new mechanism needed.

## The decision that changes reported revenue

The brief says *"Cancelled/reversed transactions must not incorrectly appear as
successful collection."* Today (`payments/service.ts:444`):

```ts
// Money that came in: a later refund doesn't undo that it was received that day.
// What counts as money collected: a cancelled payment never does.
export const COUNTED = new Set<Payment["status"]>(["confirmed", "refunded"]);
```

- **Cancelled is already excluded** — the brief is satisfied.
- **Refunded is counted at full value**, deliberately, on cash-book logic: a
  collection *register* records what came in that day, and a refund is a separate
  outgoing event.

**DECIDED 2026-10-07 (user): keep counting them, and show refunds separately.**
`COUNTED` stays as it is. The collection register reports what came in that day,
matching the cash box an owner reconciles against; refunds appear as their own
outgoing line rather than silently shrinking a past day's total. Every existing
figure on the dashboard and in reports is therefore correct as it stands, and no
back-dated number changes.

This closes the item left open during the dashboard redesign ("whether refunds
should be netted off is still the user's call"). The brief's "cancelled/reversed"
wording is satisfied by cancelled already being excluded.

**What this obliges Reports to do:** anywhere a collection total is shown, the
refunds for that period must be visible too — a line, a column, or a second
figure. The number is only honest when the refund beside it is visible.

## Export — the only part needing a dependency

`reports:export` already exists and is described as "Export reports as CSV", so
CSV was the plan and needs no dependency. **Excel (.xlsx) and PDF do.**

**DECIDED 2026-10-07 (user): CSV first; Excel and PDF later if asked for.** No
new dependency for this module. CSV opens in Excel and Google Sheets and covers
the real need, which is getting the filtered rows out. Revisit when someone
actually asks to forward a formatted sheet to an accountant.

Export must run **server-side**: it has to respect RLS, the caller's branch
scope and `reports:export`, and the brief requires the file to contain exactly
the filtered rows. Generating it in the browser from a paginated table would
export the current page, not the filter.

pg-boss already backs background jobs, so a large export can be queued rather
than held open on a request.

## Not to be duplicated

The brief is explicit that Reports must not restate the dashboard. The dashboard
was rebuilt 2026-10-07 with KPIs, today's schedule, attendance, collection, fee
collection and attention-required. Reports goes deeper on the same metrics:
trend, breakdown, detail rows, export.

**Two chart systems coexist** — Recharts (one dashboard component) and the CSS
primitives in `components/reports/bars.tsx`, still used by `/reports/*`. A final
branch review flagged this as worth settling before launch. Doing this module is
the moment.

## Sequencing

1. Finish the Member + Guardian + Payer migration (Tasks 7b-10). Reports reads
   invoices, payments and dues, all of which are mid-change — `duesByFamily`
   becomes `duesByPayer` in Task 8.
2. Finance module.
3. This.

Reports depends on both, so it goes last of the three.
