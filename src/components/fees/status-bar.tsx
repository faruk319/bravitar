import { formatPaise } from "@/lib/money/format";
import type { StatusMix } from "@/modules/reports/service";

// Invoices by status, by amount. The bar is decorative; the legend is the text.
const ROWS = [
  { key: "paid", label: "Paid", fill: "bg-success-600" },
  { key: "part_paid", label: "Part paid", fill: "bg-accent-600" },
  { key: "due", label: "Due", fill: "bg-warning-600" },
  { key: "overdue", label: "Overdue", fill: "bg-danger-600" },
] as const;

export function StatusBar({ mix }: { mix: StatusMix }) {
  const total = ROWS.reduce((n, r) => n + mix[r.key], 0n);
  if (total === 0n) return <p className="text-body text-muted-foreground">No invoices issued this month.</p>;
  return (
    <div>
      <div aria-hidden="true" className="flex h-3 gap-0.5 overflow-hidden rounded-full">
        {ROWS.filter((r) => mix[r.key] > 0n).map((r) => (
          <div key={r.key} className={r.fill} style={{ width: `${(Number((mix[r.key] * 10_000n) / total) / 100).toFixed(2)}%` }} />
        ))}
      </div>
      <ul className="mt-3">
        {ROWS.map((r) => (
          <li key={r.key} className="flex min-h-10 items-center gap-2 text-body">
            <span className={`size-2.5 shrink-0 rounded-full ${r.fill}`} aria-hidden />
            <span className="min-w-0 truncate text-muted-foreground">{r.label}</span>
            <span className="ml-auto tabular-nums text-neutral-900">{formatPaise(mix[r.key])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
