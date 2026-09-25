import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { pickRange, RangeForm } from "@/components/reports/range-form";
import { Gate } from "@/components/shell/gate";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { formatDate } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { admissionsReport, thisMonth } from "@/modules/reports/service";
import type { StudentMove } from "@/modules/students/repo";
import { LEFT_REASON_LABELS } from "@/modules/students/schema";

function List({ title, rows, reasons }: { title: string; rows: StudentMove[]; reasons?: boolean }) {
  return (
    <Card>
      <CardHeader title={`${title} · ${rows.length}`} />
      {rows.length ? (
        <ul className="divide-y divide-neutral-100">
          {rows.map((s) => (
            <li key={s.id} className="flex min-h-12 items-center justify-between gap-3 text-body">
              <Link href={`/students/${s.id}`} className="hover:underline">
                {s.fullName} <span className="text-caption text-muted-foreground">{s.code}</span>
              </Link>
              <span className="text-caption text-muted-foreground">
                {formatDate(s.on)}
                {reasons && s.leftReason ? ` · ${LEFT_REASON_LABELS[s.leftReason]}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground">Nobody in these dates.</p>
      )}
    </Card>
  );
}

// docs/03 §11: who joined and who left, with why.
export default async function AdmissionsReportPage({ searchParams }: PageProps<"/reports/admissions">) {
  const session = await requireStaffPage();
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  if (!allows(ctx, "reports:view")) return <Gate permission="reports:view">{null}</Gate>;
  const sp = await searchParams;
  const r = await withTenant(session.tenant.id, async (tx) => admissionsReport(tx, ctx, pickRange(sp, await thisMonth(tx))));
  return (
    <Gate permission="reports:view">
      <PageHeader title="Admissions and dropouts" crumbs={[{ href: "/reports", label: "Reports" }]} />
      <RangeForm from={r.from} to={r.to} csv={`/api/reports/admissions?from=${r.from}&to=${r.to}`} />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <List title="Joined" rows={r.joined} />
        <List title="Left" rows={r.left} reasons />
      </div>
    </Gate>
  );
}
