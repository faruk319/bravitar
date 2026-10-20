import Link from "next/link";
import { notFound } from "next/navigation";
import { IssueInvoices, VoidInvoice } from "@/components/fees/invoice-actions";
import { InvoiceStatus } from "@/components/fees/invoice-status";
import { InvoiceFacts, InvoiceLines, MoneyHistory } from "@/components/fees/invoice-view";
import { Composer } from "@/components/messaging/composer";
import { PageHeader } from "@/components/page-header";
import { PrintButton } from "@/components/payments/payment-actions";
import { Gate } from "@/components/shell/gate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { NotFoundError } from "@/lib/errors";
import { formatPaise } from "@/lib/money/format";
import { handmade, invoiceDetail } from "@/modules/fees/service";
import { invoiceMoney } from "@/modules/payments/service";
import { razorpayConnected } from "@/modules/integrations/service";
import { PaymentLink } from "@/components/payments/payment-link";

// Printed or saved as a PDF by the browser: the shell hides itself, the buttons go, and the facts come first on paper.
export default async function InvoicePage({ params, searchParams }: PageProps<"/finance/invoices/[id]">) {
  const { id } = await params;
  const openVoid = (await searchParams).void === "1"; // straight from the leave screens
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "invoices:read")) return <Gate permission="invoices:read">{null}</Gate>;
  const d = await withTenant(session.tenant.id, async (tx) => ({ ...(await invoiceDetail(tx, ctx, id)), money: await invoiceMoney(tx, ctx, id), online: await razorpayConnected(tx) })).catch((e: unknown) => {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  });
  if (!d) notFound();
  const inv = d.invoice;
  const draft = inv.status === "draft";
  const canManage = allows(ctx, "invoices:manage") && inv.status !== "void";
  const canCollect = allows(ctx, "fees:collect") && (inv.status === "issued" || inv.status === "part_paid");
  const receiptLinks = allows(ctx, "payments:read") || allows(ctx, "fees:collect");
  const canRemind = allows(ctx, "messages:send") && (inv.status === "issued" || inv.status === "part_paid");

  return (
    <Gate permission="invoices:read">
      <PageHeader
        title={inv.number ?? "Draft invoice"}
        entity
        actions={
          <>
            {canCollect ? (
              <Button nativeButton={false} render={<Link href={`/finance/collections?collect=1&invoice=${inv.id}`} />}>
                Collect
              </Button>
            ) : null}
            {canCollect && d.online ? <PaymentLink invoiceId={inv.id} /> : null}
            {canRemind ? <Composer request={{ key: d.overdue ? "fee_overdue" : "fee_due", invoiceId: inv.id }} label="Remind" /> : null}
            {canManage && draft && handmade(d.lines) ? (
              <Button variant="outline" nativeButton={false} render={<Link href={`/finance/invoices?edit=${inv.id}`} />}>
                Edit
              </Button>
            ) : null}
            {canManage && draft ? <IssueInvoices ids={[inv.id]} count={1} total={formatPaise(inv.totalPaise)} /> : null}
            <PrintButton label="Print / Save PDF" />
            {canManage ? <VoidInvoice id={inv.id} draft={draft} open={openVoid} {...(inv.paidPaise > 0n ? { paid: formatPaise(inv.paidPaise) } : {})} /> : null}
          </>
        }
      >
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <InvoiceStatus status={d.display} />
          <span className="text-caption text-muted-foreground">{d.billToName}</span>
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_320px] print:grid-cols-1">
        <Card className="print:border-0 print:p-0 print:shadow-none">
          <InvoiceLines d={d} />
          <MoneyHistory rows={d.money} timeZone={session.tenant.timezone} {...(receiptLinks ? { receiptHref: (paymentId: string) => `/finance/collections/${paymentId}` } : {})} />
        </Card>
        <Card className="print:order-first print:border-0 print:p-0 print:shadow-none">
          <InvoiceFacts d={d} />
        </Card>
      </div>
    </Gate>
  );
}
