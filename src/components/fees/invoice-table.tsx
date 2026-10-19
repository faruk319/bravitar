import Link from "next/link";
import { InvoiceStatus } from "@/components/fees/invoice-status";
import { Money } from "@/components/money";
import { formatDate, periodLabel } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { InvoiceRow } from "@/modules/fees/repo";

const dash = <span className="text-muted-foreground">—</span>;

// The first program, then how many more.
const programOf = (r: InvoiceRow) => (r.programs[0] ? `${r.programs[0]}${r.programs.length > 1 ? ` +${r.programs.length - 1}` : ""}` : null);
// An installment says where it sits in its plan; anything else, the months it covers.
const periodOf = (r: InvoiceRow) => (r.installment && r.installment.of > 1 ? `Installment ${r.installment.n} of ${r.installment.of}` : periodLabel(r.periodStart, r.periodEnd));
// Nothing is owed on a draft or a cancelled invoice.
const balanceOf = (r: InvoiceRow) => (r.display === "draft" || r.display === "cancelled" ? null : r.totalPaise - r.paidPaise);

// A table from md up; cards below it, so a phone never scrolls sideways. A row opens the invoice.
export function InvoiceTable({ rows }: { rows: InvoiceRow[] }) {
  const head = "py-2.5 pr-4 font-medium";
  const link = "after:absolute after:inset-0";
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full">
          <thead>
            <tr className="bg-neutral-50 text-left text-caption text-muted-foreground">
              <th className="px-5 py-2.5 pr-4 font-medium">Invoice</th>
              <th className={head}>Student</th>
              <th className={head}>Program</th>
              <th className={head}>Period</th>
              <th className={cn(head, "text-right")}>Total</th>
              <th className={cn(head, "text-right")}>Paid</th>
              <th className={cn(head, "text-right")}>Balance</th>
              <th className={head}>Due date</th>
              <th className="px-5 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const balance = balanceOf(r);
              return (
                <tr key={r.id} className="relative border-t border-neutral-100 align-top hover:bg-neutral-50">
                  <td className="px-5 py-2.5 pr-4 whitespace-nowrap">
                    <Link href={`/finance/invoices/${r.id}`} className={cn(link, "block text-body font-medium tabular-nums text-neutral-900")}>
                      {r.number ?? "Draft"}
                    </Link>
                    <span className="block text-caption text-muted-foreground">{formatDate(r.issueDate)}</span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="block text-body font-medium text-neutral-900">{r.students.join(", ") || dash}</span>
                    <span className="block text-caption text-muted-foreground">{r.billToName}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-body">{programOf(r) ?? dash}</td>
                  <td className="py-2.5 pr-4 text-body">{periodOf(r) ?? dash}</td>
                  <td className="py-2.5 pr-4 text-right text-body whitespace-nowrap">
                    <Money paise={r.totalPaise} />
                  </td>
                  <td className="py-2.5 pr-4 text-right text-body whitespace-nowrap">{r.paidPaise > 0n ? <Money paise={r.paidPaise} /> : dash}</td>
                  <td className="py-2.5 pr-4 text-right text-body whitespace-nowrap">{balance === null ? dash : <Money paise={balance} className={cn(balance > 0n && "font-medium")} />}</td>
                  <td className="py-2.5 pr-4 text-body whitespace-nowrap">{formatDate(r.dueDate)}</td>
                  <td className="px-5 py-2.5 whitespace-nowrap">
                    <InvoiceStatus status={r.display} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden">
        {rows.map((r) => {
          const balance = balanceOf(r);
          return (
            <li key={r.id} className="relative flex flex-col gap-1.5 border-t border-neutral-100 px-4 py-3 first:border-t-0 active:bg-neutral-50">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/finance/invoices/${r.id}`} className={cn(link, "min-w-0 truncate text-body font-medium tabular-nums")}>
                  {r.number ?? "Draft"}
                </Link>
                <InvoiceStatus status={r.display} />
              </div>
              <p className="truncate text-body">
                <span className="font-medium">{r.students.join(", ") || "—"}</span>
                <span className="text-muted-foreground"> · {r.billToName}</span>
              </p>
              <p className="truncate text-caption text-muted-foreground">{[programOf(r), periodOf(r)].filter(Boolean).join(" · ") || "—"}</p>
              <p className="truncate text-caption text-muted-foreground">
                {r.display === "draft" ? "Planned for" : "Issued"} {formatDate(r.issueDate)} · Due {formatDate(r.dueDate)}
              </p>
              <dl className="mt-1 grid grid-cols-3 gap-2 text-caption">
                {(
                  [
                    ["Total", <Money key="t" paise={r.totalPaise} />],
                    ["Paid", r.paidPaise > 0n ? <Money key="p" paise={r.paidPaise} /> : dash],
                    ["Balance", balance === null ? dash : <Money key="b" paise={balance} className={cn(balance > 0n && "font-medium")} />],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="truncate text-body tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
}
