import Link from "next/link";
import type { ReactNode } from "react";
import { Money } from "@/components/money";
import { METHOD_LABEL } from "@/modules/payments/labels";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import type { Receipt } from "@/modules/payments/service";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="text-right text-body">{children}</dd>
    </div>
  );
}

// The receipt as it was recorded (docs/03 §9), for staff and for the family's
// private link. Invoice numbers link through only when `invoiceHref` is given.
export function ReceiptCard({ r, invoiceHref }: { r: Receipt; invoiceHref?: (invoiceId: string) => string }) {
  const p = r.payment;
  return (
    <Card className="mx-auto max-w-xl print:max-w-none print:border-0 print:p-0 print:shadow-none">
      {p.status === "cancelled" ? (
        <p role="status" className="mb-4 rounded-lg border border-danger-600 px-3 py-2 text-center text-label text-danger-600">
          ✗ Cancelled · {p.cancelReason}
        </p>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 pb-3">
        <div className="min-w-0">
          <p className="text-heading">{r.academy.name}</p>
          <p className="text-caption text-muted-foreground">{[r.academy.branch, r.academy.address].filter(Boolean).join(" · ")}</p>
          {r.academy.gstin ? <p className="text-caption tabular-nums">GSTIN {r.academy.gstin}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-caption uppercase tracking-wide text-muted-foreground">Receipt</p>
          <p className="text-body font-medium tabular-nums">{p.receiptNumber}</p>
          <p className="text-caption text-muted-foreground">{formatDate(p.receivedOn)}</p>
        </div>
      </div>

      <dl className="divide-y divide-neutral-100">
        <Fact label="Received from">{r.householdName}</Fact>
        <Fact label="Amount">
          <Money paise={p.amountPaise} className="text-number" />
        </Fact>
        <Fact label="Paid by">{[METHOD_LABEL[p.method], p.reference].filter(Boolean).join(" · ")}</Fact>
        {p.recordedOn !== p.receivedOn ? <Fact label="Recorded on">{formatDate(p.recordedOn)}</Fact> : null}
        <Fact label="Received by">{r.collectorName ?? "Online"}</Fact>
      </dl>

      <h2 className="mt-4 text-label text-muted-foreground">Towards</h2>
      <ul className="mt-1 divide-y divide-neutral-100">
        {r.lines.map((l) => (
          <li key={l.invoiceId} className="flex min-h-11 items-center justify-between gap-3">
            {invoiceHref ? (
              <Link href={invoiceHref(l.invoiceId)} className="text-body tabular-nums text-accent-600 hover:underline print:text-neutral-900">
                {l.number}
              </Link>
            ) : (
              <span className="text-body tabular-nums">{l.number}</span>
            )}
            <Money paise={l.amountPaise} className="text-body" />
          </li>
        ))}
        {r.advancePaise > 0n ? (
          <li className="flex min-h-11 items-center justify-between gap-3">
            <span className="text-body">Kept as advance</span>
            <Money paise={r.advancePaise} className="text-body" />
          </li>
        ) : null}
      </ul>
    </Card>
  );
}
