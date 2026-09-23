import { cn } from "@/lib/utils";
import type { StudentStatus } from "@/modules/students/schema";

const LABEL: Record<StudentStatus, string> = { active: "Active", paused: "Paused", left: "Left", prospect: "Prospect" };

// Filled pill: icon + word + tint, never colour alone (docs/07 §2).
export function StatusBadge({ status }: { status: StudentStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-label",
        status === "active" && "bg-success-600/10 text-success-600",
        status === "paused" && "bg-warning-600/10 text-warning-600",
        status === "left" && "bg-neutral-100 text-neutral-500",
        status === "prospect" && "bg-accent-50 text-accent-600",
      )}
    >
      <span aria-hidden>{status === "active" ? "●" : status === "paused" ? "◐" : "○"}</span>
      {LABEL[status]}
    </span>
  );
}
