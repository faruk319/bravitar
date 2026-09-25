import { PageHeader } from "@/components/page-header";
import { RangeForm } from "@/components/reports/range-form";
import { Gate } from "@/components/shell/gate";
import { Card } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { formatDate } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { formatPaise } from "@/lib/money/format";
import { outstandingDues } from "@/modules/reports/service";

const COLUMNS = [
  ["notDue", "Not yet due"],
  ["days0to30", "0–30 days"],
  ["days31to60", "31–60 days"],
  ["over60", "Over 60 days"],
] as const;
const cell = (p: bigint) => (p ? formatPaise(p) : "—");

// docs/03 §11: what each family owes now, aged by days past the due date (agreed 2026-09-25).
export default async function DuesReportPage() {
  const session = await requireStaffPage();
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  if (!allows(ctx, "reports:view")) return <Gate permission="reports:view">{null}</Gate>;
  const r = await withTenant(session.tenant.id, (tx) => outstandingDues(tx, ctx));
  const t = r.totals;
  return (
    <Gate permission="reports:view">
      <PageHeader title="Outstanding dues" crumbs={[{ href: "/reports", label: "Reports" }]}>
        <p className="text-caption text-muted-foreground">As of {formatDate(r.asOf)}, by days past the due date</p>
      </PageHeader>
      <RangeForm csv="/api/reports/dues" />
      <Card className="overflow-x-auto p-0 md:p-0">
        <table className="w-full min-w-[40rem] text-body">
          <thead>
            <tr className="bg-neutral-50 text-left text-caption uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Family</th>
              {COLUMNS.map(([k, label]) => (
                <th key={k} className="py-2 pr-4 text-right font-medium">
                  {label}
                </th>
              ))}
              <th className="px-4 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {r.families.map((f) => (
              <tr key={f.householdId} className="border-t border-neutral-100">
                <td className="px-4 py-2">
                  {f.name}
                  <span className="text-caption text-muted-foreground"> · {f.invoices}</span>
                </td>
                {COLUMNS.map(([k]) => (
                  <td key={k} className="py-2 pr-4 text-right tabular-nums">
                    {cell(f[k])}
                  </td>
                ))}
                <td className="px-4 py-2 text-right font-medium tabular-nums">{formatPaise(f.notDue + f.days0to30 + f.days31to60 + f.over60)}</td>
              </tr>
            ))}
            <tr className="border-t border-neutral-200 font-medium">
              <td className="px-4 py-2">Total</td>
              {COLUMNS.map(([k]) => (
                <td key={k} className="py-2 pr-4 text-right tabular-nums">
                  {cell(t[k])}
                </td>
              ))}
              <td className="px-4 py-2 text-right tabular-nums">{formatPaise(t.notDue + t.days0to30 + t.days31to60 + t.over60)}</td>
            </tr>
          </tbody>
        </table>
        {r.families.length ? null : <p className="p-6 text-center text-body text-muted-foreground">Nothing owed.</p>}
      </Card>
    </Gate>
  );
}
