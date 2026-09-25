import { ClipboardCheck, IndianRupee, Layers, UserCog, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { ClassStatus } from "@/components/attendance/class-status";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardHeader } from "@/components/ui/card";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { timeIn } from "@/lib/dates";
import { formatPaise } from "@/lib/money/format";
import { formatPhone } from "@/lib/phone";
import { withTenant } from "@/lib/db/with-tenant";
import { formatTimeRange } from "@/modules/batches/schedule";
import { dashboardData } from "@/modules/dashboard/service";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Every block is there only if the viewer's permissions allow it.
export default async function DashboardPage() {
  const session = await requireStaffPage();
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  const d = await withTenant(session.tenant.id, (tx) => dashboardData(tx, ctx));
  const stats = [
    d.present ? <StatCard key="p" label="Present today" value={d.present.marked ? `${d.present.here}/${d.present.marked}` : "—"} icon={ClipboardCheck} href="/attendance" /> : null,
    d.collected ? <StatCard key="c" label="Collected today" value={formatPaise(d.collected.total)} icon={IndianRupee} href="/payments" /> : null,
    d.students ? <StatCard key="a" label="Active students" value={d.students.active} icon={Users} href="/students?status=active" /> : null,
    d.students ? <StatCard key="n" label="New this month" value={d.students.newThisMonth} icon={UserPlus} href="/students" /> : null,
    d.batches ? <StatCard key="b" label="Batches running" value={d.batches.running} icon={Layers} href="/batches" /> : null,
    d.staff ? <StatCard key="s" label="Staff" value={d.staff.active} icon={UserCog} href="/staff" /> : null,
  ].filter(Boolean);
  const attention = [
    d.classes?.notMarked ? { href: "/today", text: `${count(d.classes.notMarked, "class", "classes")} not marked yet` } : null,
    d.students?.paused ? { href: "/students?status=paused", text: `${count(d.students.paused, "student", "students")} paused` } : null,
    d.staff?.waiting ? { href: "/staff", text: `${count(d.staff.waiting, "person hasn't", "people haven't")} set a password` } : null,
  ].filter((x): x is { href: string; text: string } => Boolean(x));

  return (
    <>
      <PageHeader title="Dashboard" />
      {!stats.length && !d.classes ? (
        <Card>
          <EmptyState title="Nothing to show for your role yet" hint="Ask the owner to give your role the parts of the app you use." />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {stats.length ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">{stats}</div> : null}
          {attention.length ? (
            <Card>
              <CardHeader title="Needs attention" />
              <ul className="divide-y divide-neutral-100">
                {attention.map((a) => (
                  <li key={a.href}>
                    <Link href={a.href} className="flex min-h-12 items-center justify-between gap-3 text-body hover:underline">
                      <span className="text-warning-600">⚠ {a.text}</span>
                      <span aria-hidden>→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {d.followUps?.length ? (
            <Card>
              <CardHeader title="Follow-ups today" action={<Link href="/enquiries?view=follow_ups" className="text-label text-accent-600 hover:underline">All</Link>} />
              <ul className="divide-y divide-neutral-100">
                {d.followUps.slice(0, 5).map((e) => (
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
            </Card>
          ) : null}
          {d.classes ? (
            <Card>
              <CardHeader title="Today's classes" action={<Link href="/today" className="text-label text-accent-600 hover:underline">All</Link>} />
              {d.classes.list.length ? (
                <ul className="divide-y divide-neutral-100">
                  {d.classes.list.map((c) => (
                    <li key={c.session.id}>
                      <Link href={`/sessions/${c.session.id}`} className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-2 hover:bg-neutral-50">
                        <span>
                          <span className="block text-body font-medium text-neutral-900">{c.batchName}</span>
                          <span className="block text-caption text-muted-foreground">
                            {formatTimeRange(timeIn(d.classes?.timeZone ?? "Asia/Kolkata", c.session.startsAt), timeIn(d.classes?.timeZone ?? "Asia/Kolkata", c.session.endsAt))}
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
                <p className="text-body text-muted-foreground">No classes today.</p>
              )}
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
