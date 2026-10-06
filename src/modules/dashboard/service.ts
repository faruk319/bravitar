import { allows } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import type { Tx } from "@/lib/db/client";
import { addDays, todayIn } from "@/lib/dates";
import { type Paise, sum } from "@/lib/money/paise";
import { marksFor } from "@/modules/attendance/repo";
import { type ClassCard, todaysClasses } from "@/modules/attendance/service";
import { type EnquiryRow, type Funnel, funnel, statusCounts } from "@/modules/enquiries/repo";
import { myFollowUps } from "@/modules/enquiries/service";
import { addMonths } from "@/modules/fees/billing";
import { owedSummary } from "@/modules/fees/repo";
import { collectedByDay, collectedByMonth } from "@/modules/payments/repo";
import { atRisk } from "@/modules/reports/service";
import { localToUtc } from "@/modules/sessions/occurrences";
import { countByStatus, countJoinedSince, countWithoutBatch } from "@/modules/students/repo";
import { getOwnTenant } from "@/modules/tenancy/repo";

type Collected = { count: number; total: Paise };

// docs/06 Prompt 19: exactly four blocks. Each is there only if the viewer may
// see some of it, and each number only if they may see the list behind it.
export type Dashboard = {
  date: string;
  roll?: { active: number; joinedThisMonth: number; waitingForBatch: number };
  today?: {
    timeZone: string;
    classes: ClassCard[];
    held: number;
    marked: number;
    notMarked: number;
    present?: { here: number; marked: number };
    attendance?: { present: number; absent: number; notMarked: number };
    nearCapacity: number;
  };
  money?: {
    collectedToday?: Collected;
    thisMonth?: Collected;
    last30?: { from: string; to: string; byDay: { key: string; count: number; totalPaise: Paise }[] };
    byMonth?: { month: string; count: number; totalPaise: Paise }[];
    trendPct?: number | null;
    owed?: { invoices: number; owedPaise: Paise; overdueFamilies: number };
    overduePaise?: Paise;
    dueTomorrow?: number;
    admissions?: number;
  };
  atRisk?: { attendance: number | null; unpaid: number | null };
  pipeline?: { followUps: number; month: Funnel; mine: EnquiryRow[] };
};

export async function dashboardData(tx: Tx, ctx: ScopedCtx, opts: { now?: Date } = {}): Promise<Dashboard> {
  const now = opts.now ?? new Date();
  const tz = (await getOwnTenant(tx))?.timezone ?? "Asia/Kolkata";
  const today = todayIn(tz, now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const out: Dashboard = { date: today };

  if (allows(ctx, "sessions:read")) {
    const t = await todaysClasses(tx, ctx, { now });
    const held = t.classes.filter((c) => c.session.status !== "cancelled");
    out.today = {
      timeZone: t.timeZone,
      classes: t.classes,
      held: held.length,
      marked: held.filter((c) => c.marked > 0).length,
      notMarked: held.filter((c) => c.marked === 0 && c.session.startsAt <= now).length,
      // Only batches that declare a capacity can be near it.
      nearCapacity: t.classes.filter((c) => c.capacity !== null && c.capacity > 0 && c.students / c.capacity >= 0.9).length,
    };
    if (allows(ctx, "attendance:read")) {
      const marks = await marksFor(tx, t.classes.map((c) => c.session.id));
      out.today.present = { here: marks.filter((m) => m.status === "present" || m.status === "late").length, marked: marks.length };
      const roster = t.classes.reduce((n, c) => n + c.students, 0);
      out.today.attendance = {
        present: marks.filter((m) => m.status === "present" || m.status === "late").length,
        absent: marks.filter((m) => m.status === "absent").length,
        notMarked: Math.max(0, roster - marks.length),
      };
    }
  }

  if (allows(ctx, "students:read")) {
    const byStatus = await countByStatus(tx, { branchIds: ctx.branchIds });
    out.roll = {
      active: byStatus.active,
      joinedThisMonth: await countJoinedSince(tx, { branchIds: ctx.branchIds }, monthStart),
      waitingForBatch: await countWithoutBatch(tx, { branchIds: ctx.branchIds }),
    };
  }

  if (allows(ctx, "payments:read") || allows(ctx, "invoices:read")) {
    const money: NonNullable<Dashboard["money"]> = {};
    if (allows(ctx, "payments:read")) {
      // Counted by the day recorded, as the collection sheet is (docs/03 §9).
      const from = addDays(today, -29);
      const days = await collectedByDay(tx, ctx.branchIds, from < monthStart ? from : monthStart, today);
      const total = (xs: typeof days): Collected => ({ count: xs.reduce((n, d) => n + d.count, 0), total: sum(xs.map((d) => d.total)) });
      money.collectedToday = total(days.filter((d) => d.day === today));
      money.thisMonth = total(days.filter((d) => d.day >= monthStart));
      money.last30 = { from, to: today, byDay: days.filter((d) => d.day >= from).map((d) => ({ key: d.day, count: d.count, totalPaise: d.total })) };
      // Eight months for the revenue chart; last month feeds the trend.
      const months = await collectedByMonth(tx, ctx.branchIds, addMonths(monthStart, -7), today);
      money.byMonth = months.map((m) => ({ month: m.month, count: m.count, totalPaise: m.total }));
      const last = months.find((m) => m.month === addMonths(monthStart, -1).slice(0, 7))?.total ?? 0n;
      // Percent to one decimal; the bigint difference is only narrowed after dividing down.
      money.trendPct = last === 0n ? null : Number(((money.thisMonth.total - last) * 1000n) / last) / 10;
    }
    if (allows(ctx, "invoices:read")) {
      const owed = await owedSummary(tx, ctx.branchIds, today);
      money.owed = { invoices: owed.invoices, owedPaise: owed.owedPaise, overdueFamilies: owed.overdueFamilies };
      money.overduePaise = owed.overduePaise;
      money.dueTomorrow = owed.dueTomorrow;
    }
    if (allows(ctx, "students:read")) money.admissions = await countJoinedSince(tx, { branchIds: ctx.branchIds }, monthStart);
    out.money = money;
  }

  if (allows(ctx, "students:read") && (allows(ctx, "attendance:read") || allows(ctx, "invoices:read"))) {
    const r = await atRisk(tx, ctx);
    out.atRisk = { attendance: r.attendance?.length ?? null, unpaid: r.unpaid?.length ?? null };
  }

  // docs/03 §4: a follow-up due today shows on the assigned person's dashboard.
  if (allows(ctx, "enquiries:read")) {
    const [start, end] = [localToUtc(monthStart, "00:00", tz), localToUtc(addDays(today, 1), "00:00", tz)];
    out.pipeline = { followUps: (await statusCounts(tx, ctx.branchIds, today)).follow_ups, month: await funnel(tx, ctx.branchIds, start, end), mine: await myFollowUps(tx, ctx) };
  }
  return out;
}
