import Link from "next/link";
import { notFound } from "next/navigation";
import { IssueInvoices, VoidInvoice } from "@/components/fees/invoice-actions";
import { InvoiceStatus } from "@/components/fees/invoice-status";
import { InvoiceFacts, InvoiceLines } from "@/components/fees/invoice-view";
import { Composer } from "@/components/messaging/composer";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { Gate } from "@/components/shell/gate";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { formatDate } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { formatPaise } from "@/lib/money/format";
import { invoiceDetail } from "@/modules/fees/service";
import { invoiceReceipts } from "@/modules/payments/service";
import { razorpayConnected } from "@/modules/integrations/service";
import { PaymentLink } from "@/components/payments/payment-link";

export default async function InvoicePage({ params, searchParams }: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  const openVoid = (await searchParams).void === "1"; // straight from the leave screens
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "invoices:read")) return <Gate permission="invoices:read">{null}</Gate>;
  const d = await withTenant(session.tenant.id, async (tx) => ({ ...(await invoiceDetail(tx, ctx, id)), receipts: await invoiceReceipts(tx, ctx, id), online: await razorpayConnected(tx) })).catch((e: unknown) => {
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
        crumbs={[{ label: "Invoices", href: "/invoices" }]}
        actions={
          canManage || canCollect || canRemind ? (
            <>
              {canCollect ? (
                <Button nativeButton={false} render={<Link href={`/payments/new?invoice=${inv.id}`} />}>
                  Collect
                </Button>
              ) : null}
              {canCollect && d.online ? <PaymentLink invoiceId={inv.id} /> : null}
              {canRemind ? <Composer request={{ key: d.overdue ? "fee_overdue" : "fee_due", invoiceId: inv.id }} label="Remind" /> : null}
              {canManage && draft ? <IssueInvoices ids={[inv.id]} count={1} total={formatPaise(inv.totalPaise)} /> : null}
              {canManage ? <VoidInvoice id={inv.id} draft={draft} open={openVoid} {...(inv.paidPaise > 0n ? { paid: formatPaise(inv.paidPaise) } : {})} /> : null}
            </>
          ) : undefined
        }
      >
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <InvoiceStatus status={inv.status} overdue={d.overdue} />
          <span className="text-caption text-muted-foreground">{d.householdName}</span>
        </div>
      </PageHeader>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
        <Card>
          <InvoiceLines d={d} />
          {d.receipts.length ? (
            <>
              <CardHeader title="Paid" className="mt-5" />
              <ul className="divide-y divide-neutral-100">
                {d.receipts.map((r) => (
                  <li key={r.paymentId} className="flex min-h-12 items-center justify-between gap-3">
                    {receiptLinks ? (
                      <Link href={`/payments/${r.paymentId}`} className="text-body tabular-nums text-accent-600 hover:underline">
                        {r.receiptNumber}
                      </Link>
                    ) : (
                      <span className="text-body tabular-nums">{r.receiptNumber}</span>
                    )}
                    <span className="text-caption text-muted-foreground">{formatDate(r.receivedOn)}</span>
                    <Money paise={r.net} className="text-body" />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>
        <Card>
          <InvoiceFacts d={d} />
        </Card>
      </div>
    </Gate>
  );
}
