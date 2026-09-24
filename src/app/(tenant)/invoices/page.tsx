import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { GenerateNow, IssueInvoices } from "@/components/fees/invoice-actions";
import { InvoiceStatus } from "@/components/fees/invoice-status";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { Gate } from "@/components/shell/gate";
import { Card } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { formatDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money/format";
import { isOverdue } from "@/modules/fees/billing";
import { INVOICE_VIEWS, type InvoiceView } from "@/modules/fees/repo";
import { invoiceList } from "@/modules/fees/service";

const TABS: Record<InvoiceView, [string, string]> = {
  draft: ["To review", "New charges land here after the nightly run."],
  unpaid: ["Unpaid", "Nothing waiting to be paid."],
  overdue: ["Overdue", "Nothing past its due date."],
  month: ["This month", "Nothing issued this month."],
  void: ["Void", "Nothing voided."],
};

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "invoices:read")) return <Gate permission="invoices:read">{null}</Gate>;
  const sp = await searchParams;
  const asked = INVOICE_VIEWS.find((v) => v === sp.view);
  // Drafts first when there are some; otherwise what's unpaid.
  const data = await withTenant(session.tenant.id, async (tx) => {
    const first = await invoiceList(tx, ctx, asked ?? "draft");
    return asked || first.drafts.count ? { view: asked ?? ("draft" as const), ...first } : { view: "unpaid" as const, ...(await invoiceList(tx, ctx, "unpaid")) };
  });
  const canManage = allows(ctx, "invoices:manage");

  return (
    <Gate permission="invoices:read">
      <PageHeader title="Invoices" actions={canManage ? <GenerateNow /> : undefined} />
      <SegmentedTabs
        label="Invoices"
        items={INVOICE_VIEWS.map((v) => ({ href: `/invoices?view=${v}`, label: v === "draft" && data.drafts.count ? `${TABS[v][0]} · ${data.drafts.count}` : TABS[v][0], active: v === data.view }))}
      />
      {data.view === "draft" && data.drafts.count ? (
        <Card className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-display">
              <Money paise={data.drafts.total} />
            </p>
            <p className="text-caption text-muted-foreground">
              {data.drafts.count} {data.drafts.count === 1 ? "draft" : "drafts"} · numbers are given on issue
            </p>
          </div>
          {canManage ? <IssueInvoices ids="all" count={data.drafts.count} total={formatPaise(data.drafts.total)} /> : null}
        </Card>
      ) : null}
      <Card className="overflow-hidden p-0 md:p-0">
        {data.invoices.length ? (
          <ul className="divide-y divide-neutral-100">
            {data.invoices.map((i) => (
              <li key={i.id}>
                <Link href={`/invoices/${i.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-neutral-50 md:px-5">
                  <span className="min-w-0">
                    <span className="block truncate text-body font-medium text-neutral-900">{i.householdName}</span>
                    <span className="block truncate text-caption text-muted-foreground">{[i.number ?? "Draft", i.students.join(", "), `due ${formatDate(i.dueDate)}`].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Money paise={i.totalPaise} className="text-body font-medium" />
                    <InvoiceStatus status={i.status} overdue={isOverdue(i, data.today)} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={`Nothing in ${TABS[data.view][0]}`} hint={TABS[data.view][1]} />
        )}
      </Card>
    </Gate>
  );
}
