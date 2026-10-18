import Link from "next/link";
import { InvoiceStatus } from "@/components/fees/invoice-status";
import { Money } from "@/components/money";
import { Card, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { isOverdue } from "@/modules/fees/billing";
import type { InvoiceRow } from "@/modules/fees/repo";
import { METHOD_LABEL } from "@/modules/payments/labels";
import type { StudentProfile } from "@/modules/students/profile";

type Fees = NonNullable<StudentProfile["fees"]>;

// One invoice is one payer's bill: never summed with another's.
function InvoiceItem({ i, today }: { i: InvoiceRow; today: string }) {
  const balance = i.totalPaise - i.paidPaise;
  return (
    <li>
      <Link href={`/invoices/${i.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-neutral-50">
        <span className="min-w-0">
          <span className="block truncate text-body font-medium">{i.billToName}</span>
          <span className="block text-caption text-muted-foreground">
            {i.number ?? "Draft"} · due {formatDate(i.dueDate)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <Money paise={i.totalPaise} className="text-body font-medium" />
          {balance > 0n ? <span className="text-caption text-muted-foreground">Owes <Money paise={balance} /></span> : null}
          <InvoiceStatus status={i.status} overdue={isOverdue(i, today)} />
        </span>
      </Link>
    </li>
  );
}

const dash = "—";

export function FeesCard({ fees, nextDue, plans }: { fees: Fees; nextDue: string | null; plans: string[] | undefined }) {
  const { today, invoices, receipts } = fees;
  const month = today.slice(0, 7);
  const thisMonth = invoices.filter((i) => i.issueDate.startsWith(month));
  const earlier = invoices.filter((i) => !i.issueDate.startsWith(month) && (i.status === "issued" || i.status === "part_paid"));
  const history = invoices.filter((i) => !thisMonth.includes(i) && !earlier.includes(i));
  const last = receipts[0];
  const payer = (invoiceId: string) => invoices.find((i) => i.id === invoiceId)?.billToName ?? "";
  return (
    <Card>
      <CardHeader title="Fees & Payments" />
      <dl className="divide-y divide-neutral-100">
        {plans ? (
          <div className="flex min-h-10 items-center justify-between gap-3">
            <dt className="text-label text-muted-foreground">Plan</dt>
            <dd className="text-right text-body">{plans.length ? plans.join(", ") : dash}</dd>
          </div>
        ) : null}
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
            <InvoiceItem key={i.id} i={i} today={today} />
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
              <InvoiceItem key={i.id} i={i} today={today} />
            ))}
          </ul>
        </>
      ) : null}
      {history.length ? (
        <details className="mt-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-label text-accent-600">Earlier invoices · {history.length}</summary>
          <ul className="divide-y divide-neutral-100">
            {history.map((i) => (
              <InvoiceItem key={i.id} i={i} today={today} />
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
                  {METHOD_LABEL[r.method]} · {payer(r.invoiceId)}
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
