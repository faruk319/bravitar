import { PauseCircle, Plus, Upload, UserCheck, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { StatCard } from "@/components/stat-card";
import { StudentSearchBar } from "@/components/students/search-bar";
import { StudentTable } from "@/components/students/student-table";
import { TrendCards } from "@/components/students/trend-cards";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { allows, can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { todayIn } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { listParams, parseListQuery, studentCounts, studentList } from "@/modules/students/service";
import { studentTrends } from "@/modules/students/trends";

export default async function StudentsPage({ searchParams }: PageProps<"/students">) {
  const query = parseListQuery(await searchParams);
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  const data = allows(ctx, "students:read")
    ? await withTenant(session.tenant.id, async (tx) => ({ list: await studentList(tx, ctx, query), counts: await studentCounts(tx, ctx), trends: await studentTrends(tx, ctx) }))
    : null;
  const canCreate = can(ctx, "students", "students:create");
  const canImport = canCreate && can(ctx, "students", "students:import");
  const monthStart = `${todayIn(session.tenant.timezone).slice(0, 7)}-01`;
  const list = data?.list;
  const pageHref = (p: number) => `/students?${listParams(list?.applied ?? {}, p)}`;
  const first = list ? (list.page - 1) * list.pageSize + 1 : 0;
  const counts = data?.counts;

  return (
    <Gate permission="students:read">
      <PageHeader
        title="{student.many}"
        actions={
          <>
            {canImport ? (
              <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/students/import" />}>
                <Upload data-icon="inline-start" /> Import
              </Button>
            ) : null}
            {canCreate && (counts?.total ?? 0) > 0 ? (
              <Button size="lg" nativeButton={false} render={<Link href="/students/new" />}>
                <Plus data-icon="inline-start" /> Add
              </Button>
            ) : null}
          </>
        }
      />
      {!list || !counts ? null : counts.total === 0 ? (
        <Card>
          <EmptyState title="No students yet" hint="Add the first one, or import your register." action="Add student" href="/students/new" />
        </Card>
      ) : (
        <>
          {(() => {
            const kpis = (
              <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-rows-2">
                <StatCard label="Total" value={counts.total} icon={Users} href="/students" />
                <StatCard label="Active" value={counts.active} icon={UserCheck} href="/students?status=active" />
                <StatCard label="New this month" value={counts.joinedThisMonth} icon={UserPlus} href={`/students?joinedFrom=${monthStart}`} />
                <StatCard label="Paused" value={counts.paused} icon={PauseCircle} href="/students?status=paused" />
              </div>
            );
            return data?.trends ? <TrendCards trends={data.trends} lead={kpis} /> : <div className="mb-5">{kpis}</div>;
          })()}
          <Card className="overflow-hidden p-0 md:p-0">
            <div className="p-4 md:p-5">
              <Suspense>
                <StudentSearchBar options={list.options} fee={list.shows.fee} />
              </Suspense>
            </div>
            {list.rows.length === 0 ? (
              <p className="pb-12 text-center text-body text-muted-foreground">No one matches.</p>
            ) : (
              <>
                <StudentTable rows={list.rows} shows={list.shows} />
                <div className="flex items-center justify-between gap-3 border-t border-neutral-100 px-4 py-3 text-caption text-muted-foreground md:px-5">
                  <span className="tabular-nums">
                    {first}–{first + list.rows.length - 1} of {list.matched}
                  </span>
                  <span className="flex gap-2">
                    {list.page > 1 ? (
                      <Button variant="outline" size="sm" nativeButton={false} render={<Link href={pageHref(list.page - 1)} />}>
                        Previous
                      </Button>
                    ) : null}
                    {first + list.rows.length - 1 < list.matched ? (
                      <Button variant="outline" size="sm" nativeButton={false} render={<Link href={pageHref(list.page + 1)} />}>
                        Next
                      </Button>
                    ) : null}
                  </span>
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </Gate>
  );
}
