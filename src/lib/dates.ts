const dmy = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(`${iso.length === 10 ? `${iso}T00:00:00Z` : iso}`) : iso;
  return Number.isNaN(d.getTime()) ? "—" : dmy.format(d);
}

const dm = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const my = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
// "2026-09-03" -> "3 Sept" / "Sept 2026", for chart ticks.
export const formatDayMonth = (iso: string): string => dm.format(new Date(`${iso}T00:00:00Z`));
export const formatMonthYear = (iso: string): string => my.format(new Date(`${iso}T00:00:00Z`));

export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
}

export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The given day, some months on, or that month's last day when it's shorter:
// ("2026-01-31", 1, 31) -> "2026-02-28", then ("2026-02-28", 1, 31) -> "2026-03-31".
export function monthsLaterOn(iso: string, months: number, day: number): string {
  const [y = 0, m = 1] = iso.split("-").map(Number);
  const month = m - 1 + months;
  const last = new Date(Date.UTC(y, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, month, Math.min(day, last))).toISOString().slice(0, 10);
}

// "2026-02" -> "2026-02-28"
export function monthEnd(month: string): string {
  const [y = 0, m = 1] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export function startOfWeek(iso: string): string {
  const wd = weekdayOf(iso);
  return addDays(iso, wd === 0 ? -6 : 1 - wd);
}

export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function timeIn(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}
