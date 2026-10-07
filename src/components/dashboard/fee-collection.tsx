import { formatPaise } from "@/lib/money/format";

// Collected is this month's receipts; pending and overdue are outstanding to date.
export function FeeCollection({ collected, pending, overdue }: { collected: bigint; pending: bigint; overdue: bigint }) {
  const figures = [
    { label: "Collected this month", value: collected },
    { label: "Pending to date", value: pending },
    { label: "Overdue to date", value: overdue },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2">
      {figures.map((f) => (
        <div key={f.label}>
          <dt className="text-caption text-muted-foreground">{f.label}</dt>
          <dd className="text-number text-neutral-900">{formatPaise(f.value)}</dd>
        </div>
      ))}
    </dl>
  );
}
