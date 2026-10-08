import { allows, assertCan } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { addDays, todayIn } from "@/lib/dates";
import type { Tx } from "@/lib/db/client";
import { marksByBatch } from "@/modules/attendance/repo";
import { attendancePercent } from "@/modules/attendance/percent";
import { addMonths } from "@/modules/fees/billing";
import { getOwnTenant } from "@/modules/tenancy/repo";
import { joinedBetween, leftBetween } from "./repo";

export const ENROLMENT_MONTHS = 12;
export const ATTENDANCE_MONTHS = 6;

export type EnrolmentMonth = { month: string; joined: number; left: number };
export type AttendanceMonth = { month: string; classes: number; percent: number | null };
export type StudentTrends = {
  enrolment: { months: EnrolmentMonth[]; joined: number; left: number; net: number };
  // Absent without attendance:read.
  attendance?: { months: AttendanceMonth[]; percent: number | null };
};

// The listing's two chart cards: the student body over time, not today (that is the dashboard's).
export async function studentTrends(tx: Tx, ctx: ScopedCtx, opts: { now?: Date } = {}): Promise<StudentTrends> {
  assertCan(ctx, "students:read");
  const today = todayIn((await getOwnTenant(tx))?.timezone ?? "Asia/Kolkata", opts.now);
  const thisMonth = `${today.slice(0, 7)}-01`;
  const monthsBack = (n: number) => Array.from({ length: n }, (_, i) => addMonths(thisMonth, i - (n - 1)).slice(0, 7));

  const scope = { branchIds: ctx.branchIds };
  const first = `${monthsBack(ENROLMENT_MONTHS)[0]}-01`;
  const [joined, left] = [await joinedBetween(tx, scope, first, today), await leftBetween(tx, scope, first, today)];
  const months = monthsBack(ENROLMENT_MONTHS).map((month) => ({
    month,
    joined: joined.filter((m) => m.on.startsWith(month)).length,
    left: left.filter((m) => m.on.startsWith(month)).length,
  }));
  const [j, l] = [joined.length, left.length];
  const out: StudentTrends = { enrolment: { months, joined: j, left: l, net: j - l } };

  if (allows(ctx, "attendance:read")) {
    const total = { present: 0, late: 0, absent: 0 };
    const attended: AttendanceMonth[] = [];
    for (const month of monthsBack(ATTENDANCE_MONTHS)) {
      const to = month === today.slice(0, 7) ? today : addDays(addMonths(`${month}-01`, 1), -1);
      const batches = await marksByBatch(tx, ctx.branchIds, `${month}-01`, to);
      const c = { present: 0, late: 0, absent: 0 };
      for (const b of batches) [c.present, c.late, c.absent] = [c.present + b.present, c.late + b.late, c.absent + b.absent];
      total.present += c.present;
      total.late += c.late;
      total.absent += c.absent;
      // Marks are the evidence a class was held; none, no percentage.
      attended.push({ month, classes: batches.reduce((n, b) => n + b.classes, 0), percent: attendancePercent(c) });
    }
    out.attendance = { months: attended, percent: attendancePercent(total) };
  }
  return out;
}
