import { Eye, Phone } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { AttendanceMeter } from "@/components/students/attendance-meter";
import { FeeBadge } from "@/components/students/fee-badge";
import { StatusBadge } from "@/components/students/status-badge";
import { formatPhone } from "@/lib/phone";
import type { ListedStudent, StudentList } from "@/modules/students/service";

const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
const dash = <span className="text-muted-foreground">—</span>;
const act = "inline-flex size-11 items-center justify-center rounded-lg text-neutral-700 hover:bg-neutral-100";

function Actions({ row }: { row: ListedStudent }) {
  return (
    <span className="relative z-10 flex items-center justify-end">
      {row.guardianPhone ? (
        <a href={`tel:${row.guardianPhone}`} className={act} aria-label={`Call ${row.guardianName ?? "parent"} ${formatPhone(row.guardianPhone)}`}>
          <Phone className="size-5" aria-hidden />
        </a>
      ) : null}
      <Link href={`/students/${row.student.id}`} className={act} aria-label={`Open ${row.student.fullName}`}>
        <Eye className="size-5" aria-hidden />
      </Link>
    </span>
  );
}

// A table from md up; cards below it, so a phone never scrolls sideways.
export function StudentTable({ rows, shows }: { rows: ListedStudent[]; shows: StudentList["shows"] }) {
  const head = "py-2.5 font-medium";
  return (
    <>
      <table className="hidden w-full md:table">
        <thead>
          <tr className="bg-neutral-50 text-left text-caption text-muted-foreground">
            <th className="px-5 py-2.5 font-medium">Student</th>
            {shows.placements ? (
              <>
                <th className={head}>Program</th>
                <th className={head}>Batch</th>
                <th className={head}>Coach</th>
              </>
            ) : null}
            {shows.attendance ? <th className={head}>Attendance</th> : null}
            {shows.fee ? <th className={head}>Fee status</th> : null}
            <th className={head}>Status</th>
            <th className="px-5 py-2.5 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.student.id} className="border-t border-neutral-100 hover:bg-neutral-50">
              <td className="px-5 py-2.5">
                <Link href={`/students/${r.student.id}`} className="flex items-center gap-3">
                  <Avatar name={r.student.fullName} />
                  <span>
                    <span className="block text-body font-medium text-neutral-900 hover:underline">{r.student.fullName}</span>
                    <span className="block text-caption text-muted-foreground tabular-nums">{r.student.code}</span>
                  </span>
                </Link>
              </td>
              {r.placements ? (
                <>
                  <td className="py-2.5 text-body">{uniq(r.placements.map((p) => p.programName)).join(", ") || dash}</td>
                  <td className="py-2.5 text-body">{uniq(r.placements.map((p) => p.batchName)).join(", ") || dash}</td>
                  <td className="py-2.5 text-body">{uniq(r.placements.map((p) => p.coachName)).join(", ") || dash}</td>
                </>
              ) : null}
              {r.attendance ? (
                <td className="py-2.5 text-body">
                  <AttendanceMeter pct={r.attendance.pct} />
                </td>
              ) : null}
              {r.fee !== undefined ? (
                <td className="py-2.5">
                  <FeeBadge state={r.fee} />
                </td>
              ) : null}
              <td className="py-2.5">
                <StatusBadge status={r.student.status} />
              </td>
              <td className="px-3 py-1">
                <Actions row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="md:hidden">
        {rows.map((r) => {
          const place = r.placements ? uniq(r.placements.map((p) => p.batchName)).join(", ") : "";
          const coach = r.placements ? uniq(r.placements.map((p) => p.coachName)).join(", ") : "";
          return (
            <li key={r.student.id} className="relative flex flex-col gap-2 border-t border-neutral-100 px-4 py-3 first:border-t-0 active:bg-neutral-50">
              <div className="flex items-center gap-3">
                <Avatar name={r.student.fullName} />
                <div className="min-w-0 flex-1">
                  <Link href={`/students/${r.student.id}`} className="block truncate text-body font-medium after:absolute after:inset-0">
                    {r.student.fullName}
                  </Link>
                  <div className="truncate text-caption text-muted-foreground tabular-nums">{[r.student.code, place, coach].filter(Boolean).join(" · ")}</div>
                </div>
                <StatusBadge status={r.student.status} />
              </div>
              <div className="flex items-center justify-between gap-3 pl-[52px] text-caption">
                <span className="flex min-w-0 items-center gap-3">
                  {r.attendance ? <AttendanceMeter pct={r.attendance.pct} /> : null}
                  {r.fee !== undefined ? <FeeBadge state={r.fee} /> : null}
                </span>
                <Actions row={r} />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
