import { CalendarClock, ClipboardCheck, IndianRupee, TrendingDown, UserX, UsersRound, Wallet } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { AttendanceOverview } from "@/components/dashboard/attendance-overview";
import { type Alert, AttentionRequired } from "@/components/dashboard/attention-required";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { FeeCollection } from "@/components/dashboard/fee-collection";
import { Pipeline } from "@/components/dashboard/pipeline";
import { type QuickAction, QuickActions } from "@/components/dashboard/quick-actions";
import { RevenueOverview } from "@/components/dashboard/revenue-overview";
import { TodaysSchedule } from "@/components/dashboard/todays-schedule";
import { StatCard } from "@/components/stat-card";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { addDays, formatDate, timeIn } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { formatCount, formatPaise } from "@/lib/money/format";
import { dashboardData } from "@/modules/dashboard/service";
import { AT_RISK } from "@/modules/reports/service";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// From the YYYY-MM string; no Date, so no timezone shift.
const monthTick = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1] ?? m;
const count = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

// Each section renders only when its slice is in the payload: that is the permission gate.
export default async function DashboardPage() {
  const session = await requireStaffPage();
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  const d = await withTenant(session.tenant.id, (tx) => dashboardData(tx, ctx));
  const { roll, today, money, atRisk, pipeline } = d;
  const tz = today?.timeZone ?? session.tenant.timezone;

  const att = today?.attendance;
  const seen = att ? att.present + att.absent + att.notMarked : 0;
  // Nothing marked yet is not 0%: show a dash.
  const marked = att ? att.present + att.absent : 0;
  // marked > 0 is the only way into the division, so it cannot divide by zero.
  const pct = att && marked > 0 ? Math.round((att.present / marked) * 100) : null;
  const attNote = !att || !seen ? "No classes today" : !marked ? "Not marked yet" : att.notMarked > 0 ? `${marked} of ${seen} marked` : `${att.present} / ${seen}`;

  const owed = money?.owed;
  const collected = money?.thisMonth;
  const trend = money?.trendPct;

  const tomorrow = addDays(d.date, 1);
  const alerts: Alert[] = [];
  if (money?.dueTomorrow !== undefined) alerts.push({ key: "due", n: money.dueTomorrow, text: `${count(money.dueTomorrow, "invoice", "invoices")} due tomorrow`, href: `/finance/invoices?status=open&dueFrom=${tomorrow}&dueTo=${tomorrow}`, icon: CalendarClock, tone: "warning" });
  if (today) alerts.push({ key: "capacity", n: today.nearCapacity, text: `${count(today.nearCapacity, "batch", "batches")} near capacity today`, href: "/today", icon: UsersRound, tone: "warning" });
  if (roll) alerts.push({ key: "waiting", n: roll.waitingForBatch, text: `${count(roll.waitingForBatch, "student", "students")} waiting for a batch`, href: "/students", icon: UsersRound, tone: "warning" });
  if (atRisk?.attendance != null) alerts.push({ key: "risk-att", n: atRisk.attendance, text: `${count(atRisk.attendance, "student", "students")} under ${AT_RISK.below}% attendance`, href: "/reports/at-risk", icon: UserX, tone: "danger" });
  if (atRisk?.unpaid != null) alerts.push({ key: "risk-fees", n: atRisk.unpaid, text: `${count(atRisk.unpaid, "student", "students")} with ${AT_RISK.overdue}+ invoices overdue`, href: "/reports/at-risk", icon: TrendingDown, tone: "danger" });

  const actions: QuickAction[] = [];
  if (allows(ctx, "batches:manage")) actions.push("createBatch");
  if (allows(ctx, "attendance:mark")) actions.push("markAttendance");
  if (allows(ctx, "messages:send")) actions.push("sendAnnouncement");

  const hour = Number(timeIn(tz, new Date()).slice(0, 2));
  const empty = !roll && !today && !money && !atRisk && !pipeline;
  const pending = owed && money.overduePaise !== undefined ? (owed.owedPaise > money.overduePaise ? owed.owedPaise - money.overduePaise : 0n) : undefined;
  const fees = collected && pending !== undefined && money.overduePaise !== undefined ? { collected: collected.total, pending, overdue: money.overduePaise } : undefined;

  return (
    <>
      <DashboardHeader name={session.actor.name} hour={hour} date={formatDate(d.date)} canAddStudent={allows(ctx, "students:create")} canCollect={allows(ctx, "fees:collect")} />
      {empty ? (
        <div className="space-y-5">
          <Card>
            <EmptyState title="Nothing to show for your role yet" hint="Ask the owner to give your role the parts of the app you use." />
          </Card>
          <QuickActions actions={actions} />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {roll ? <StatCard label="Active students" value={roll.active} note={`+${roll.joinedThisMonth} this month`} icon={UsersRound} href="/students" /> : null}
            {att ? <StatCard label="Today's attendance" value={pct === null ? "—" : `${pct}%`} note={attNote} icon={ClipboardCheck} href="/attendance" /> : null}
            {owed ? <StatCard label="Fees due" value={formatPaise(owed.owedPaise)} note={count(owed.invoices, "invoice", "invoices")} icon={Wallet} href="/finance/invoices?status=open" /> : null}
            {collected ? <StatCard label="This month" value={formatPaise(collected.total)} trend={trend} note={trend === null || trend === undefined ? count(collected.count, "receipt", "receipts") : "so far vs all of last month"} icon={IndianRupee} href="/finance/collections" /> : null}
          </div>
          <QuickActions actions={actions} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {today ? (
              <Card>
                <CardHeader title="Today's schedule" />
                <TodaysSchedule classes={today.classes} timeZone={tz} />
              </Card>
            ) : null}
            {att ? (
              <Card>
                <CardHeader title="Attendance today" />
                <AttendanceOverview data={att} />
              </Card>
            ) : null}
            {money?.byMonth ? (
              <Card>
                <CardHeader title="Collection" />
                <RevenueOverview bars={money.byMonth.map((m) => ({ label: monthTick(m.month), totalPaise: m.totalPaise }))} label="Collection by month" />
              </Card>
            ) : null}
            {fees ? (
              <Card>
                <CardHeader title="Fee collection" />
                <FeeCollection {...fees} />
              </Card>
            ) : null}
            <AttentionRequired alerts={alerts} />
            {pipeline ? <Pipeline pipeline={pipeline} /> : null}
          </div>
        </div>
      )}
    </>
  );
}
