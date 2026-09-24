import Link from "next/link";
import { formatDate } from "@/lib/dates";

export type DueItem = { invoiceId: string; enrollmentId: string | null; description: string; number: string | null; dueDate: string; amount: string; voidable: boolean };

// Installments aren't voided on leave (docs/03 §6); staff may void each by hand.
export function StillDue({ items }: { items: DueItem[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl bg-warning-600/10 px-3 py-2">
      <p className="text-label text-warning-600">Still due after leaving</p>
      <ul className="divide-y divide-warning-600/10">
        {items.map((i) => (
          <li key={i.invoiceId} className="flex min-h-12 items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate text-body">{i.description}</span>
              <span className="block text-caption text-muted-foreground tabular-nums">
                {i.number ?? "Draft"} · due {formatDate(i.dueDate)} · {i.amount}
              </span>
            </span>
            {i.voidable ? (
              <Link href={`/invoices/${i.invoiceId}?void=1`} className="shrink-0 text-label text-danger-600 hover:underline">
                Void
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
