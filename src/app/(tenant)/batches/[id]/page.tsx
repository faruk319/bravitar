import { notFound } from "next/navigation";
import { ChangeTiming, CloseOrReopen, DeleteBatch, EditBatch } from "@/components/batches/batch-actions";
import { BatchTabs } from "@/components/batches/batch-tabs";
import { EmptyState } from "@/components/empty-state";
import { Gate } from "@/components/shell/gate";
import { can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { formatDate, todayIn } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { batchDetail, coachChoices } from "@/modules/batches/service";
import { getOwnTenant, listResources } from "@/modules/tenancy/repo";

export default async function BatchPage({ params }: PageProps<"/batches/[id]">) {
  const { id } = await params;
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!can(ctx, "batches", "batches:read")) return <Gate permission="batches:read">{null}</Gate>;
  const data = await withTenant(session.tenant.id, async (tx) => ({
    batch: await batchDetail(tx, ctx, id),
    coaches: await coachChoices(tx, ctx),
    rooms: (await listResources(tx)).map((r) => ({ id: r.id, name: r.name, branchId: r.branchId })),
    today: todayIn((await getOwnTenant(tx))?.timezone ?? "Asia/Kolkata"),
  })).catch((e: unknown) => {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  });
  if (!data) notFound();
  const { batch: b, today } = data;
  const canManage = can(ctx, "batches", "batches:manage");
  const lite = { id: b.id, name: b.name, branchId: b.branchId, status: b.status, startDate: b.startDate, coachId: b.coachId, resourceId: b.resourceId, capacity: b.capacity, slots: b.slots };
  const facts: [string, string][] = [
    ["Timing", b.schedule],
    ["Coach", b.coachName ?? "Not decided"],
    ["Room", b.resourceName ?? "—"],
    ["Branch", b.branchName],
    ["Capacity", b.capacity ? `0 / ${b.capacity}` : "No limit"],
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
        <h2 className="text-heading">Roster</h2>
        <EmptyState title="No students yet" hint="Students join a batch from their profile or from here." action="Add students" soon />
      </section>
    </Gate>
  );
}
