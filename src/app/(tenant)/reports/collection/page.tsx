import { PageHeader } from "@/components/page-header";
import { pickRange, RangeForm } from "@/components/reports/range-form";
import { Gate } from "@/components/shell/gate";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { formatDate } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { formatPaise } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import { METHOD_LABEL } from "@/modules/payments/labels";
import type { PaymentMethod } from "@/modules/payments/schema";
import { collectionRegister, thisMonth, type Total } from "@/modules/reports/service";

function Totals({ title, rows, label = (k) => k }: { title: string; rows: Total[]; label?: (key: string) => string }) {
  return (
    <Card>
      <CardHeader title={title} />
      <ul className="divide-y divide-neutral-100">
        {rows.map((t) => (
          <li key={t.key} className="flex min-h-11 items-center justify-between gap-3 text-body">
            <span>
              {label(t.key)} <span className="text-caption text-muted-foreground">· {t.count}</span>
            </span>
            <span className="tabular-nums">{formatPaise(t.totalPaise)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// docs/03 §11: receipts by day, method and staff; a day's total equals its collection sheet.
export default async function CollectionReportPage({ searchParams }: PageProps<"/reports/collection">) {
  const session = await requireStaffPage();
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  if (!allows(ctx, "reports:view")) return <Gate permission="reports:view">{null}</Gate>;
  const sp = await searchParams;
  const r = await withTenant(session.tenant.id, async (tx) => collectionRegister(tx, ctx, pickRange(sp, await thisMonth(tx))));
  return (
    <Gate permission="reports:view">
      <PageHeader title="Collection register" crumbs={[{ href: "/reports", label: "Reports" }]}>
        <p className="text-caption text-muted-foreground">
          {r.total.count} receipts · {formatPaise(r.total.totalPaise)}
        </p>
      </PageHeader>
      <RangeForm from={r.from} to={r.to} csv={`/api/reports/collection?from=${r.from}&to=${r.to}`} />
      <div className="mb-5 grid items-start gap-5 lg:grid-cols-3">
        <Totals title="By method" rows={r.byMethod} label={(k) => METHOD_LABEL[k as PaymentMethod]} />
        <Totals title="By staff" rows={r.byCollector} />
        <Totals title="By day" rows={r.byDay} label={formatDate} />
      </div>
      <Card className="overflow-x-auto p-0 md:p-0">
        <table className="w-full min-w-[40rem] text-body">
          <thead>
            <tr className="bg-neutral-50 text-left text-caption uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Day</th>
              <th className="py-2 font-medium">Receipt</th>
              <th className="py-2 font-medium">Family</th>
              <th className="py-2 font-medium">Method</th>
              <th className="py-2 font-medium">By</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((p) => (
              <tr key={p.id} className={cn("border-t border-neutral-100", p.status === "cancelled" && "text-muted-foreground line-through")}>
                <td className="px-4 py-2">{formatDate(p.recordedOn)}</td>
                <td className="py-2 tabular-nums">{p.receiptNumber}</td>
                <td className="py-2">{p.householdName}</td>
                <td className="py-2">{METHOD_LABEL[p.method]}</td>
                <td className="py-2">{p.collectorName ?? "Online"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatPaise(p.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.rows.length ? null : <p className="p-6 text-center text-body text-muted-foreground">No receipts in these dates.</p>}
      </Card>
    </Gate>
  );
}
