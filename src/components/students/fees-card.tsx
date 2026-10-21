import Link from "next/link";
import { InvoiceStatus } from "@/components/fees/invoice-status";
import { Money } from "@/components/money";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate, periodLabel } from "@/lib/dates";
import type { InvoiceRow } from "@/modules/fees/repo";
import { METHOD_LABEL } from "@/modules/payments/labels";
import type { StudentProfile } from "@/modules/students/profile";

type Fees = NonNullable<StudentProfile["fees"]>;

// One invoice is one payer's bill: never summed with another's.
function InvoiceItem({ i, upcoming }: { i: InvoiceRow; upcoming: boolean }) {
  const balance = i.totalPaise - i.paidPaise;
  const what = i.installment ? `Installment ${i.installment.n} of ${i.installment.of}` : periodLabel(i.periodStart, i.periodEnd);
  return (
    <li>
      <Link href={`/finance/invoices/${i.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-neutral-50">
        <span className="min-w-0">
          <span className="block truncate text-body font-medium">{i.billToName}</span>
          <span className="block text-caption text-muted-foreground">
            {i.number ?? "Draft"} · {what ? `${what} · ` : ""}due {formatDate(i.dueDate)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <Money paise={i.totalPaise} className="text-body font-medium" />
          {balance > 0n ? <span className="text-caption text-muted-foreground">Owes <Money paise={balance} /></span> : null}
          <InvoiceStatus status={upcoming ? "upcoming" : i.display} />
        </span>
      </Link>
    </li>
  );
}

const dash = "—";
const PER: Record<string, string> = { monthly: "month", quarterly: "3 months", half_yearly: "6 months", yearly: "year" };

function PlanItem({ p }: { p: Fees["plans"][number] }) {
  return (
    <li className="py-2">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 truncate text-body font-medium">{p.programName} · {p.batchName}</span>
        <span className="shrink-0 text-body">
          <Money paise={p.amountPaise} />
          {p.kind === "recurring" ? <span className="text-caption text-muted-foreground"> / {PER[p.cycle] ?? "cycle"}</span> : null}
        </span>
      </div>
      <p className="text-caption text-muted-foreground">
        {p.planName} · Next bill {p.nextBill ? formatDate(p.nextBill) : dash} · {p.payerName || dash}
      </p>
    </li>
  );
}

function Figure({ label, paise }: { label: string; paise: bigint }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-body font-medium"><Money paise={paise} /></dd>
    </div>
  );
}

export function FeesCard({ fees, nextDue, student, canCollect, canInvoice }: { fees: Fees; nextDue: string | null; student: string; canCollect: boolean; canInvoice: boolean }) {
  const { today, invoices, receipts, plans, totals, advance } = fees;
  const upcoming = new Set(fees.upcoming);
  const month = today.slice(0, 7);
  const thisMonth = invoices.filter((i) => i.issueDate.startsWith(month));
  const earlier = invoices.filter((i) => !i.issueDate.startsWith(month) && (i.status === "issued" || i.status === "part_paid"));
  const history = invoices.filter((i) => !thisMonth.includes(i) && !earlier.includes(i));
  const last = receipts[0];
  const payer = (invoiceId: string) => invoices.find((i) => i.id === invoiceId)?.billToName ?? "";
  return (
    <Card>
      <CardHeader
        title="Fees & Payments"
        action={
          canCollect || canInvoice ? (
            <div className="flex flex-wrap gap-2">
              {canCollect ? (
                <Button size="sm" nativeButton={false} render={<Link href={`/finance/collections?collect=1&student=${student}`} />}>
                  Collect payment
                </Button>
              ) : null}
              {canInvoice ? (
                <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/finance/invoices?create=1&student=${student}`} />}>
                  Create invoice
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />
      {plans.length ? <ul className="mb-3 divide-y divide-neutral-100">{plans.map((p) => <PlanItem key={p.enrollmentId} p={p} />)}</ul> : null}
      <dl className="mb-3 grid grid-cols-3 gap-3">
        <Figure label="Billed" paise={totals.billedPaise} />
        <Figure label="Paid" paise={totals.paidPaise} />
        <Figure label="Outstanding" paise={totals.outstandingPaise} />
      </dl>
      {advance.length ? (
        <ul className="mb-3 text-caption text-muted-foreground">
          {advance.map((a) => (
            <li key={a.payerName}>
              Advance · {a.payerName}: <Money paise={a.advancePaise} />
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="divide-y divide-neutral-100">
        <div className="flex min-h-10 items-center justify-between gap-3">
          <dt className="text-label text-muted-foreground">Next due</dt>
          <dd className="text-right text-body">{nextDue ? `${formatDate(nextDue)}${nextDue < today ? " · overdue" : ""}` : dash}</dd>
        </div>
        <div className="flex min-h-10 items-center justify-between gap-3">
          <dt className="text-label text-muted-foreground">Last payment</dt>
          <dd className="text-right text-body">
            {last ? (
              <>
                <Money paise={last.net} /> <span className="text-caption text-muted-foreground">· {formatDate(last.receivedOn)}</span>
              </>
            ) : (
              dash
            )}
          </dd>
        </div>
      </dl>
      <p className="mb-1 mt-4 text-label text-muted-foreground">This month</p>
      {thisMonth.length ? (
        <ul className="divide-y divide-neutral-100">
          {thisMonth.map((i) => (
            <InvoiceItem key={i.id} i={i} upcoming={upcoming.has(i.id)} />
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground">Nothing billed.</p>
      )}
      {earlier.length ? (
        <>
          <p className="mb-1 mt-4 text-label text-muted-foreground">Earlier, unpaid</p>
          <ul className="divide-y divide-neutral-100">
            {earlier.map((i) => (
              <InvoiceItem key={i.id} i={i} upcoming={upcoming.has(i.id)} />
            ))}
          </ul>
        </>
      ) : null}
      {history.length ? (
        <details className="mt-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-label text-accent-600">Earlier invoices · {history.length}</summary>
          <ul className="divide-y divide-neutral-100">
            {history.map((i) => (
              <InvoiceItem key={i.id} i={i} upcoming={upcoming.has(i.id)} />
            ))}
          </ul>
        </details>
      ) : null}
      <p className="mb-1 mt-4 text-label text-muted-foreground">Payments</p>
      {receipts.length ? (
        <ul className="divide-y divide-neutral-100">
          {receipts.map((r) => (
            <li key={`${r.paymentId}-${r.invoiceId}`} className="flex min-h-10 items-center justify-between gap-3 py-1">
              <span className="min-w-0">
                <span className="block text-body">{formatDate(r.receivedOn)}</span>
                <span className="block truncate text-caption text-muted-foreground">
                  {METHOD_LABEL[r.method]} · {payer(r.invoiceId)}{r.fromAdvance ? " · from advance" : ""}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <Money paise={r.net} className="text-body font-medium" />
                <span className="text-caption text-success-700">✓ Received</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground">No payments yet.</p>
      )}
    </Card>
  );
}
