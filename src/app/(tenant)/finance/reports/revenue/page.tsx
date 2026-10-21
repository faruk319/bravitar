import { PageHeader } from "@/components/page-header";
import { pickRange, RangeForm } from "@/components/reports/range-form";
import { Gate } from "@/components/shell/gate";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage, selectedBranchIds } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { formatPaise } from "@/lib/money/format";
import type { Paise } from "@/lib/money/paise";
import { liveModules } from "@/modules/billing/repo";
import { type RevenueRow, revenueReport, thisMonth } from "@/modules/reports/service";

type Line = { key: string; label: string; note?: string; billedPaise: Paise; collectedPaise: Paise; outstandingPaise: Paise };
type Cols = { billed: boolean; collected: boolean };

// Rows added up under a key: the activity, the program, or the program's batch.
function group(rows: RevenueRow[], by: (r: RevenueRow) => { key: string; label: string; note?: string }): Line[] {
  const out = new Map<string, Line>();
  for (const r of rows) {
    const g = by(r);
    const t = out.get(g.key) ?? { ...g, billedPaise: 0n, collectedPaise: 0n, outstandingPaise: 0n };
    out.set(g.key, { ...t, billedPaise: t.billedPaise + r.billedPaise, collectedPaise: t.collectedPaise + r.collectedPaise, outstandingPaise: t.outstandingPaise + r.outstandingPaise });
  }
  return [...out.values()];
}

// Billed and outstanding come with invoices:read, collected with payments:read.
function Lines({ title, lines, cols, advance }: { title: string; lines: Line[]; cols: Cols; advance?: Paise }) {
  const shown = [
    ...(cols.billed ? [["Billed", (l: Line) => l.billedPaise] as const] : []),
    ...(cols.collected ? [["Collected", (l: Line) => l.collectedPaise] as const] : []),
    ...(cols.billed ? [["Outstanding", (l: Line) => l.outstandingPaise] as const] : []),
  ];
  const showAdvance = advance !== undefined && cols.collected;
  return (
    <Card className="mb-5 p-0 md:p-0">
      <CardHeader title={title} className="mb-0 px-4 pt-4" />
      <table className="hidden w-full text-body md:table">
        <thead>
          <tr className="bg-neutral-50 text-left text-caption text-muted-foreground">
            <th className="px-4 py-2 font-medium">{title.replace("By ", "").replace(/^./, (c) => c.toUpperCase())}</th>
            {shown.map(([name]) => (
              <th key={name} className="px-4 py-2 text-right font-medium">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key} className="border-t border-neutral-100">
              <td className="px-4 py-2">
                {l.label}
                {l.note ? <span className="text-caption text-muted-foreground"> · {l.note}</span> : null}
              </td>
              {shown.map(([name, of]) => (
                <td key={name} className="px-4 py-2 text-right tabular-nums">
                  {formatPaise(of(l))}
                </td>
              ))}
            </tr>
          ))}
          {showAdvance ? (
            <tr className="border-t border-neutral-100">
              <td className="px-4 py-2">Advance</td>
              {shown.map(([name]) => (
                <td key={name} className="px-4 py-2 text-right tabular-nums">
                  {name === "Collected" ? formatPaise(advance) : "—"}
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
      <ul className="divide-y divide-neutral-100 md:hidden">
        {lines.map((l) => (
          <li key={l.key} className="px-4 py-3">
            <span className="block text-body font-medium">
              {l.label}
              {l.note ? <span className="text-caption font-normal text-muted-foreground"> · {l.note}</span> : null}
            </span>
            <span className="mt-1 flex flex-wrap gap-x-4 text-caption text-muted-foreground">
              {shown.map(([name, of]) => (
                <span key={name}>
                  {name} <span className="tabular-nums text-neutral-900">{formatPaise(of(l))}</span>
                </span>
              ))}
            </span>
          </li>
        ))}
        {showAdvance ? (
          <li className="flex justify-between px-4 py-3 text-body">
            <span>Advance</span>
            <span className="tabular-nums">{formatPaise(advance)}</span>
          </li>
        ) : null}
      </ul>
      {lines.length ? null : <p className="p-6 text-center text-body text-muted-foreground">Nothing in these dates.</p>}
    </Card>
  );
}

// Billed, collected and outstanding by activity, program and batch; programs plus advance add up to the collection.
export default async function RevenueReportPage({ searchParams }: PageProps<"/finance/reports/revenue">) {
  const session = await requireStaffPage();
  const ctx = { ...scopedCtx(session), branchIds: await selectedBranchIds(session) };
  if (!allows(ctx, "reports:view")) return <Gate permission="reports:view">{null}</Gate>;
  if (!allows(ctx, "payments:read") && !allows(ctx, "invoices:read")) return <Gate permission="invoices:read">{null}</Gate>;
  const sp = await searchParams;
  const [r, modules] = await withTenant(session.tenant.id, async (tx) => [await revenueReport(tx, ctx, pickRange(sp, await thisMonth(tx))), await liveModules(tx)] as const);
  const names = new Map(modules.map((m) => [m.key, m.name]));
  const cols = { billed: allows(ctx, "invoices:read"), collected: allows(ctx, "payments:read") };
  return (
    <Gate permission="reports:view">
      <PageHeader title="Revenue" />
      <RangeForm from={r.from} to={r.to} {...(allows(ctx, "reports:export") ? { csv: `/api/reports/revenue?from=${r.from}&to=${r.to}` } : {})} />
      <Lines title="By activity" lines={group(r.rows, (x) => ({ key: x.activityKey, label: names.get(x.activityKey) ?? (x.activityKey || x.programName) }))} cols={cols} />
      <Lines title="By program" lines={group(r.rows, (x) => ({ key: x.programId ?? "", label: x.programName }))} cols={cols} advance={r.advancePaise} />
      <Lines title="By batch" lines={group(r.rows, (x) => ({ key: `${x.programId ?? ""}|${x.batchId ?? ""}`, label: x.batchName ?? x.programName, ...(x.batchName ? { note: x.programName } : {}) }))} cols={cols} />
    </Gate>
  );
}
