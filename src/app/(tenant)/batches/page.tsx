import { Plus } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { BatchTabs } from "@/components/batches/batch-tabs";
import { Row } from "@/components/row";
import { Gate } from "@/components/shell/gate";
import { PageTitle } from "@/components/shell/placeholder";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { formatDate } from "@/lib/dates";
import { batchViews } from "@/modules/batches/service";

export default async function BatchesPage({ searchParams }: PageProps<"/batches">) {
  const session = await requireStaffPage();
  const ended = (await searchParams).ended === "1";
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  const canManage = can(ctx, "batches", "batches:manage");
  const views = can(ctx, "batches", "batches:read") ? await withTenant(session.tenant.id, (tx) => batchViews(tx, ctx, { includeEnded: ended })) : [];
  const groups = [...new Set(views.map((v) => v.programName))];

  return (
    <Gate permission="batches:read">
      <div className="flex items-start justify-between gap-3">
        <PageTitle>{"Programs & {batch.many}"}</PageTitle>
        {canManage && views.length ? (
          <Button size="lg" nativeButton={false} render={<Link href="/batches/new" />}>
            <Plus data-icon="inline-start" /> Add
          </Button>
        ) : null}
      </div>
      <BatchTabs />
      {!views.length && !ended ? (
        <EmptyState title="No batches yet" hint="A batch is a group with a weekly timing." action="Add batch" {...(canManage ? { href: "/batches/new" } : { soon: true })} />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g}>
              <h2 className="mb-2 text-label text-muted-foreground">{g}</h2>
              <div className="overflow-hidden rounded-xl border border-border [&>*:last-child]:border-b-0">
                {views
                  .filter((v) => v.programName === g)
                  .map((v) => (
                    <Row key={v.id} href={`/batches/${v.id}`} trailing={<span className="text-label text-muted-foreground tabular-nums">{v.capacity ? `0 / ${v.capacity}` : "0"}</span>}>
                      <div className="truncate text-body font-medium">
                        {v.name}
                        {v.status === "ended" ? <span className="ml-2 text-caption text-muted-foreground">Closed {formatDate(v.endDate)}</span> : null}
                      </div>
                      <div className="truncate text-caption text-muted-foreground">
                        {v.schedule}
                        {v.coachName ? ` · ${v.coachName}` : ""}
                        {v.resourceName ? ` · ${v.resourceName}` : ""}
                      </div>
                    </Row>
                  ))}
              </div>
            </section>
          ))}
          <Link href={ended ? "/batches" : "/batches?ended=1"} className="text-body text-accent-600 hover:underline">
            {ended ? "Hide closed" : "Show closed"}
          </Link>
        </div>
      )}
    </Gate>
  );
}
