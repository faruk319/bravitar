import Link from "next/link";
import { Money } from "@/components/money";
import { formatDate, timeIn } from "@/lib/dates";
import { formatPaise } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import { DISPLAY_LABEL, METHOD_LABEL, type PaymentDisplay } from "@/modules/payments/labels";
import type { PaymentRow } from "@/modules/payments/repo";

const dash = <span className="text-muted-foreground">—</span>;

const STYLE: Record<PaymentDisplay, [string, string]> = {
  received: ["✓", "bg-success-600/10 text-success-700"],
  part_refunded: ["◐", "bg-accent-50 text-accent-600"],
  refunded: ["↩", "bg-warning-600/10 text-warning-700"],
  cancelled: ["○", "bg-neutral-100 text-neutral-700 line-through"],
};

// Filled pill: glyph + word + tint, as the invoice statuses.
export function PaymentStatus({ display }: { display: PaymentDisplay }) {
  const [glyph, cls] = STYLE[display];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-label", cls)}>
      <span aria-hidden>{glyph}</span>
      {DISPLAY_LABEL[display]}
    </span>
  );
}

// The first program, then how many more.
const programOf = (r: PaymentRow) => (r.programs[0] ? `${r.programs[0]}${r.programs.length > 1 ? ` +${r.programs.length - 1}` : ""}` : null);
// The invoices it paid, then the advance it left: "INV/26-27/0012 + ₹200 advance".
const towardsOf = (r: PaymentRow) => {
  const invoices = r.towards.map((t) => t.number ?? "Draft").join(", ");
  const advance = r.advancePaise > 0n ? `${invoices ? "+ " : ""}${formatPaise(r.advancePaise)} advance` : "";
  return [invoices, advance].filter(Boolean).join(" ") || null;
};
// When it was recorded, and the day it was received if that was another.
const whenOf = (r: PaymentRow, timeZone: string) => [timeIn(timeZone, r.createdAt), r.receivedOn !== r.recordedOn ? `received ${formatDate(r.receivedOn)}` : ""].filter(Boolean).join(" · ");

// A table from md up; cards below it, so a phone never scrolls sideways. A row opens the receipt.
export function PaymentTable({ rows, timeZone }: { rows: PaymentRow[]; timeZone: string }) {
  const head = "py-2.5 pr-4 font-medium";
  const link = "after:absolute after:inset-0";
  const struck = (r: PaymentRow) => (r.display === "cancelled" ? "text-muted-foreground line-through" : "");
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full">
          <thead>
            <tr className="bg-neutral-50 text-left text-caption text-muted-foreground">
              <th className="px-5 py-2.5 pr-4 font-medium">Date</th>
              <th className={head}>Receipt</th>
              <th className={head}>Student</th>
              <th className={head}>Program</th>
              <th className={head}>Towards</th>
              <th className={cn(head, "text-right")}>Amount</th>
              <th className={head}>Method</th>
              <th className={head}>Collected by</th>
              <th className="px-5 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="relative border-t border-neutral-100 align-top hover:bg-neutral-50">
                <td className="px-5 py-2.5 pr-4 whitespace-nowrap">
                  <span className="block text-body">{formatDate(r.recordedOn)}</span>
                  <span className="block text-caption text-muted-foreground">{whenOf(r, timeZone)}</span>
                </td>
                <td className="py-2.5 pr-4 whitespace-nowrap">
                  <Link href={`/finance/collections/${r.id}`} className={cn(link, "block text-body font-medium tabular-nums text-neutral-900", struck(r))}>
                    {r.receiptNumber}
                  </Link>
                </td>
                <td className="py-2.5 pr-4">
                  <span className="block text-body font-medium text-neutral-900">{r.students.join(", ") || dash}</span>
                  <span className="block text-caption text-muted-foreground">{r.billToName}</span>
                </td>
                <td className="py-2.5 pr-4 text-body">{programOf(r) ?? dash}</td>
                <td className="py-2.5 pr-4 text-body">{towardsOf(r) ?? dash}</td>
                <td className="py-2.5 pr-4 text-right text-body whitespace-nowrap">
                  <Money paise={r.amountPaise} className={struck(r)} />
                  {r.refundedPaise > 0n ? <span className="block text-caption text-muted-foreground">Refunded {formatPaise(r.refundedPaise)}</span> : null}
                </td>
                <td className="py-2.5 pr-4 whitespace-nowrap">
                  <span className="block text-body">{METHOD_LABEL[r.method]}</span>
                  {r.reference ? <span className="block text-caption text-muted-foreground">{r.reference}</span> : null}
                </td>
                <td className="py-2.5 pr-4 text-body whitespace-nowrap">{r.collectorName ?? "Online"}</td>
                <td className="px-5 py-2.5 whitespace-nowrap">
                  <PaymentStatus display={r.display} />
                  {r.display === "cancelled" && r.cancelReason ? <span className="block max-w-40 truncate text-caption text-danger-700">{r.cancelReason}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="relative flex flex-col gap-1.5 border-t border-neutral-100 px-4 py-3 first:border-t-0 active:bg-neutral-50">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/finance/collections/${r.id}`} className={cn(link, "min-w-0 truncate text-body font-medium tabular-nums", struck(r))}>
                {r.receiptNumber}
              </Link>
              <PaymentStatus display={r.display} />
            </div>
            <p className="truncate text-body">
              <span className="font-medium">{r.students.join(", ") || "—"}</span>
              <span className="text-muted-foreground"> · {r.billToName}</span>
            </p>
            <p className="truncate text-caption text-muted-foreground">{[programOf(r), METHOD_LABEL[r.method], r.collectorName ?? "Online"].filter(Boolean).join(" · ")}</p>
            {towardsOf(r) ? <p className="truncate text-caption text-muted-foreground">{towardsOf(r)}</p> : null}
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-caption text-muted-foreground">
                {formatDate(r.recordedOn)} · {whenOf(r, timeZone)}
              </span>
              <Money paise={r.amountPaise} className={cn("shrink-0 text-body font-medium", struck(r))} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
