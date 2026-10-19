import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { GenerateNow, IssueInvoices } from "@/components/fees/invoice-actions";
import { STATUS_WORD } from "@/components/fees/invoice-status";
import { InvoiceTable } from "@/components/fees/invoice-table";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Gate } from "@/components/shell/gate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { formatPaise } from "@/lib/money/format";
import { DISPLAY_STATUSES } from "@/modules/fees/billing";
import { type InvoiceStatusFilter, invoiceParams, parseInvoiceQuery } from "@/modules/fees/invoice-query";
import { invoiceList } from "@/modules/fees/service";

const PATH = "/finance/invoices";
const TABS = ["all", ...DISPLAY_STATUSES] as const;
const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "amount", label: "Highest amount" },
  { value: "due", label: "Soonest due" },
];
// Shown when a tab holds nothing and no filter is on.
const EMPTY: Record<InvoiceStatusFilter, [string, string]> = {
  all: ["No invoices yet", "New charges land here after the nightly run."],
  draft: ["No drafts", "New charges land here after the nightly run."],
  due: ["Nothing due", "Nothing waiting to be paid."],
  part_paid: ["No part payments", "Invoices with some money paid show here."],
  overdue: ["Nothing overdue", "Nothing past its due date."],
  paid: ["Nothing paid yet", "Invoices paid in full show here."],
  cancelled: ["Nothing cancelled", "Cancelled invoices show here."],
  open: ["Nothing open", "Nothing waiting to be paid."],
};

export default async function InvoicesPage({ searchParams }: PageProps<"/finance/invoices">) {
  const query = parseInvoiceQuery(await searchParams);
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "invoices:read")) return <Gate permission="invoices:read">{null}</Gate>;
  const list = await withTenant(session.tenant.id, (tx) => invoiceList(tx, ctx, query));
  const canManage = allows(ctx, "invoices:manage");
  const { applied, counts, drafts } = list;
  const href = (params: URLSearchParams) => (params.size ? `${PATH}?${params.toString()}` : PATH);
  const first = (list.page - 1) * list.pageSize + 1;
  const last = first + list.rows.length - 1;
  const filtered = Boolean(applied.q || applied.programId || applied.batchId || applied.issuedFrom || applied.issuedTo || applied.dueFrom || applied.dueTo);
  const showDrafts = drafts.count > 0 && (applied.status === "all" || applied.status === "draft");
  const [emptyTitle, emptyHint] = filtered ? ["No invoice matches", "Change the filters or clear them."] : EMPTY[applied.status];

  return (
    <Gate permission="invoices:read">
      <PageHeader title="Invoices" actions={canManage ? <GenerateNow /> : undefined} />
      <SegmentedTabs
        label="Invoices"
        items={TABS.map((status) => ({
          href: href(invoiceParams({ ...applied, status })),
          label: `${status === "all" ? "All" : STATUS_WORD[status]} · ${counts[status]}`,
          active: status === applied.status,
        }))}
      />
      {showDrafts ? (
        <Card className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-display">
              <Money paise={drafts.total} />
            </p>
            <p className="text-caption text-muted-foreground">
              {drafts.count} {drafts.count === 1 ? "draft" : "drafts"} · numbers are given on issue
            </p>
          </div>
          {canManage ? <IssueInvoices ids="all" count={drafts.count} total={formatPaise(drafts.total)} /> : null}
        </Card>
      ) : null}
      <Card className="overflow-hidden p-0 md:p-0">
        <div className="p-4 md:p-5">
          <Suspense>
            <FilterBar
              path={PATH}
              search={{ placeholder: "Invoice, student or payer" }}
              selects={[
                { name: "program", label: "Program", all: "All programs", options: list.options.programs },
                { name: "batch", label: "Batch", all: "All batches", options: list.options.batches },
              ]}
              dates={[
                { name: "issuedFrom", label: "Issued from" },
                { name: "issuedTo", label: "Issued to" },
                { name: "dueFrom", label: "Due from" },
                { name: "dueTo", label: "Due to" },
              ]}
              sorts={SORTS}
            />
          </Suspense>
        </div>
        {list.rows.length === 0 ? (
          <EmptyState title={emptyTitle} hint={emptyHint} />
        ) : (
          <>
            <InvoiceTable rows={list.rows} />
            <div className="flex items-center justify-between gap-3 border-t border-neutral-100 px-4 py-3 text-caption text-muted-foreground md:px-5">
              <span className="tabular-nums">
                {first}–{last} of {list.matched}
              </span>
              <span className="flex gap-2">
                {list.page > 1 ? (
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href(invoiceParams(applied, list.page - 1))} />}>
                    Previous
                  </Button>
                ) : null}
                {last < list.matched ? (
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href(invoiceParams(applied, list.page + 1))} />}>
                    Next
                  </Button>
                ) : null}
              </span>
            </div>
          </>
        )}
      </Card>
    </Gate>
  );
}
