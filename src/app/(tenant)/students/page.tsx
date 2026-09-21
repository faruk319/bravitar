import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { Row } from "@/components/row";
import { Gate } from "@/components/shell/gate";
import { PageTitle } from "@/components/shell/placeholder";
import { StudentSearchBar } from "@/components/students/search-bar";
import { StatusBadge } from "@/components/students/status-badge";
import { Button } from "@/components/ui/button";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { formatPhone } from "@/lib/phone";
import { countStudents, searchStudents } from "@/modules/students/repo";
import { STUDENT_STATUSES, type StudentStatus } from "@/modules/students/schema";

export default async function StudentsPage({ searchParams }: PageProps<"/students">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = typeof sp.status === "string" && (STUDENT_STATUSES as readonly string[]).includes(sp.status) ? (sp.status as StudentStatus) : undefined;
  const session = await requireStaffPage();
  const scope = { branchIds: session.branchIds };
  const { rows, total } = await withTenant(session.tenant.id, async (tx) => ({
    rows: await searchStudents(tx, scope, { ...(q ? { q } : {}), ...(status ? { status } : {}) }),
    total: await countStudents(tx, scope),
  }));
  const canCreate = session.isOwner || session.permissions.includes("students:create");

  return (
    <Gate permission="students:read">
      <div className="flex items-start justify-between gap-3">
        <PageTitle>{"{student.many}"}</PageTitle>
        {canCreate && total > 0 ? (
          <Button size="lg" nativeButton={false} render={<Link href="/students/new" />}>
            <Plus data-icon="inline-start" /> Add
          </Button>
        ) : null}
      </div>
      {total === 0 ? (
        <EmptyState title="No students yet" hint="Add the first one, or import your register." action="Add student" href="/students/new" />
      ) : (
        <>
          <Suspense>
            <StudentSearchBar count={rows.length} />
          </Suspense>
          {rows.length === 0 ? (
            <p className="py-12 text-center text-body text-muted-foreground">No one matches.</p>
          ) : (
            <>
              <table className="mt-4 hidden w-full md:table">
                <thead>
                  <tr className="text-left text-label text-muted-foreground">
                    <th className="py-2 font-medium">Name</th>
                    <th className="py-2 font-medium">Code</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 font-medium">Guardian</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ student: s, guardianName, guardianPhone }) => (
                    <tr key={s.id} className="border-t border-border hover:bg-neutral-50">
                      <td className="py-3">
                        <Link href={`/students/${s.id}`} className="text-body font-medium text-foreground hover:underline">
                          {s.fullName}
                        </Link>
                      </td>
                      <td className="py-3 text-body tabular-nums">{s.code}</td>
                      <td className="py-3"><StatusBadge status={s.status} /></td>
                      <td className="py-3 text-body text-muted-foreground">{guardianName ? `${guardianName} · ${formatPhone(guardianPhone ?? "")}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 -mx-4 md:hidden">
                {rows.map(({ student: s, guardianName }) => (
                  <Row key={s.id} href={`/students/${s.id}`} trailing={<StatusBadge status={s.status} />}>
                    <div className="truncate text-body font-medium">{s.fullName}</div>
                    <div className="truncate text-caption text-muted-foreground tabular-nums">{s.code}{guardianName ? ` · ${guardianName}` : ""}</div>
                  </Row>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Gate>
  );
}
