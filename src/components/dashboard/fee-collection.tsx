import { Meter } from "@/components/reports/bars";
import { formatPaise } from "@/lib/money/format";

// Meter: collected against collected plus still owed.
export function FeeCollection({ collected, pending, overdue }: { collected: bigint; pending: bigint; overdue: bigint }) {
  const total = collected + pending + overdue;
  const fraction = total > 0n ? Number((collected * 1000n) / total) / 1000 : 0;
  const figures = [
    { label: "Collected", value: collected },
    { label: "Pending", value: pending },
    { label: "Overdue", value: overdue },
  ];
  return (
    <div>
      <Meter fraction={fraction} />
      <dl className="mt-4 grid grid-cols-3 gap-2">
        {figures.map((f) => (
          <div key={f.label}>
            <dt className="text-caption text-muted-foreground">{f.label}</dt>
            <dd className="text-number text-neutral-900">{formatPaise(f.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
