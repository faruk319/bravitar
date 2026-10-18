import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { formatDate, formatMonthYear, weekdayOf } from "@/lib/dates";
import { monthBefore } from "@/lib/students/attendance";
import type { DayState } from "@/lib/students/attendance";
import { cn } from "@/lib/utils";
import type { AttendanceCalendar as Calendar } from "@/modules/attendance/service";

// Every state has a glyph and a word; colour is a second signal. -600 fills are tints, text is -700.
export const DAY_STYLE: Record<DayState, { icon: string; word: string; cls: string }> = {
  present: { icon: "✓", word: "Present", cls: "bg-success-600/10 text-success-700" },
  late: { icon: "L", word: "Late", cls: "bg-warning-600/10 text-warning-700" },
  absent: { icon: "✗", word: "Absent", cls: "bg-danger-600/10 text-danger-700" },
  excused: { icon: "E", word: "Excused", cls: "bg-neutral-100 text-neutral-700" },
  unmarked: { icon: "○", word: "Not marked", cls: "bg-neutral-100 text-neutral-700" },
  holiday: { icon: "H", word: "Holiday", cls: "border border-dashed border-neutral-300 text-neutral-700" },
  none: { icon: "", word: "No class", cls: "text-neutral-500" },
};
const LEGEND: DayState[] = ["holiday", "none"]; // the tiles below name the rest
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const step = "flex size-11 items-center justify-center rounded-lg";

export function AttendanceCalendar({ calendar, href }: { calendar: Calendar; href: (month: string) => string }) {
  const { month, cells, tally, today } = calendar;
  const lead = (weekdayOf(`${month}-01`) + 6) % 7; // Monday first
  const prev = monthBefore(month, 1);
  const next = monthBefore(month, -1);
  const canNext = next <= today.slice(0, 7);
  const holidays = cells.filter((c) => c.state === "holiday");
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Link href={href(prev)} aria-label="Previous month" className={cn(step, "hover:bg-neutral-100")}>
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <h2 className="text-heading">{formatMonthYear(`${month}-01`)}</h2>
        {canNext ? (
          <Link href={href(next)} aria-label="Next month" className={cn(step, "hover:bg-neutral-100")}>
            <ChevronRight className="size-5" aria-hidden />
          </Link>
        ) : (
          <span aria-hidden className={step} />
        )}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEK.map((d) => (
          <span key={d} className="pb-1 text-caption text-muted-foreground">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} aria-hidden />
        ))}
        {cells.map((c) => {
          const s = DAY_STYLE[c.state];
          return (
            <div
              key={c.date}
              role="img"
              aria-label={`${formatDate(c.date)}, ${c.holiday ?? s.word}`}
              {...(c.date === today ? { "aria-current": "date" as const } : {})}
              className={cn("flex min-h-11 flex-col items-center justify-center rounded-lg text-caption tabular-nums", s.cls, c.date === today && "ring-2 ring-accent-600")}
            >
              <span>{c.day}</span>
              <span aria-hidden className="text-label leading-none">
                {s.icon || " "}
              </span>
            </div>
          );
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
        {LEGEND.map((k) => (
          <li key={k}>
            <span aria-hidden>{DAY_STYLE[k].icon || "·"}</span> {DAY_STYLE[k].word}
          </li>
        ))}
      </ul>
      {holidays.length ? (
        <ul className="mt-3 text-caption text-muted-foreground">
          {holidays.map((h) => (
            <li key={h.date}>
              {h.holiday} · {formatDate(h.date)}
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["present", "late", "absent", "unmarked"] as const).map((k) => (
          <div key={k} className={cn("rounded-xl px-3 py-2", DAY_STYLE[k].cls)}>
            <dt className="text-label">
              <span aria-hidden>{DAY_STYLE[k].icon}</span> {DAY_STYLE[k].word}
            </dt>
            <dd className="text-display tabular-nums">{tally[k]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
