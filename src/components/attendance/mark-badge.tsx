import { cn } from "@/lib/utils";
import type { Mark } from "@/modules/attendance/schema";

// Icon + word + tint for every mark; never colour alone (docs/07 §2).
export const MARK_STYLE: Record<Mark, { icon: string; word: string; cls: string }> = {
  present: { icon: "✓", word: "Present", cls: "bg-success-600/10 text-success-600" },
  absent: { icon: "✗", word: "Absent", cls: "bg-danger-600/10 text-danger-600" },
  late: { icon: "L", word: "Late", cls: "bg-warning-600/10 text-warning-600" },
  excused: { icon: "E", word: "Excused", cls: "bg-neutral-100 text-neutral-700" },
};

export function MarkBadge({ mark, className }: { mark: Mark | null; className?: string }) {
  if (!mark) return <span className={cn("inline-flex items-center justify-center rounded-full px-3 py-1 text-label text-muted-foreground", className)}>○ —</span>;
  const s = MARK_STYLE[mark];
  return (
    <span className={cn("inline-flex items-center justify-center gap-1 rounded-full px-3 py-1 text-label", s.cls, className)}>
      <span aria-hidden>{s.icon}</span> {s.word}
    </span>
  );
}
