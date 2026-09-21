import { cn } from "@/lib/utils";
import type { StudentStatus } from "@/modules/students/schema";

const LABEL: Record<StudentStatus, string> = { active: "Active", paused: "Paused", left: "Left", prospect: "Prospect" };

// Word + colour, never colour alone (docs/07 §2).
export function StatusBadge({ status }: { status: StudentStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-label",
        status === "active" && "bg-neutral-50 text-success-600",
        status === "paused" && "bg-neutral-50 text-warning-600",
        status === "left" && "bg-neutral-50 text-neutral-500",
        status === "prospect" && "bg-neutral-50 text-neutral-700",
      )}
    >
      <span aria-hidden>{status === "active" ? "●" : status === "paused" ? "◐" : "○"}</span>
      {LABEL[status]}
    </span>
  );
}
