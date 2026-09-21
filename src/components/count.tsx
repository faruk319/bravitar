import { formatCount } from "@/lib/money/format";
import { cn } from "@/lib/utils";

export function Count({ value, className }: { value: number | bigint; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatCount(value)}</span>;
}
