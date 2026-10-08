import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FeeState } from "@/modules/students/repo";

const LOOK = {
  paid: { label: "Paid", Icon: CheckCircle2, tone: "bg-success-600/10 text-success-700" },
  due: { label: "Due", Icon: Clock, tone: "bg-warning-600/10 text-warning-700" },
  overdue: { label: "Overdue", Icon: AlertTriangle, tone: "bg-danger-600/10 text-danger-700" },
} as const;

// Icon + word + tint, never colour alone; null = nothing billed yet.
export function FeeBadge({ state }: { state: FeeState | null }) {
  if (!state) return <span className="text-muted-foreground">—</span>;
  const { label, Icon, tone } = LOOK[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-label", tone)}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}
