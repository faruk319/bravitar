import { cn } from "@/lib/utils";
import type { Invoice } from "@/modules/fees/schema";

const STYLE: Record<Invoice["status"], [string, string, string]> = {
  draft: ["Draft", "◌", "bg-neutral-100 text-neutral-700"],
  issued: ["Unpaid", "●", "bg-accent-50 text-accent-600"],
  part_paid: ["Part paid", "◐", "bg-warning-600/10 text-warning-600"],
  paid: ["Paid", "✓", "bg-success-600/10 text-success-600"],
  overdue: ["Overdue", "!", "bg-danger-600/10 text-danger-600"],
  void: ["Void", "○", "bg-neutral-100 text-neutral-500 line-through"],
};

// Filled pill: glyph + word + tint (docs/07 §2). Overdue is worked out by the caller.
export function InvoiceStatus({ status, overdue }: { status: Invoice["status"]; overdue?: boolean }) {
  const [word, glyph, cls] = STYLE[overdue ? "overdue" : status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-label", cls)}>
      <span aria-hidden>{glyph}</span>
      {word}
    </span>
  );
}
