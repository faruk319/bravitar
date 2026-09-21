import { formatPaise } from "@/lib/money/format";
import { cn } from "@/lib/utils";

// The one component that renders money. Right-aligned in tables, left in cards.
export function Money({ paise, showPaise, className }: { paise: bigint; showPaise?: boolean; className?: string }) {
  return (
    <span className={cn("tabular-nums", className)}>{formatPaise(paise, showPaise === undefined ? {} : { showPaise })}</span>
  );
}
