import { PageHeader } from "@/components/page-header";
import { BarList, Columns } from "@/components/reports/bars";
import { pickRange, RangeForm } from "@/components/reports/range-form";
import { Gate } from "@/components/shell/gate";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { formatDate, formatDayMonth, formatMonthYear } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { listPrograms } from "@/modules/batches/repo";
import { formatPaise } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import { METHOD_LABEL } from "@/modules/payments/labels";
import type { PaymentMethod } from "@/modules/payments/schema";
import { type CollectionRegister, collectionBuckets, collectionRegister, thisMonth, type Total } from "@/modules/reports/service";

const receipts = (n: number) => `${n} ${n === 1 ? "receipt" : "receipts"}`;

function Totals({ title, rows, of, label = (k) => k }: { title: string; rows: Total[]; of: bigint; label?: (key: string) => string }) {
  return (
    <Card>
      <CardHeader title={title} />
      <BarList items={rows.map((t) => ({ key: t.key, label: label(t.key), note: String(t.count), value: formatPaise(t.totalPaise), fraction: of ? Number(t.totalPaise) / Number(of) : 0 }))} />
    </Card>
  );
}

// Each day opens that day's collection sheet; a month opens its own register.
function byDay(r: CollectionRegister) {
  const back = (from: string, to: string) => r.refunds.byDay.filter((t) => t.key >= from && t.key <= to).reduce((n, t) => n + t.totalPaise, 0n);
  const { unit, buckets } = collectionBuckets(r);
  return buckets.map((b) => {
    const when = unit === "day" ? formatDate(b.from) : formatMonthYear(b.from);
    return {
      key: b.from,
      tick: unit === "day" ? formatDayMonth(b.from) : formatMonthYear(b.from),
      tip: `${when} · ${formatPaise(b.totalPaise)} · ${receipts(b.count)}${back(b.from, b.to) > 0n ? ` · Refunded ${formatPaise(back(b.from, b.to))}` : ""}`,
      value: Number(b.totalPaise),
      valueText: formatPaise(b.totalPaise),
      href: unit === "day" ? `/finance/collections?period=all&from=${b.from}&to=${b.from}` : `/finance/reports/collection?from=${b.from}&to=${b.to}`,
    };
  });
}

// docs/03 §11: receipts by day, method and staff; a day's total equals its collection sheet.
export default async function CollectionReportPage({ searchParams }: PageProps<"/finance/reports/collection">) {
  const session = await requireStaffPage();
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  if (!allows(ctx, "reports:view")) return <Gate permission="reports:view">{null}</Gate>;
  const sp = await searchParams;
  const [r, programs] = await withTenant(session.tenant.id, async (tx) => {
    const programId = typeof sp.program === "string" && sp.program ? sp.program : undefined;
    return [await collectionRegister(tx, ctx, { ...pickRange(sp, await thisMonth(tx)), programId }), await listPrograms(tx)] as const;
  });
  const program = typeof sp.program === "string" ? sp.program : "";
  const qs = `from=${r.from}&to=${r.to}${program ? `&program=${program}` : ""}`;
  return (
    <Gate permission="reports:view">
      <PageHeader title="Collection register">
        <p className="text-caption text-muted-foreground">
          {receipts(r.total.count)} · {formatPaise(r.total.totalPaise)}
          {r.refunds.totalPaise > 0n ? ` · Refunded ${formatPaise(r.refunds.totalPaise)}` : ""}
        </p>
      </PageHeader>
      <RangeForm from={r.from} to={r.to} {...(allows(ctx, "reports:export") ? { csv: `/api/reports/collection?${qs}` } : {})}>
        <label className="flex flex-col gap-1 text-label">
          Program
          <select name="program" defaultValue={program} className="h-9 w-44 rounded-md border border-neutral-300 bg-white px-2 text-body">
            <option value="">All programs</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </RangeForm>
      <Card className="mb-5">
        <CardHeader title="By day" />
        <Columns label="Collected by day" columns={byDay(r)} />
      </Card>
      <div className="mb-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Totals title="By method" rows={r.byMethod} of={r.total.totalPaise} label={(k) => METHOD_LABEL[k as PaymentMethod]} />
        <Totals title="By staff" rows={r.byCollector} of={r.total.totalPaise} />
      </div>
      <Card className="overflow-x-auto p-0 md:p-0">
        <table className="w-full min-w-[40rem] text-body">
          <thead>
            <tr className="bg-neutral-50 text-left text-caption text-muted-foreground">
              <th className="px-4 py-2 font-medium">Day</th>
              <th className="py-2 font-medium">Receipt</th>
              <th className="py-2 font-medium">Payer</th>
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
                <td className="py-2">{p.billToName}</td>
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
