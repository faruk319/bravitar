import { Plus } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { BatchTabs } from "@/components/batches/batch-tabs";
import { Row } from "@/components/row";
import { Gate } from "@/components/shell/gate";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { formatDate, todayIn } from "@/lib/dates";
import { batchViews } from "@/modules/batches/service";
import { rosterCounts } from "@/modules/enrollments/repo";

export default async function BatchesPage({ searchParams }: PageProps<"/batches">) {
  const session = await requireStaffPage();
  const ended = (await searchParams).ended === "1";
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  const canManage = can(ctx, "batches", "batches:manage");
  const { views, counts } = can(ctx, "batches", "batches:read")
    ? await withTenant(session.tenant.id, async (tx) => {
        const views = await batchViews(tx, ctx, { includeEnded: ended });
        return { views, counts: await rosterCounts(tx, views.map((v) => v.id), todayIn(session.tenant.timezone)) };
      })
    : { views: [], counts: new Map<string, number>() };
  const groups = [...new Set(views.map((v) => v.programName))];

  return (
    <Gate permission="batches:read">
      <PageHeader
        title="Programs & {batch.many}"
        actions={
          canManage && views.length ? (
            <Button size="lg" nativeButton={false} render={<Link href="/batches/new" />}>
              <Plus data-icon="inline-start" /> Add
            </Button>
          ) : undefined
        }
      />
      <BatchTabs />
      {!views.length && !ended ? (
        <Card>
          <EmptyState title="No batches yet" hint="A batch is a group with a weekly timing." action="Add batch" {...(canManage ? { href: "/batches/new" } : { soon: true })} />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <Card key={g} className="overflow-hidden p-0 md:p-0">
              <CardHeader title={g} className="mb-1 px-4 pt-4 md:px-5 md:pt-5" />
              <div className="[&>*:last-child]:border-b-0">
                {views
                  .filter((v) => v.programName === g)
                  .map((v) => (
                    <Row
                      key={v.id}
                      href={`/batches/${v.id}`}
                      className="border-neutral-100 md:px-5"
                      trailing={
                        <span className="text-label text-muted-foreground tabular-nums">
                          {counts.get(v.id) ?? 0}
                          {v.capacity ? ` / ${v.capacity}` : ""}
                        </span>
                      }
                    >
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
            </Card>
          ))}
          <Link href={ended ? "/batches" : "/batches?ended=1"} className="text-body text-accent-600 hover:underline">
            {ended ? "Hide closed" : "Show closed"}
          </Link>
        </div>
      )}
    </Gate>
  );
}
