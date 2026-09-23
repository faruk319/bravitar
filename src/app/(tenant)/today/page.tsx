import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { Card } from "@/components/ui/card";
import { can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { shellFor } from "@/lib/auth/shell";
import { formatDate, timeIn, weekdayOf } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { cn } from "@/lib/utils";
import { type ClassCard, todaysClasses } from "@/modules/attendance/service";
import { formatTimeRange, WEEKDAY_SHORT } from "@/modules/batches/schedule";

function Status({ c }: { c: ClassCard }) {
  if (c.session.status === "cancelled") return <span className="text-muted-foreground">Cancelled · {c.session.cancelReason}</span>;
  if (!c.marked) return <span className="text-warning-600">● Not marked</span>;
  const done = c.marked >= c.students;
  return (
    <span className={done ? "text-success-600" : "text-warning-600"}>
      {done ? "✓" : "◐"} Marked {c.marked}/{c.students}
    </span>
  );
}

export default async function TodayPage({ searchParams }: PageProps<"/today">) {
  const session = await requireStaffPage();
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  if (!can(ctx, "batches", "sessions:read")) return <Gate permission="sessions:read">{null}</Gate>;
  const { date, timeZone, classes } = await withTenant(session.tenant.id, (tx) => todaysClasses(tx, ctx));
  // docs/07 §7.1: a coach with one class goes straight to its roster.
  if (shellFor(session) === "coach" && classes.length === 1 && !(await searchParams).all) redirect(`/sessions/${classes[0]?.session.id}`);

  return (
    <Gate permission="sessions:read">
      <PageHeader title="Today">
        <p className="text-caption text-muted-foreground">
          {WEEKDAY_SHORT[weekdayOf(date)]}, {formatDate(date)}
        </p>
      </PageHeader>
      {classes.length ? (
        <ul className="flex flex-col gap-3">
          {classes.map((c) => (
            <li key={c.session.id}>
              <Link
                href={`/sessions/${c.session.id}`}
                className={cn("block rounded-2xl border border-neutral-100 bg-card p-4 shadow-card hover:border-neutral-300", c.session.status === "cancelled" && "opacity-70")}
              >
                <p className="text-heading">
                  {c.batchName} <span className="text-caption text-muted-foreground">{c.programName}</span>
                </p>
                <p className="text-body text-muted-foreground">
                  {formatTimeRange(timeIn(timeZone, c.session.startsAt), timeIn(timeZone, c.session.endsAt))}
                  {c.roomName ? ` · ${c.roomName}` : ""} · {c.students} students
                </p>
                <p className="mt-1 text-label">
                  <Status c={c} />
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Card>
          <EmptyState title="No classes today" hint="Classes appear here on the days their batch meets." {...(can(ctx, "batches", "batches:read") ? { action: "See batches", href: "/batches" } : {})} />
        </Card>
      )}
    </Gate>
  );
}
