import Link from "next/link";
import { notFound } from "next/navigation";
import { ChangeTiming, CloseOrReopen, DeleteBatch, EditBatch } from "@/components/batches/batch-actions";
import { BatchTabs } from "@/components/batches/batch-tabs";
import { AddStudents } from "@/components/enrollments/add-students";
import { Gate } from "@/components/shell/gate";
import { can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { formatDate, timeIn, todayIn, weekdayOf } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { formatTimeRange, WEEKDAY_SHORT } from "@/modules/batches/schedule";
import { batchDetail, coachChoices } from "@/modules/batches/service";
import type { RosterRow } from "@/modules/enrollments/repo";
import { batchRoster } from "@/modules/enrollments/service";
import { upcomingForBatch } from "@/modules/sessions/repo";
import { listResources } from "@/modules/tenancy/repo";

function rosterNote(r: RosterRow, today: string): string {
  if (r.status === "paused") return "Paused";
  if (r.startDate > today) return `Starts ${formatDate(r.startDate)}`;
  return r.endDate ? `Last day ${formatDate(r.endDate)}` : "";
}

export default async function BatchPage({ params }: PageProps<"/batches/[id]">) {
  const { id } = await params;
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!can(ctx, "batches", "batches:read")) return <Gate permission="batches:read">{null}</Gate>;
  const data = await withTenant(session.tenant.id, async (tx) => ({
    batch: await batchDetail(tx, ctx, id),
    coaches: await coachChoices(tx, ctx),
    rooms: (await listResources(tx)).map((r) => ({ id: r.id, name: r.name, branchId: r.branchId })),
    today: todayIn(session.tenant.timezone),
    next: await upcomingForBatch(tx, id, new Date(), 8),
    roster: await batchRoster(tx, ctx, id),
  })).catch((e: unknown) => {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  });
  if (!data) notFound();
  const { batch: b, today, roster } = data;
  const canManage = can(ctx, "batches", "batches:manage");
  const count = roster.filter((r) => r.startDate <= today).length;
  const lite = { id: b.id, name: b.name, branchId: b.branchId, status: b.status, startDate: b.startDate, coachId: b.coachId, resourceId: b.resourceId, capacity: b.capacity, slots: b.slots };
  const facts: [string, string][] = [
    ["Timing", b.schedule],
    ["Coach", b.coachName ?? "Not decided"],
    ["Room", b.resourceName ?? "—"],
    ["Branch", b.branchName],
    ["Capacity", b.capacity ? `${count} / ${b.capacity}` : "No limit"],
    ["Started", formatDate(b.startDate)],
  ];

  return (
    <Gate permission="batches:read">
      <BatchTabs />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-caption text-muted-foreground">{b.programName}</p>
          <h1 className="text-display">{b.name}</h1>
          {b.status === "ended" ? <p className="text-body text-muted-foreground">Closed · last day {formatDate(b.endDate)}</p> : null}
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            {b.status !== "ended" ? <ChangeTiming batch={lite} today={today} /> : null}
            <EditBatch batch={lite} coaches={data.coaches} rooms={data.rooms} />
            <CloseOrReopen batch={lite} today={today} />
            <DeleteBatch batch={lite} />
          </div>
        ) : null}
      </div>

      {b.upcoming ? (
        <p className="mt-4 rounded-xl border border-border bg-accent-50 px-4 py-3 text-body">
          From {formatDate(b.upcoming.from)}: {b.upcoming.schedule}
        </p>
      ) : null}

      <dl className="mt-4 grid gap-x-6 gap-y-3 rounded-xl border border-border p-4 md:grid-cols-2">
        {facts.map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <dt className="text-caption text-muted-foreground">{k}</dt>
            <dd className="text-body">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-6">
        <h2 className="text-heading">Next classes</h2>
        {data.next.length ? (
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
            {data.next.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-body">
                <span>
                  {WEEKDAY_SHORT[weekdayOf(s.sessionDate)]}, {formatDate(s.sessionDate)}
                </span>
                {s.status === "cancelled" ? (
                  <span className="text-muted-foreground">Cancelled · {s.cancelReason}</span>
                ) : (
                  <span>{formatTimeRange(timeIn(session.tenant.timezone, s.startsAt), timeIn(session.tenant.timezone, s.endsAt))}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-body text-muted-foreground">No classes in the next 60 days.</p>
        )}
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-heading">
            Roster <span className="text-muted-foreground tabular-nums">{count}</span>
          </h2>
          {can(ctx, "batches", "enrollments:manage") && b.status !== "ended" ? (
            <AddStudents batchId={b.id} today={today} inBatch={roster.map((r) => r.studentId)} full={Boolean(b.capacity && count >= b.capacity)} />
          ) : null}
        </div>
        {roster.length ? (
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
            {roster.map((r) => (
              <li key={r.id} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
                <Link href={`/students/${r.studentId}`} className="text-body hover:underline">
                  {r.studentName} <span className="text-caption text-muted-foreground tabular-nums">{r.studentCode}</span>
                </Link>
                <span className="text-caption text-muted-foreground">{rosterNote(r, today)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-body text-muted-foreground">No students yet.</p>
        )}
      </section>
    </Gate>
  );
}
