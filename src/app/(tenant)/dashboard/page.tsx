import Link from "next/link";
import type { ReactNode } from "react";
import { ClassStatus } from "@/components/attendance/class-status";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Columns } from "@/components/reports/bars";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { formatDate, formatDayMonth, timeIn } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { formatCount, formatPaise } from "@/lib/money/format";
import { formatPhone } from "@/lib/phone";
import { formatTimeRange } from "@/modules/batches/schedule";
import { dashboardData } from "@/modules/dashboard/service";
import { AT_RISK, collectionBuckets } from "@/modules/reports/service";

const count = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

// docs/07 §6: every number opens the list behind it.
function Figure({ label, value, note, href }: { label: string; value: ReactNode; note?: string; href: string }) {
  return (
    <Link href={href} className="flex min-h-20 flex-col gap-1 rounded-xl bg-neutral-50 p-3 hover:bg-neutral-100">
      <span className="text-label text-neutral-700">{label}</span>
      <span className="text-display text-neutral-900">{value}</span>
      {note ? <span className="text-caption text-muted-foreground">{note}</span> : null}
    </Link>
  );
}

function Figures({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

// docs/06 Prompt 19: Today, Money, At risk, Pipeline. Nothing else.
export default async function DashboardPage() {
  const session = await requireStaffPage();
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  const d = await withTenant(session.tenant.id, (tx) => dashboardData(tx, ctx));
  const reports = allows(ctx, "reports:view");
  const { today, money, atRisk, pipeline } = d;
  const tz = today?.timeZone ?? session.tenant.timezone;

  return (
    <>
      <PageHeader title="Dashboard">
        <p className="text-caption text-muted-foreground">{formatDate(d.date)}</p>
      </PageHeader>
      {!today && !money && !atRisk && !pipeline ? (
        <Card>
          <EmptyState title="Nothing to show for your role yet" hint="Ask the owner to give your role the parts of the app you use." />
        </Card>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {today ? (
            <Card>
              <CardHeader title="Today" />
              <Figures>
                <Figure label="Classes" value={formatCount(today.held)} href="/today" />
                <Figure label="Marked" value={`${today.marked}/${today.held}`} href="/today" />
                <Figure label="Not marked yet" value={formatCount(today.notMarked)} href="/today" />
                {today.present ? <Figure label="Present" value={today.present.marked ? `${today.present.here}/${today.present.marked}` : "—"} href="/attendance" /> : null}
              </Figures>
              {today.classes.length ? (
                <ul className="mt-3 divide-y divide-neutral-100">
                  {today.classes.map((c) => (
                    <li key={c.session.id}>
                      <Link href={`/sessions/${c.session.id}`} className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-2 hover:bg-neutral-50">
                        <span>
                          <span className="block text-body font-medium text-neutral-900">{c.batchName}</span>
                          <span className="block text-caption text-muted-foreground">
                            {formatTimeRange(timeIn(tz, c.session.startsAt), timeIn(tz, c.session.endsAt))}
                            {c.roomName ? ` · ${c.roomName}` : ""}
                          </span>
                        </span>
                        <span className="text-label">
                          <ClassStatus c={c} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-body text-muted-foreground">No classes today.</p>
              )}
            </Card>
          ) : null}

          {money ? (
            <Card>
              <CardHeader title="Money" />
              <Figures>
                {money.collectedToday ? <Figure label="Collected today" value={formatPaise(money.collectedToday.total)} note={count(money.collectedToday.count, "receipt", "receipts")} href="/payments" /> : null}
                {money.thisMonth ? <Figure label="This month" value={formatPaise(money.thisMonth.total)} note={count(money.thisMonth.count, "receipt", "receipts")} href={reports ? "/reports/collection" : "/payments"} /> : null}
                {money.owed ? <Figure label="Outstanding" value={formatPaise(money.owed.owedPaise)} note={count(money.owed.invoices, "invoice", "invoices")} href="/invoices?view=unpaid" /> : null}
                {money.owed ? <Figure label="Overdue" value={count(money.owed.overdueFamilies, "family", "families")} href="/invoices?view=overdue" /> : null}
                {money.admissions !== undefined ? <Figure label="New admissions" value={formatCount(money.admissions)} note="this month" href={reports ? "/reports/admissions" : "/students"} /> : null}
              </Figures>
              {money.last30 ? (
                <div className="mt-4">
                  <h3 className="mb-1 text-label text-muted-foreground">Last 30 days</h3>
                  <Columns
                    label="Collected by day, last 30 days"
                    columns={collectionBuckets(money.last30).buckets.map((b) => ({
                      key: b.from,
                      tick: formatDayMonth(b.from),
                      tip: `${formatDate(b.from)} · ${formatPaise(b.totalPaise)} · ${count(b.count, "receipt", "receipts")}`,
                      value: Number(b.totalPaise),
                      valueText: formatPaise(b.totalPaise),
                      href: `/payments?day=${b.from}`,
                    }))}
                  />
                </div>
              ) : null}
            </Card>
          ) : null}

          {atRisk ? (
            <Card>
              <CardHeader title="At risk" />
              <Figures>
                {atRisk.attendance !== null ? <Figure label={`Attendance under ${AT_RISK.below}%`} value={count(atRisk.attendance, "student", "students")} note={`last ${AT_RISK.days} days`} href="/reports/at-risk" /> : null}
                {atRisk.unpaid !== null ? <Figure label={`${AT_RISK.overdue}+ invoices overdue`} value={count(atRisk.unpaid, "student", "students")} href="/reports/at-risk" /> : null}
              </Figures>
            </Card>
          ) : null}

          {pipeline ? (
            <Card>
              <CardHeader title="Pipeline" />
              <Figures>
                <Figure label="Follow-ups due" value={formatCount(pipeline.followUps)} href="/enquiries?view=follow_ups" />
                <Figure label="New enquiries" value={formatCount(pipeline.month.received)} note="this month" href="/enquiries?view=report" />
                <Figure label="Trial booked" value={formatCount(pipeline.month.trialBooked)} note="of these" href="/enquiries?view=report" />
                <Figure label="Joined" value={formatCount(pipeline.month.won)} note="of these" href="/enquiries?view=report" />
              </Figures>
              {pipeline.mine.length ? (
                <>
                  <h3 className="mt-4 text-label text-muted-foreground">Your follow-ups</h3>
                  <ul className="divide-y divide-neutral-100">
                    {pipeline.mine.slice(0, 5).map((e) => (
                      <li key={e.id}>
                        <Link href={`/enquiries/${e.id}`} className="flex min-h-14 items-center justify-between gap-2 py-2 hover:bg-neutral-50">
                          <span>
                            <span className="block text-body font-medium text-neutral-900">{e.name}</span>
                            <span className="block text-caption text-muted-foreground">{e.programName ?? ""}</span>
                          </span>
                          <span className="text-label tabular-nums">{formatPhone(e.phone)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
