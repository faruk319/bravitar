import { allows } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import type { Tx } from "@/lib/db/client";
import { addDays, todayIn } from "@/lib/dates";
import { type Paise, sum } from "@/lib/money/paise";
import { marksFor } from "@/modules/attendance/repo";
import { type ClassCard, todaysClasses } from "@/modules/attendance/service";
import { type EnquiryRow, type Funnel, funnel, statusCounts } from "@/modules/enquiries/repo";
import { myFollowUps } from "@/modules/enquiries/service";
import { owedSummary } from "@/modules/fees/repo";
import { collectedByDay } from "@/modules/payments/repo";
import { atRisk } from "@/modules/reports/service";
import { localToUtc } from "@/modules/sessions/occurrences";
import { countJoinedSince } from "@/modules/students/repo";
import { getOwnTenant } from "@/modules/tenancy/repo";

type Collected = { count: number; total: Paise };

// docs/06 Prompt 19: exactly four blocks. Each is there only if the viewer may
// see some of it, and each number only if they may see the list behind it.
export type Dashboard = {
  date: string;
  today?: { timeZone: string; classes: ClassCard[]; held: number; marked: number; notMarked: number; present?: { here: number; marked: number } };
  money?: {
    collectedToday?: Collected;
    thisMonth?: Collected;
    last30?: { from: string; to: string; byDay: { key: string; count: number; totalPaise: Paise }[] };
    owed?: { invoices: number; owedPaise: Paise; overdueFamilies: number };
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
    };
    if (allows(ctx, "attendance:read")) {
      const marks = await marksFor(tx, t.classes.map((c) => c.session.id));
      out.today.present = { here: marks.filter((m) => m.status === "present" || m.status === "late").length, marked: marks.length };
    }
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
    }
    if (allows(ctx, "invoices:read")) money.owed = await owedSummary(tx, ctx.branchIds, today);
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
