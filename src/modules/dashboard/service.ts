import { allows } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import type { Tx } from "@/lib/db/client";
import { todayIn } from "@/lib/dates";
import { marksFor } from "@/modules/attendance/repo";
import { type ClassCard, todaysClasses } from "@/modules/attendance/service";
import { listBatchViews } from "@/modules/batches/service";
import { rosterCounts } from "@/modules/enrollments/repo";
import { collectedToday } from "@/modules/payments/service";
import { staffDirectory } from "@/modules/staff/service";
import { countByStatus, countJoinedSince } from "@/modules/students/repo";
import { getOwnTenant } from "@/modules/tenancy/repo";

export type Dashboard = {
  students?: { active: number; paused: number; newThisMonth: number };
  classes?: { list: ClassCard[]; timeZone: string; notMarked: number };
  present?: { here: number; marked: number };
  batches?: { running: number; enrolled: number };
  staff?: { active: number; waiting: number };
  collected?: { count: number; total: bigint };
};

// Built from permissions: each block is queried only if the viewer may see it.
export async function dashboardData(tx: Tx, ctx: ScopedCtx, opts: { now?: Date } = {}): Promise<Dashboard> {
  const now = opts.now ?? new Date();
  const today = todayIn((await getOwnTenant(tx))?.timezone ?? "Asia/Kolkata", now);
  const scope = { branchIds: ctx.branchIds };
  const out: Dashboard = {};
  if (allows(ctx, "students:read")) {
    const byStatus = await countByStatus(tx, scope);
    out.students = { active: byStatus.active, paused: byStatus.paused, newThisMonth: await countJoinedSince(tx, scope, `${today.slice(0, 7)}-01`) };
  }
  if (allows(ctx, "sessions:read")) {
    const t = await todaysClasses(tx, ctx, { now });
    const started = t.classes.filter((c) => c.session.status !== "cancelled" && c.session.startsAt <= now);
    out.classes = { list: t.classes, timeZone: t.timeZone, notMarked: started.filter((c) => c.marked === 0).length };
    if (allows(ctx, "attendance:read")) {
      const marks = await marksFor(tx, t.classes.map((c) => c.session.id));
      out.present = { here: marks.filter((m) => m.status === "present" || m.status === "late").length, marked: marks.length };
    }
  }
  if (allows(ctx, "batches:read")) {
    const views = await listBatchViews(tx, ctx.branchIds);
    const counts = await rosterCounts(tx, views.map((v) => v.id), today);
    out.batches = { running: views.length, enrolled: [...counts.values()].reduce((a, b) => a + b, 0) };
  }
  if (allows(ctx, "staff:read")) {
    const staff = await staffDirectory(tx, ctx, now);
    out.staff = { active: staff.filter((s) => s.status === "active").length, waiting: staff.filter((s) => s.status === "invited" || s.status === "needs-link").length };
  }
  // docs/03 §9: the collection sheet is one tap from here.
  if (allows(ctx, "payments:read")) out.collected = await collectedToday(tx, ctx, { now });
  return out;
}
