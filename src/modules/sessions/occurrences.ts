import { addDays, todayIn, weekdayOf } from "@/lib/dates";
import { durationMinutes, type Rule, rulesOn } from "@/modules/batches/schedule";

// Wall-clock times in a tenant's timezone -> UTC instants, using Intl only.
// The process timezone is never consulted.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(timeZone, f);
  }
  return f;
}

// Offset in minutes (local minus UTC) of `timeZone` at instant `at`.
export function tzOffsetMinutes(at: Date, timeZone: string): number {
  const parts = formatter(timeZone).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((local - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

// A wall-clock time on a local date. In a DST gap (the time doesn't exist) it
// moves forward past the jump; in an overlap (it happens twice) it takes the
// first one — the usual "compatible" rule.
export function localToUtc(date: string, time: string, timeZone: string): Date {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const [hh = 0, mm = 0] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const before = tzOffsetMinutes(new Date(wall - 12 * 3600_000), timeZone);
  const after = tzOffsetMinutes(new Date(wall + 12 * 3600_000), timeZone);
  const fits = (offset: number) => {
    const t = wall - offset * 60_000;
    return tzOffsetMinutes(new Date(t), timeZone) === offset ? t : undefined;
  };
  const candidates = [fits(before), fits(after)].filter((t): t is number => t !== undefined);
  return new Date(candidates.length ? Math.min(...candidates) : wall - before * 60_000);
}

export const HORIZON_DAYS = 60;

export type PlanBatch = { id: string; branchId: string; startDate: string; endDate: string | null; status: string; rules: Rule[] };
type PlanHoliday = { date: string; branchId: string | null; name: string };
export type Occurrence = { batchId: string; branchId: string; sessionDate: string; startsAt: Date; endsAt: Date; holiday?: string };

// Every class that should exist after `now`, through local today + `days`.
// Holiday dates are marked rather than dropped so the caller can cancel rows
// that already exist; new rows are not created for them.
export function planOccurrences(input: { batches: PlanBatch[]; holidays: PlanHoliday[]; timeZone: string; now: Date; days?: number }): Occurrence[] {
  const { batches, holidays, timeZone, now } = input;
  const today = todayIn(timeZone, now);
  const last = addDays(today, input.days ?? HORIZON_DAYS);
  const out: Occurrence[] = [];
  for (const b of batches) {
    if (b.status === "paused") continue;
    const first = b.startDate > today ? b.startDate : today;
    const final = b.endDate && b.endDate < last ? b.endDate : last;
    for (let date = first; date <= final; date = addDays(date, 1)) {
      const weekday = weekdayOf(date);
      for (const r of rulesOn(b.rules, date)) {
        if (r.weekday !== weekday) continue;
        const startsAt = localToUtc(date, r.startTime, timeZone);
        if (startsAt.getTime() <= now.getTime()) continue;
        // A class always lasts its scheduled length: covers past-midnight ends and DST nights alike.
        const endsAt = new Date(startsAt.getTime() + durationMinutes(r.startTime, r.endTime) * 60_000);
        const holiday = holidays.find((h) => h.date === date && (h.branchId === null || h.branchId === b.branchId));
        out.push({ batchId: b.id, branchId: b.branchId, sessionDate: date, startsAt, endsAt, ...(holiday ? { holiday: holiday.name } : {}) });
      }
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
