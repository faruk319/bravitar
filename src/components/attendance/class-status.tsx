import type { ClassCard } from "@/modules/attendance/service";

// "● Not marked", "◐ Marked 12/30", "✓ Marked 30/30" or "Cancelled · Holiday".
export function ClassStatus({ c }: { c: ClassCard }) {
  if (c.session.status === "cancelled") return <span className="text-muted-foreground">Cancelled · {c.session.cancelReason}</span>;
  if (!c.marked) return <span className="text-warning-700">● Not marked</span>;
  const done = c.marked >= c.students;
  return (
    <span className={done ? "text-success-700" : "text-warning-700"}>
      {done ? "✓" : "◐"} Marked {c.marked}/{c.students}
    </span>
  );
}
