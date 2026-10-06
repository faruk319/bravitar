import Link from "next/link";
import { ClassStatus } from "@/components/attendance/class-status";
import { timeIn } from "@/lib/dates";
import { formatTimeRange } from "@/modules/batches/schedule";
import type { ClassCard } from "@/modules/attendance/service";

export function TodaysSchedule({ classes, timeZone }: { classes: ClassCard[]; timeZone: string }) {
  if (!classes.length) return <p className="text-body text-muted-foreground">No classes today.</p>;
  return (
    <ul className="divide-y divide-neutral-100">
      {classes.map((c) => (
        <li key={c.session.id}>
          <Link href={`/sessions/${c.session.id}`} className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-2 hover:bg-neutral-50">
            <span className="min-w-0">
              <span className="block text-body font-medium text-neutral-900">{c.batchName}</span>
              <span className="block text-caption text-muted-foreground">
                {formatTimeRange(timeIn(timeZone, c.session.startsAt), timeIn(timeZone, c.session.endsAt))}
                {c.coachName ? ` · ${c.coachName}` : ""}
              </span>
            </span>
            <span className="flex items-center gap-3 text-label">
              <span className="tabular-nums">{c.capacity === null ? c.students : `${c.students}/${c.capacity}`}</span>
              <ClassStatus c={c} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
