import { addDays, timeIn, todayIn } from "@/lib/dates";
import { localToUtc } from "@/modules/sessions/occurrences";
import type { Category, TemplateKey } from "./templates";

// When automated messages go (agreed 2026-09-25), always in the academy's time.
// Nothing goes out from 21:00 to 07:00.
export const QUIET_FROM = 21;
export const QUIET_UNTIL = 7;

export const localHour = (now: Date, tz: string): number => Number(timeIn(tz, now).slice(0, 2));

const at = (date: string, hour: number, tz: string) => localToUtc(date, `${String(hour).padStart(2, "0")}:00`, tz);

// The first moment from `now` at or after `hour` and before the quiet hours.
export function sendTime(now: Date, tz: string, hour: number): Date {
  const h = localHour(now, tz);
  const today = todayIn(tz, now);
  if (h < hour) return at(today, hour, tz);
  return h < QUIET_FROM ? now : at(addDays(today, 1), hour, tz);
}

export const tomorrowAt = (now: Date, tz: string, hour: number): Date => at(addDays(todayIn(tz, now), 1), hour, tz);

export const dayStart = (now: Date, tz: string): Date => at(todayIn(tz, now), 0, tz);

// Fees at the academy's send hour, absences at its evening hour, receipts
// whenever the quiet hours allow.
export function hourFor(category: Category, t: { messageSendHour: number; absenceSendHour: number }): number {
  if (category === "attendance") return t.absenceSendHour;
  return category === "receipts" ? QUIET_UNTIL : t.messageSendHour;
}

// fee_due 3 days before the due date, fee_overdue 1 and 7 days after. Each
// stage keeps a few days to catch up after the worker was down; older
// invoices get no automated reminder.
export type FeeStage = { key: Extract<TemplateKey, "fee_due" | "fee_overdue">; stage: "due" | "1" | "7" };
export const FEE_WINDOW = { from: -13, to: 3 }; // due dates, in days from today

export function feeStage(dueDate: string, today: string): FeeStage | undefined {
  const late = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
  if (late >= -3 && late <= 0) return { key: "fee_due", stage: "due" };
  if (late >= 1 && late <= 6) return { key: "fee_overdue", stage: "1" };
  if (late >= 7 && late <= 13) return { key: "fee_overdue", stage: "7" };
  return undefined;
}
