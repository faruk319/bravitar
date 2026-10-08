import { cn } from "@/lib/utils";

// The number is the answer; the bar is a hint. No marks reads "No classes", never 0%.
export function AttendanceMeter({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">No classes</span>;
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
        <span className={cn("block h-full rounded-full", pct >= 80 ? "bg-success-600" : pct >= 60 ? "bg-warning-600" : "bg-danger-600")} style={{ width: `${pct}%` }} />
      </span>
      {pct}%
    </span>
  );
}
