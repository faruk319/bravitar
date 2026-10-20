import Link from "next/link";
import type { ReactNode } from "react";
import { Money } from "@/components/money";
import { CardHeader } from "@/components/ui/card";
import { formatDate, todayIn } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { LineRow } from "@/modules/fees/repo";
import type { InvoiceDetail, InvoiceView } from "@/modules/fees/service";
import { METHOD_LABEL } from "@/modules/payments/labels";
import type { MoneyRow } from "@/modules/payments/repo";

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

export function InvoiceLines({ d }: { d: InvoiceView }) {
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
              <div className="mt-1 flex items-start justify-between gap-3 text-success-700">
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
        {inv.paidPaise > 0n ? (
          <>
            <Total label="Paid" paise={inv.paidPaise} />
            <Total label="Balance" paise={inv.totalPaise - inv.paidPaise} strong />
          </>
        ) : null}
      </dl>
    </>
  );
}

const MOVED: Record<MoneyRow["kind"], string> = { receipt: "Paid", advance: "From advance", refund: "Refunded", void: "Released to advance", cancel: "Payment cancelled" };

// Every movement of money on the invoice, oldest first. The caption is the receipt it came out of; taking back shows negative.
export function MoneyHistory({ rows, timeZone, receiptHref }: { rows: MoneyRow[]; timeZone: string; receiptHref?: (paymentId: string) => string }) {
  if (!rows.length) return null;
  return (
    <>
      <CardHeader title="Money history" className="mt-5" />
      <ul className="divide-y divide-neutral-100">
        {rows.map((r, n) => (
          <li key={n} className="flex min-h-14 items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-body">{MOVED[r.kind]}</p>
              <p className="text-caption text-muted-foreground">
                {receiptHref ? (
                  <Link href={receiptHref(r.paymentId)} className="tabular-nums text-accent-600 hover:underline print:text-neutral-900">
                    {r.receiptNumber}
                  </Link>
                ) : (
                  <span className="tabular-nums">{r.receiptNumber}</span>
                )}
                , received {formatDate(r.receivedOn)}, {METHOD_LABEL[r.method]}
                {r.reason ? ` · ${r.reason}` : ""}
              </p>
            </div>
            <div className="text-right">
              <Money paise={r.amountPaise} className="text-body" />
              <p className="text-caption text-muted-foreground">{formatDate(todayIn(timeZone, r.at))}</p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function Fact({ label, children, stacked }: { label: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={cn("flex min-h-10 justify-between gap-3", stacked ? "items-start py-2" : "items-center")}>
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="text-right text-body tabular-nums">{children}</dd>
    </div>
  );
}

// Staff pass the whole detail and also get the student, the programs billed and who made it; the family's link gets the plain facts.
export function InvoiceFacts({ d }: { d: InvoiceView & Partial<Pick<InvoiceDetail, "programs" | "createdByName" | "issuedByName">> }) {
  const inv = d.invoice;
  const students = [...new Set(d.lines.flatMap((l) => (l.studentName ? [l.studentName] : [])))];
  return (
    <>
      <p className="text-body font-medium">{d.academy.name}</p>
      <p className="text-caption text-muted-foreground">{[d.academy.branch, d.academy.address].filter(Boolean).join(" · ")}</p>
      {d.academy.gstin ? <p className="mt-1 text-caption tabular-nums">GSTIN {d.academy.gstin}</p> : null}
      <dl className="mt-3 divide-y divide-neutral-100 border-t border-neutral-100">
        {d.programs && students.length ? <Fact label={students.length > 1 ? "Students" : "Student"}>{students.join(", ")}</Fact> : null}
        <Fact label="Bill to">{d.billToName}</Fact>
        {d.programs?.length ? (
          <Fact label={d.programs.length > 1 ? "Programs" : "Program"} stacked>
            <ul className="space-y-1.5">
              {d.programs.map((p) => (
                <li key={p.enrollmentId}>
                  {p.programName} · {p.batchName}
                  {p.planName ? <span className="block text-caption text-muted-foreground">{p.planName}</span> : null}
                </li>
              ))}
            </ul>
          </Fact>
        ) : null}
        <Fact label={inv.status === "draft" ? "Planned for" : "Issued"}>{formatDate(inv.issueDate)}</Fact>
        <Fact label="Due">{formatDate(inv.dueDate)}</Fact>
        {inv.periodStart ? <Fact label="Period">{period(inv)}</Fact> : null}
        {d.createdByName ? <Fact label="Created by">{d.createdByName}</Fact> : null}
        {d.issuedByName ? <Fact label="Issued by">{d.issuedByName}</Fact> : null}
        {inv.voidReason ? <Fact label="Cancel reason">{inv.voidReason}</Fact> : null}
      </dl>
    </>
  );
}
