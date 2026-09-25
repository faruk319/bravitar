import Link from "next/link";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { BarList } from "@/components/reports/bars";
import { RangeForm } from "@/components/reports/range-form";
import { Gate } from "@/components/shell/gate";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { formatDate } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { AT_RISK, atRisk } from "@/modules/reports/service";

// Agreed 2026-09-25: under 60% attendance in the last 30 days, or a family with
// two or more invoices past their due date. Each list for those who may see it.
export default async function AtRiskPage() {
  const session = await requireStaffPage();
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  if (!allows(ctx, "students:read")) return <Gate permission="students:read">{null}</Gate>;
  if (!allows(ctx, "attendance:read") && !allows(ctx, "invoices:read")) return <Gate permission="attendance:read">{null}</Gate>; // neither list
  const r = await withTenant(session.tenant.id, (tx) => atRisk(tx, ctx));
  const reports = allows(ctx, "reports:view");
  return (
    <Gate permission="students:read">
      <PageHeader title="At risk" crumbs={reports ? [{ href: "/reports", label: "Reports" }] : []}>
        <p className="text-caption text-muted-foreground">
          {formatDate(r.from)} to {formatDate(r.to)}
        </p>
      </PageHeader>
      {reports ? <RangeForm csv="/api/reports/at-risk" /> : null}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {r.attendance ? (
          <Card>
            <CardHeader title={`Attendance under ${AT_RISK.below}%`} />
            {r.attendance.length ? (
              <BarList
                items={r.attendance.map((s) => ({
                  key: s.studentId,
                  label: s.name,
                  href: `/students/${s.studentId}`,
                  note: `${s.present + s.late} of ${s.present + s.late + s.absent} classes`,
                  value: `${s.percent ?? 0}%`,
                  fraction: (s.percent ?? 0) / 100,
                }))}
              />
            ) : (
              <p className="text-body text-muted-foreground">Nobody in the last {AT_RISK.days} days.</p>
            )}
          </Card>
        ) : null}
        {r.unpaid ? (
          <Card>
            <CardHeader title={`${AT_RISK.overdue} or more invoices overdue`} />
            {r.unpaid.length ? (
              <ul className="divide-y divide-neutral-100">
                {r.unpaid.map((s) => (
                  <li key={s.studentId}>
                    <Link href={`/students/${s.studentId}`} className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-neutral-50">
                      <span className="min-w-0">
                        <span className="block truncate text-body text-neutral-900">{s.name}</span>
                        <span className="block truncate text-caption text-muted-foreground">
                          {s.code} · {s.overdue} invoices overdue
                        </span>
                      </span>
                      <Money paise={s.owedPaise} className="shrink-0 text-body font-medium" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted-foreground">No family is that far behind.</p>
            )}
          </Card>
        ) : null}
      </div>
    </Gate>
  );
}
