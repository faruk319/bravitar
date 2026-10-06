import { ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Count } from "@/components/count";
import { cn } from "@/lib/utils";

// docs/07 §6: every number links to the list behind it.
export function StatCard({ label, value, icon: Icon, href, note, trend }: { label: string; value: number | string; icon: LucideIcon; href: string; note?: string; trend?: number | null | undefined }) {
  const hasTrend = trend !== null && trend !== undefined;
  return (
    <Link href={href} className="flex flex-col gap-2 rounded-2xl border border-neutral-100 bg-card p-4 shadow-card hover:border-neutral-300 md:p-5">
      <span className="flex items-center justify-between gap-2 text-label text-neutral-700">
        {label}
        <span className="inline-flex size-9 items-center justify-center rounded-full bg-accent-50 text-accent-600">
          <Icon className="size-5" aria-hidden />
        </span>
      </span>
      <span className="text-display text-neutral-900">
        {typeof value === "number" ? <Count value={value} /> : value}
      </span>
      {note || hasTrend ? (
        <span className="flex items-center gap-2 text-caption">
          {hasTrend ? (
            // The arrow carries the direction; colour alone never does.
            <span className={cn("inline-flex items-center gap-0.5 tabular-nums", trend < 0 ? "text-danger-700" : "text-success-700")}>
              {trend < 0 ? <ArrowDown className="size-3.5" aria-hidden /> : <ArrowUp className="size-3.5" aria-hidden />}
              {trend < 0 ? "" : "+"}
              {trend}%
            </span>
          ) : null}
          {note ? <span className="text-muted-foreground">{note}</span> : null}
        </span>
      ) : null}
    </Link>
  );
}
