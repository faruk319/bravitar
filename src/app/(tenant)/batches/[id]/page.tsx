import Link from "next/link";
import { notFound } from "next/navigation";
import { ChangeTiming, CloseOrReopen, DeleteBatch, EditBatch } from "@/components/batches/batch-actions";
import { Avatar } from "@/components/avatar";
import { AddStudents } from "@/components/enrollments/add-students";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { Card, CardHeader } from "@/components/ui/card";
import { allows, can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { formatDate, timeIn, todayIn, weekdayOf } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { formatTimeRange, WEEKDAY_SHORT } from "@/modules/batches/schedule";
import { batchDetail, coachChoices } from "@/modules/batches/service";
import type { RosterRow } from "@/modules/enrollments/repo";
import { batchRoster } from "@/modules/enrollments/service";
import { getPlan } from "@/modules/fees/repo";
import { planChoices } from "@/modules/fees/service";
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
  const canManage = can(ctx, "batches", "batches:manage");
  const seesFees = allows(ctx, "invoices:read") || allows(ctx, "fee_plans:manage");
  const data = await withTenant(session.tenant.id, async (tx) => {
    const batch = await batchDetail(tx, ctx, id);
    return {
      batch,
      plans: canManage && seesFees ? (await planChoices(tx, ctx)).map((p) => ({ id: p.id, name: p.name })) : [],
      planName: seesFees && batch.defaultFeePlanId ? ((await getPlan(tx, batch.defaultFeePlanId))?.name ?? null) : null,
      coaches: await coachChoices(tx, ctx),
      rooms: (await listResources(tx)).map((r) => ({ id: r.id, name: r.name, branchId: r.branchId })),
      today: todayIn(session.tenant.timezone),
      next: await upcomingForBatch(tx, id, new Date(), 8),
      roster: await batchRoster(tx, ctx, id),
    };
  }).catch((e: unknown) => {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  });
  if (!data) notFound();
  const { batch: b, today, roster } = data;
  const count = roster.filter((r) => r.startDate <= today).length;
  const lite = { id: b.id, name: b.name, branchId: b.branchId, status: b.status, startDate: b.startDate, coachId: b.coachId, resourceId: b.resourceId, capacity: b.capacity, defaultFeePlanId: b.defaultFeePlanId, slots: b.slots };
  const facts: [string, string][] = [
    ["Timing", b.schedule],
    ["Coach", b.coachName ?? "Not decided"],
    ["Room", b.resourceName ?? "—"],
    ["Branch", b.branchName],
    ["Capacity", b.capacity ? `${count} / ${b.capacity}` : "No limit"],
    ["Started", formatDate(b.startDate)],
    ...(seesFees ? ([["Fee plan", data.planName ?? "None"]] as [string, string][]) : []),
  ];

  return (
    <Gate permission="batches:read">
      <PageHeader
        title={b.name}
        crumbs={[{ label: "Programs & {batch.many}", href: "/batches" }]}
        actions={
          canManage ? (
            <>
              {b.status !== "ended" ? <ChangeTiming batch={lite} today={today} /> : null}
              <EditBatch batch={lite} coaches={data.coaches} rooms={data.rooms} plans={data.plans} />
              <CloseOrReopen batch={lite} today={today} />
              <DeleteBatch batch={lite} />
            </>
          ) : undefined
        }
      >
        <p className="text-caption text-muted-foreground">
          {b.programName}
          {b.status === "ended" ? ` · Closed · last day ${formatDate(b.endDate)}` : ""}
        </p>
      </PageHeader>

      {b.upcoming ? (
        <p className="mb-5 rounded-2xl bg-accent-50 px-4 py-3 text-body text-accent-600">
          From {formatDate(b.upcoming.from)}: {b.upcoming.schedule}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader
              title={
                <>
                  Roster <span className="text-muted-foreground tabular-nums">{count}</span>
                </>
              }
              action={
                can(ctx, "batches", "enrollments:manage") && b.status !== "ended" ? (
                  <AddStudents batchId={b.id} today={today} inBatch={roster.map((r) => r.studentId)} full={Boolean(b.capacity && count >= b.capacity)} />
                ) : null
              }
            />
            {roster.length ? (
              <ul className="divide-y divide-neutral-100">
                {roster.map((r) => (
                  <li key={r.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
                    <Link href={`/students/${r.studentId}`} className="flex items-center gap-3">
                      <Avatar name={r.studentName} />
                      <span>
                        <span className="block text-body font-medium text-neutral-900 hover:underline">{r.studentName}</span>
                        <span className="block text-caption text-muted-foreground tabular-nums">{r.studentCode}</span>
                      </span>
                    </Link>
                    <span className="text-caption text-muted-foreground">{rosterNote(r, today)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted-foreground">No students yet.</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Next classes" />
            {data.next.length ? (
              <ul className="divide-y divide-neutral-100">
                {data.next.map((s) => (
                  <li key={s.id} className="flex min-h-12 items-center justify-between gap-3 text-body">
                    <Link href={`/sessions/${s.id}`} className="hover:underline">
                      {WEEKDAY_SHORT[weekdayOf(s.sessionDate)]}, {formatDate(s.sessionDate)}
                    </Link>
                    {s.status === "cancelled" ? (
                      <span className="text-muted-foreground">Cancelled · {s.cancelReason}</span>
                    ) : (
                      <span>{formatTimeRange(timeIn(session.tenant.timezone, s.startsAt), timeIn(session.tenant.timezone, s.endsAt))}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted-foreground">No classes in the next 60 days.</p>
            )}
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader title="Details" />
          <dl className="divide-y divide-neutral-100">
            {facts.map(([k, v]) => (
              <div key={k} className="flex min-h-12 items-center justify-between gap-4">
                <dt className="text-label text-muted-foreground">{k}</dt>
                <dd className="text-right text-body">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </Gate>
  );
}
