import { Money } from "@/components/money";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { LineRow } from "@/modules/fees/repo";
import type { InvoiceDetail } from "@/modules/fees/service";

// An invoice's lines, totals and facts, for staff and for the family's private link.
export const period = (l: Pick<LineRow, "periodStart" | "periodEnd">) =>
  l.periodStart ? (l.periodEnd && l.periodEnd !== l.periodStart ? `${formatDate(l.periodStart)} – ${formatDate(l.periodEnd)}` : formatDate(l.periodStart)) : "";

function Total({ label, paise, strong }: { label: string; paise: bigint; strong?: boolean }) {
  return (
    <div className={cn("flex min-h-10 items-center justify-between gap-3", strong && "text-heading")}>
      <dt>{label}</dt>
      <dd>
        <Money paise={paise} showPaise={paise % 100n !== 0n} />
      </dd>
    </div>
  );
}

export function InvoiceLines({ d }: { d: InvoiceDetail }) {
  const inv = d.invoice;
  // docs/04: without a GSTIN the invoice says nothing about GST.
  const gst = Boolean(d.academy.gstin) || inv.taxPaise > 0n;
  return (
    <>
      <ul className="divide-y divide-neutral-100">
        {d.lines.map((l) => (
          <li key={l.id} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-body font-medium">{l.description}</p>
                <p className="text-caption text-muted-foreground">{[l.studentName, period(l)].filter(Boolean).join(" · ")}</p>
              </div>
              <Money paise={l.unitPaise * BigInt(l.quantity)} className="text-body" />
            </div>
            {l.discountPaise > 0n ? (
              <div className="mt-1 flex items-start justify-between gap-3 text-success-600">
                <p className="text-label">Discount · {l.discountNote}</p>
                <Money paise={-l.discountPaise} className="text-label" />
              </div>
            ) : null}
            {l.taxPaise > 0n ? (
              <div className="mt-1 flex items-start justify-between gap-3 text-muted-foreground">
                <p className="text-label">GST</p>
                <Money paise={l.taxPaise} className="text-label" />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <dl className="mt-2 border-t border-neutral-100 pt-2 text-body">
        <Total label="Fees" paise={inv.subtotalPaise} />
        {inv.discountPaise > 0n ? <Total label="Discount" paise={-inv.discountPaise} /> : null}
        {gst ? <Total label="GST" paise={inv.taxPaise} /> : null}
        <Total label="Total" paise={inv.totalPaise} strong />
        {inv.paidPaise > 0n ? <Total label="Balance" paise={inv.totalPaise - inv.paidPaise} strong /> : null}
      </dl>
    </>
  );
}

export function InvoiceFacts({ d }: { d: InvoiceDetail }) {
  const inv = d.invoice;
  const facts: [string, string][] = [
    [inv.status === "draft" ? "Planned for" : "Issued", formatDate(inv.issueDate)],
    ["Due", formatDate(inv.dueDate)],
    ...(inv.periodStart ? ([["Period", period(inv)]] as [string, string][]) : []),
    ...(inv.voidReason ? ([["Void because", inv.voidReason]] as [string, string][]) : []),
  ];
  return (
    <>
      <p className="text-body font-medium">{d.academy.name}</p>
      <p className="text-caption text-muted-foreground">{[d.academy.branch, d.academy.address].filter(Boolean).join(" · ")}</p>
      {d.academy.gstin ? <p className="mt-1 text-caption tabular-nums">GSTIN {d.academy.gstin}</p> : null}
      <dl className="mt-3 divide-y divide-neutral-100 border-t border-neutral-100">
        <div className="flex min-h-12 items-center justify-between gap-3">
          <dt className="text-label text-muted-foreground">Bill to</dt>
          <dd className="text-body">{d.householdName}</dd>
        </div>
        {facts.map(([k, v]) => (
          <div key={k} className="flex min-h-12 items-center justify-between gap-3">
            <dt className="text-label text-muted-foreground">{k}</dt>
            <dd className="text-right text-body tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
