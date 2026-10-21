import { Download } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { AddDiscount, DiscountToggle, EndDiscount, UseAdvance } from "@/components/fees/discounts";
import { FilterBar } from "@/components/filter-bar";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { PagingFooter } from "@/components/paging-footer";
import { RangeForm } from "@/components/reports/range-form";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Gate } from "@/components/shell/gate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { formatDate } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { formatPaise } from "@/lib/money/format";
import { queryReader, withQuery } from "@/lib/url-query";
import { cn } from "@/lib/utils";
import { discountsPage } from "@/modules/fees/service";
import { advanceHeld } from "@/modules/payments/service";

const PATH = "/finance/discounts";
const PER_PAGE = 10;
const TABS = [["discounts", "Discounts"], ["given", "Given"], ["advance", "Advance"]] as const;
const dash = <span className="text-muted-foreground">—</span>;

type Col<T> = { head: string; cell: (r: T) => ReactNode; right?: boolean };

// A table from md up, cards below; one column list drives both.
function Rows<T>({ rows, cols, id }: { rows: T[]; cols: Col<T>[]; id: (r: T) => string }) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full">
          <thead>
            <tr className="bg-neutral-50 text-left text-caption text-muted-foreground">
              {cols.map((c) => (
                <th key={c.head} className={cn("px-4 py-2.5 font-medium", c.right && "text-right")}>
                  {c.head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={id(r)} className="border-t border-neutral-100 align-top">
                {cols.map((c) => (
                  <td key={c.head} className={cn("px-4 py-2.5 text-body", c.right && "text-right whitespace-nowrap")}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden">
        {rows.map((r) => (
          <li key={id(r)} className="border-t border-neutral-100 px-4 py-3 first:border-t-0">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-caption">
              {cols.map((c) => (
                <div key={c.head} className="min-w-0">
                  <dt className="text-muted-foreground">{c.head}</dt>
                  <dd className="text-body">{c.cell(r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

const csvButton = (href: string) => (
  <Button variant="outline" nativeButton={false} render={<a href={href} download />}>
    <Download data-icon="inline-start" /> Download CSV
  </Button>
);

export default async function DiscountsPage({ searchParams }: PageProps<"/finance/discounts">) {
  const read = queryReader(await searchParams);
  const tab = read.oneOf("tab", ["discounts", "given", "advance"] as const) ?? "discounts";
  const [state, q, owes, page] = [read.oneOf("state", ["running", "ended"] as const), read.one("q"), read.one("owes") === "1", read.page()];
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  const canRead = allows(ctx, "invoices:read");
  const canManagePlans = allows(ctx, "fee_plans:manage");
  if (!canRead && !canManagePlans) return <Gate permission="invoices:read">{null}</Gate>;
  const shownTabs = TABS.filter(([t]) => canRead || t === "discounts");
  const current = shownTabs.some(([t]) => t === tab) ? tab : "discounts";
  const range = { ...(read.day("from") ? { from: read.day("from") ?? "" } : {}), ...(read.day("to") ? { to: read.day("to") ?? "" } : {}) };
  const data = await withTenant(session.tenant.id, async (tx) => ({
    page: await discountsPage(tx, ctx, { tab: current, ...(state ? { state } : {}), ...(q ? { q } : {}), ...range }),
    holders: current === "advance" ? await advanceHeld(tx, ctx) : [],
  }));
  const { catalogue, given, lines, linesTotal, range: shown } = data.page;
  const csv = allows(ctx, "reports:export");
  const needle = q?.toLowerCase();
  const holders = data.holders.filter((h) => (!owes || h.owesPaise > 0n) && (!needle || h.name.toLowerCase().includes(needle) || h.children.some((c) => c.toLowerCase().includes(needle))));
  const paged = <T,>(xs: T[]) => xs.slice((Math.min(page, Math.max(1, Math.ceil(xs.length / PER_PAGE))) - 1) * PER_PAGE).slice(0, PER_PAGE);
  const pageHref = (p: number) => withQuery(PATH, new URLSearchParams({ tab: current, ...(state ? { state } : {}), ...(q ? { q } : {}), ...(owes ? { owes: "1" } : {}), ...(read.day("from") ? { from: read.day("from") ?? "" } : {}), ...(read.day("to") ? { to: read.day("to") ?? "" } : {}), page: String(p) }));
  const rows = current === "given" ? given : holders;
  const pageNo = Math.min(page, Math.max(1, Math.ceil(rows.length / PER_PAGE)));

  return (
    <Gate permission={canRead ? "invoices:read" : "fee_plans:manage"}>
      <PageHeader title="Discounts & credits" actions={current === "discounts" && canManagePlans ? <AddDiscount /> : undefined} />
      <SegmentedTabs label="Discounts and credits" items={shownTabs.map(([t, word]) => ({ href: withQuery(PATH, new URLSearchParams({ tab: t })), label: word, active: t === current }))} />

      {current === "discounts" ? (
        <Card>
          {catalogue.length ? (
            <ul className="divide-y divide-neutral-100">
              {catalogue.map((d) => (
                <li key={d.id} className="flex min-h-12 items-center justify-between gap-3">
                  <span className={cn("text-body", !d.isActive && "text-neutral-500")}>
                    {d.name} <span className="text-caption text-muted-foreground">· {d.kind === "percent" ? `${d.value}%` : formatPaise(BigInt(d.value))}</span>
                  </span>
                  {canManagePlans ? <DiscountToggle id={d.id} isActive={d.isActive} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-muted-foreground">None yet.</p>
          )}
        </Card>
      ) : null}

      {current === "given" ? (
        <div className="flex flex-col gap-5">
          <Card className="overflow-hidden p-0 md:p-0">
            <div className="p-4 md:p-5">
              <Suspense>
                <FilterBar
                  path={PATH}
                  search={{ placeholder: "Student or discount" }}
                  selects={[{ name: "state", label: "State", all: "Running and ended", options: [{ id: "running", name: "Running" }, { id: "ended", name: "Ended" }] }]}
                  dates={[]}
                />
              </Suspense>
            </div>
            {given.length ? (
              <>
                <Rows
                  rows={paged(given)}
                  id={(g) => g.id}
                  cols={[
                    { head: "Student", cell: (g) => <Link href={`/students/${g.studentId}`} className="font-medium text-neutral-900 hover:underline">{g.studentName}</Link> },
                    { head: "Discount", cell: (g) => `${g.name} · ${g.kind === "percent" ? `${g.value}%` : formatPaise(BigInt(g.value))}` },
                    { head: "Reason", cell: (g) => g.reason },
                    { head: "Dates", cell: (g) => (g.validTo ? `${formatDate(g.validFrom)} – ${formatDate(g.validTo)}` : `From ${formatDate(g.validFrom)}`) },
                    { head: "Approved by", cell: (g) => g.approvedByName ?? dash },
                    { head: "", right: true, cell: (g) => (g.running && allows(ctx, "invoices:manage") ? <EndDiscount id={g.id} /> : <span className="text-caption text-muted-foreground">{g.running ? "Running" : "Ended"}</span>) },
                  ]}
                />
                <PagingFooter page={pageNo} pageSize={PER_PAGE} shown={paged(given).length} matched={given.length} href={pageHref} />
              </>
            ) : (
              <EmptyState title="No discounts given" hint="Give one from a student's fees." />
            )}
          </Card>

          <RangeForm from={shown.from} to={shown.to} keep={{ tab: "given", ...(state ? { state } : {}), ...(q ? { q } : {}) }} {...(csv ? { csv: withQuery("/api/reports/discounts", new URLSearchParams(shown)) } : {})} />
          <Card className="overflow-hidden p-0 md:p-0">
            <div className="flex items-center justify-between gap-3 p-4 md:p-5">
              <h2 className="text-body font-medium">Taken off invoices</h2>
              <Money paise={linesTotal} className="text-body font-medium" />
            </div>
            {lines.length ? (
              <Rows
                rows={lines.slice(0, PER_PAGE)}
                id={(l) => `${l.invoiceId}-${l.description}-${l.discountPaise}`}
                cols={[
                  { head: "Invoice", cell: (l) => <Link href={`/finance/invoices/${l.invoiceId}`} className="font-medium text-neutral-900 hover:underline">{l.number ?? "Draft"}</Link> },
                  { head: "Issued", cell: (l) => formatDate(l.issueDate) },
                  { head: "Student", cell: (l) => l.studentName ?? dash },
                  { head: "Line", cell: (l) => l.description },
                  { head: "Reason", cell: (l) => l.discountNote ?? dash },
                  { head: "Discount", right: true, cell: (l) => <Money paise={l.discountPaise} /> },
                ]}
              />
            ) : (
              <EmptyState title="No discounts on invoices" hint="Pick another range." />
            )}
            {lines.length > PER_PAGE ? <p className="border-t border-neutral-100 px-4 py-3 text-caption text-muted-foreground">{lines.length - PER_PAGE} more in the CSV.</p> : null}
          </Card>
        </div>
      ) : null}

      {current === "advance" ? (
        <Card className="overflow-hidden p-0 md:p-0">
          <div className="flex flex-wrap items-end gap-3 p-4 md:p-5">
            <div className="min-w-0 flex-1">
              <Suspense>
                <FilterBar path={PATH} search={{ placeholder: "Payer or student" }} selects={[{ name: "owes", label: "Owing", all: "All payers", options: [{ id: "1", name: "Owing now" }] }]} dates={[]} />
              </Suspense>
            </div>
            {csv ? csvButton(withQuery("/api/reports/advance", new URLSearchParams(owes ? { owes: "1" } : {}))) : null}
          </div>
          {holders.length ? (
            <>
              <Rows
                rows={paged(holders)}
                id={(h) => `${h.payerKey}-${h.branchId}`}
                cols={[
                  { head: "Payer", cell: (h) => <><span className="block font-medium text-neutral-900">{h.name}</span><span className="block text-caption text-muted-foreground">{h.children.join(", ")}</span></> },
                  { head: "Branch", cell: (h) => h.branchName },
                  { head: "Advance", cell: (h) => <Money paise={h.advancePaise} className="font-medium" /> },
                  { head: "Since", cell: (h) => formatDate(h.since) },
                  { head: "Owes", cell: (h) => (h.owesPaise > 0n ? <Money paise={h.owesPaise} className="text-warning-700" /> : dash) },
                  { head: "", right: true, cell: (h) => (h.owesPaise > 0n && allows(ctx, "fees:collect") ? <UseAdvance branchId={h.branchId} payerKey={h.payerKey} /> : null) },
                ]}
              />
              <PagingFooter page={pageNo} pageSize={PER_PAGE} shown={paged(holders).length} matched={holders.length} href={pageHref} />
            </>
          ) : (
            <EmptyState title="No advance held" hint="Money paid ahead of an invoice shows here." />
          )}
        </Card>
      ) : null}
    </Gate>
  );
}
