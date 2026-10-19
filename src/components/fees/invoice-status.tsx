import { cn } from "@/lib/utils";
import type { DisplayStatus } from "@/modules/fees/billing";

export const STATUS_WORD: Record<DisplayStatus, string> = { draft: "Draft", due: "Due", part_paid: "Part paid", overdue: "Overdue", paid: "Paid", cancelled: "Cancelled" };

const STYLE: Record<DisplayStatus, [string, string]> = {
  draft: ["◌", "bg-neutral-100 text-neutral-700"],
  due: ["●", "bg-warning-600/10 text-warning-700"],
  part_paid: ["◐", "bg-accent-50 text-accent-600"],
  overdue: ["!", "bg-danger-600/10 text-danger-700"],
  paid: ["✓", "bg-success-600/10 text-success-700"],
  cancelled: ["○", "bg-neutral-100 text-neutral-700 line-through"],
};

// Filled pill: glyph + word + tint (docs/07 §2). `label` swaps the word, for a Bravitar bill that is "Void".
export function InvoiceStatus({ status, label }: { status: DisplayStatus; label?: string }) {
  const [glyph, cls] = STYLE[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-label", cls)}>
      <span aria-hidden>{glyph}</span>
      {label ?? STATUS_WORD[status]}
    </span>
  );
}
