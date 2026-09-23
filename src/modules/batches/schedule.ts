import { addDays, weekdayOf } from "@/lib/dates";

// Pure rules for weekly timings, shared by the server and the week calendar.

export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const; // Monday first
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type Slot = { weekday: number; startTime: string; endTime: string };
export type Rule = Slot & { effectiveFrom: string; effectiveTo: string | null };

// "18:00", "18:00:00", "6:00" -> "HH:MM"; anything else is undefined.
export function normalizeTime(s: string): string | undefined {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export function minutes(t: string): number {
  const [h, m] = (normalizeTime(t) ?? "00:00").split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

// A class may cross midnight (end earlier than start = next day), but not run
// longer than this, which catches AM/PM slips like 6 AM – 5 AM.
const MAX_CLASS_MINUTES = 8 * 60;

export function durationMinutes(start: string, end: string): number {
  const d = minutes(end) - minutes(start);
  return d > 0 ? d : d + 24 * 60;
}

export function formatTime(t: string, withMeridiem = true): string {
  const total = minutes(t);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}${withMeridiem ? (h < 12 ? " AM" : " PM") : ""}`;
}

// "6:00 – 7:00 PM", "11:30 AM – 12:30 PM"
export function formatTimeRange(start: string, end: string): string {
  const sameHalf = minutes(start) < 720 === minutes(end) < 720;
  return `${formatTime(start, !sameHalf)} – ${formatTime(end)}`;
}

export function validateSlots(slots: Slot[]): string | undefined {
  if (!slots.length) return "Pick at least one day";
  const seen = new Set<number>();
  for (const s of slots) {
    if (!Number.isInteger(s.weekday) || s.weekday < 0 || s.weekday > 6) return "Unknown day";
    const day = WEEKDAY_SHORT[s.weekday];
    if (seen.has(s.weekday)) return `${day} is listed twice`;
    seen.add(s.weekday);
    const a = normalizeTime(s.startTime);
    const b = normalizeTime(s.endTime);
    if (!a || !b) return `${day}: enter a start and end time`;
    if (a === b) return `${day}: start and end are the same time`;
    const hours = Math.round(durationMinutes(a, b) / 60);
    if (durationMinutes(a, b) > MAX_CLASS_MINUTES) return `${day}: ${hours} hours is too long for one class. Check AM/PM.`;
  }
  return undefined;
}

// The single definition of "the timing on that day".
export function rulesOn<T extends { effectiveFrom: string; effectiveTo: string | null }>(rules: T[], date: string): T[] {
  return rules.filter((r) => r.effectiveFrom <= date && (r.effectiveTo === null || r.effectiveTo >= date));
}

// Monday first; days sharing a time are grouped: "Mon · Wed · Fri 6:00 – 7:00 PM".
export function summarizeSchedule(slots: Slot[]): string {
  if (!slots.length) return "No timing";
  const sorted = [...slots].sort((a, b) => WEEK_ORDER.indexOf(a.weekday as 0) - WEEK_ORDER.indexOf(b.weekday as 0));
  const groups: { days: number[]; range: string }[] = [];
  for (const s of sorted) {
    const range = formatTimeRange(s.startTime, s.endTime);
    const g = groups.find((x) => x.range === range);
    if (g) g.days.push(s.weekday);
    else groups.push({ days: [s.weekday], range });
  }
  return groups.map((g) => `${g.days.map((d) => WEEKDAY_SHORT[d]).join(" · ")} ${g.range}`).join(", ");
}

export type GridItem<K> = { key: K; branchId: string; rules: Rule[]; startDate: string; endDate: string | null };
export type GridHoliday = { date: string; name: string; branchId: string | null };
export type GridBlock<K> = { key: K; startTime: string; endTime: string; holiday?: string };
export type GridDay<K> = { date: string; weekday: number; holidays: string[]; blocks: GridBlock<K>[] };

// Seven days from weekStart, each with the classes that would run that day
// under the timing in force on that date. A holiday marks the block; the
// session generator is what actually skips it.
export function weekGrid<K>(items: GridItem<K>[], weekStart: string, holidays: GridHoliday[]): GridDay<K>[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const weekday = weekdayOf(date);
    const today = holidays.filter((h) => h.date === date);
    const blocks = items
      .filter((it) => date >= it.startDate && (it.endDate === null || date <= it.endDate))
      .flatMap((it) =>
        rulesOn(it.rules, date)
          .filter((r) => r.weekday === weekday)
          .map((r) => {
            const holiday = today.find((h) => h.branchId === null || h.branchId === it.branchId)?.name;
            return { key: it.key, startTime: normalizeTime(r.startTime) ?? r.startTime, endTime: normalizeTime(r.endTime) ?? r.endTime, ...(holiday ? { holiday } : {}) };
          }),
      )
      .sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
    return { date, weekday, holidays: [...new Set(today.map((h) => h.name))], blocks };
  });
}
