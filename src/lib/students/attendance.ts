import { attendancePercent } from "@/modules/attendance/percent";

export type ClassMark = { date: string; mark: "present" | "late" | "absent" | "excused" | null };
export type MonthTally = { present: number; late: number; absent: number; excused: number; unmarked: number };
export type MonthTrend = { month: string; classes: number; pct: number | null; tally: MonthTally };

const emptyTally = (): MonthTally => ({ present: 0, late: 0, absent: 0, excused: 0, unmarked: 0 });

export function tallyOf(classes: ClassMark[]): MonthTally {
  const t = emptyTally();
  for (const c of classes) t[c.mark ?? "unmarked"]++;
  return t;
}

export const tallyPct = (t: MonthTally): number | null => attendancePercent(t);

// "2026-10" minus n months.
export function monthBefore(month: string, n: number): string {
  const [y = 0, m = 1] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return d.toISOString().slice(0, 7);
}

// One row per month, oldest first. pct is null for a month with no classes or none marked; `classes` tells them apart.
export function monthTrend(classes: ClassMark[], lastMonth: string, months: number): MonthTrend[] {
  return Array.from({ length: months }, (_, i) => {
    const month = monthBefore(lastMonth, months - 1 - i);
    const tally = tallyOf(classes.filter((c) => c.date.startsWith(month)));
    const count = tally.present + tally.late + tally.absent + tally.excused + tally.unmarked;
    return { month, classes: count, pct: tallyPct(tally), tally };
  });
}

export type DayState = "present" | "late" | "absent" | "excused" | "unmarked" | "holiday" | "none";
export type DayCell = { date: string; day: number; state: DayState; holiday?: string };

// When a day has several classes the worst mark shows.
const WORST: DayState[] = ["absent", "late", "present", "excused", "unmarked"];

// Every day of the month. A class beats a holiday; a holiday is never an absence.
export function monthCells(month: string, lastDay: string, classes: ClassMark[], holidays: { date: string; name: string }[]): DayCell[] {
  return Array.from({ length: Number(lastDay.slice(8)) }, (_, i) => {
    const day = i + 1;
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const marks = classes.filter((c) => c.date === date).map((c): DayState => c.mark ?? "unmarked");
    const state = WORST.find((s) => marks.includes(s));
    if (state) return { date, day, state };
    const h = holidays.find((x) => x.date === date);
    return h ? { date, day, state: "holiday", holiday: h.name } : { date, day, state: "none" };
  });
}
