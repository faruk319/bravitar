import { PauseCircle, Plus, Upload, UserCheck, UserMinus, Users } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Row } from "@/components/row";
import { Gate } from "@/components/shell/gate";
import { StatCard } from "@/components/stat-card";
import { StudentSearchBar } from "@/components/students/search-bar";
import { StatusBadge } from "@/components/students/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { can } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { todayIn } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { formatPhone } from "@/lib/phone";
import { currentBatchNames } from "@/modules/enrollments/repo";
import { countByStatus, countStudents, searchStudents } from "@/modules/students/repo";
import { STUDENT_STATUSES, type StudentStatus } from "@/modules/students/schema";

const PAGE = 50;

export default async function StudentsPage({ searchParams }: PageProps<"/students">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = typeof sp.status === "string" && (STUDENT_STATUSES as readonly string[]).includes(sp.status) ? (sp.status as StudentStatus) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const session = await requireStaffPage();
  const scope = { branchIds: await selectedBranchIds(session) };
  const filter = { ...(q ? { q } : {}), ...(status ? { status } : {}) };
  const data = await withTenant(session.tenant.id, async (tx) => {
    const rows = await searchStudents(tx, scope, { ...filter, limit: PAGE, offset: (page - 1) * PAGE });
    return {
      rows,
      matched: await countStudents(tx, scope, filter),
      byStatus: await countByStatus(tx, scope),
      batches: await currentBatchNames(tx, rows.map((r) => r.student.id), todayIn(session.tenant.timezone)),
    };
  });
  const total = Object.values(data.byStatus).reduce((a, b) => a + b, 0);
  const ctx = scopedCtx(session);
  const canCreate = can(ctx, "students", "students:create");
  const canImport = canCreate && can(ctx, "students", "students:import");
  const pageHref = (p: number) => `/students?${new URLSearchParams({ ...filter, page: String(p) }).toString()}`;
  const from = (page - 1) * PAGE + 1;

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
            {canCreate && total > 0 ? (
              <Button size="lg" nativeButton={false} render={<Link href="/students/new" />}>
                <Plus data-icon="inline-start" /> Add
              </Button>
            ) : null}
          </>
        }
      />
      {total === 0 ? (
        <Card>
          <EmptyState title="No students yet" hint="Add the first one, or import your register." action="Add student" href="/students/new" />
        </Card>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            <StatCard label="Total" value={total} icon={Users} href="/students" />
            <StatCard label="Active" value={data.byStatus.active} icon={UserCheck} href="/students?status=active" />
            <StatCard label="Paused" value={data.byStatus.paused} icon={PauseCircle} href="/students?status=paused" />
            <StatCard label="Left" value={data.byStatus.left} icon={UserMinus} href="/students?status=left" />
          </div>
          <Card className="overflow-hidden p-0 md:p-0">
            <div className="p-4 md:p-5">
              <Suspense>
                <StudentSearchBar />
              </Suspense>
            </div>
            {data.rows.length === 0 ? (
              <p className="pb-12 text-center text-body text-muted-foreground">No one matches.</p>
            ) : (
              <>
                <table className="hidden w-full md:table">
                  <thead>
                    <tr className="bg-neutral-50 text-left text-caption uppercase tracking-wide text-muted-foreground">
                      <th className="px-5 py-2.5 font-medium">Student</th>
                      <th className="py-2.5 font-medium">Batch</th>
                      <th className="py-2.5 font-medium">Status</th>
                      <th className="px-5 py-2.5 font-medium">Parent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(({ student: s, guardianName, guardianPhone }) => (
                      <tr key={s.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                        <td className="px-5 py-2.5">
                          <Link href={`/students/${s.id}`} className="flex items-center gap-3">
                            <Avatar name={s.fullName} />
                            <span>
                              <span className="block text-body font-medium text-neutral-900 hover:underline">{s.fullName}</span>
                              <span className="block text-caption text-muted-foreground tabular-nums">{s.code}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="py-2.5 text-body">{data.batches.get(s.id)?.join(", ") ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="py-2.5">
                          <StatusBadge status={s.status} />
                        </td>
                        <td className="px-5 py-2.5 text-body text-muted-foreground">{guardianName ? `${guardianName} · ${formatPhone(guardianPhone ?? "")}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="md:hidden [&>*:last-child]:border-b-0">
                  {data.rows.map(({ student: s }) => (
                    <Row key={s.id} href={`/students/${s.id}`} trailing={<StatusBadge status={s.status} />} className="gap-3 border-neutral-100">
                      <div className="flex items-center gap-3">
                        <Avatar name={s.fullName} />
                        <div className="min-w-0">
                          <div className="truncate text-body font-medium">{s.fullName}</div>
                          <div className="truncate text-caption text-muted-foreground tabular-nums">
                            {s.code}
                            {data.batches.get(s.id) ? ` · ${data.batches.get(s.id)?.join(", ")}` : ""}
                          </div>
                        </div>
                      </div>
                    </Row>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-neutral-100 px-4 py-3 text-caption text-muted-foreground md:px-5">
                  <span className="tabular-nums">
                    {from}–{from + data.rows.length - 1} of {data.matched}
                  </span>
                  <span className="flex gap-2">
                    {page > 1 ? (
                      <Button variant="outline" size="sm" nativeButton={false} render={<Link href={pageHref(page - 1)} />}>
                        Previous
                      </Button>
                    ) : null}
                    {from + data.rows.length - 1 < data.matched ? (
                      <Button variant="outline" size="sm" nativeButton={false} render={<Link href={pageHref(page + 1)} />}>
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
