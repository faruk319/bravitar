import { notFound } from "next/navigation";
import { Money } from "@/components/money";
import { Composer } from "@/components/messaging/composer";
import { PageHeader } from "@/components/page-header";
import { METHOD_LABEL } from "@/modules/payments/labels";
import { CancelPayment, PrintReceipt, RefundPayment } from "@/components/payments/payment-actions";
import { ReceiptCard } from "@/components/payments/receipt-card";
import { Gate } from "@/components/shell/gate";
import { Card, CardHeader } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { formatDate } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { formatPaise } from "@/lib/money/format";
import { paymentState, receipt } from "@/modules/payments/service";

// The receipt as it was recorded (docs/03 §9): printed by the browser, which can
// also save it as a PDF. Refunds and cancelling happen here but never change it.
export default async function PaymentPage({ params }: PageProps<"/payments/[id]">) {
  const { id } = await params;
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  const permission = allows(ctx, "payments:read") ? "payments:read" : "fees:collect";
  if (!allows(ctx, permission)) return <Gate permission="payments:read">{null}</Gate>;
  const d = await withTenant(session.tenant.id, async (tx) => ({ r: await receipt(tx, ctx, id), state: await paymentState(tx, ctx, id) })).catch((e: unknown) => {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  });
  if (!d) notFound();
  const { r, state } = d;
  const p = r.payment;
  const cancelled = p.status === "cancelled";
  // Agreed 2026-09-25: online payments are refunded in Razorpay and show up here by themselves.
  const online = p.method === "online";
  const canCancel = !online && allows(ctx, "fees:collect") && p.status === "confirmed" && p.recordedOn === state.today && !state.refunds.length && (p.receivedBy === session.actor.id || allows(ctx, "fees:refund"));
  const canRefund = !online && allows(ctx, "fees:refund") && state.refundablePaise > 0n;
  const invoiceLinks = allows(ctx, "invoices:read");

  return (
    <Gate permission={permission}>
      <div className="print:hidden">
        <PageHeader
          title={p.receiptNumber}
          crumbs={allows(ctx, "payments:read") ? [{ label: "Collection", href: `/payments?day=${p.recordedOn}` }] : [{ label: "Collect payment", href: "/payments/new" }]}
          actions={
            <>
              <PrintReceipt />
              {allows(ctx, "messages:send") && !cancelled ? <Composer request={{ key: "receipt", paymentId: p.id }} label="Send receipt" /> : null}
              {canRefund ? <RefundPayment id={p.id} left={String(state.refundablePaise)} invoices={state.onInvoices.map((i) => ({ id: i.invoiceId, label: `${i.number ?? "Invoice"} · ${formatPaise(i.net)}` }))} /> : null}
              {canCancel ? <CancelPayment id={p.id} receiptNumber={p.receiptNumber} /> : null}
            </>
          }
        />
      </div>

      {online && state.refundablePaise > 0n && allows(ctx, "fees:refund") ? (
        <p className="mx-auto mb-3 max-w-xl text-caption text-muted-foreground print:hidden">Paid online through Razorpay. To refund it, use your Razorpay dashboard; the refund shows here by itself.</p>
      ) : null}
      <ReceiptCard r={r} {...(invoiceLinks ? { invoiceHref: (id: string) => `/invoices/${id}` } : {})} />

      {state.refunds.length ? (
        <Card className="mx-auto mt-5 max-w-xl print:hidden">
          <CardHeader title="Refunds" />
          <ul className="divide-y divide-neutral-100">
            {state.refunds.map((f) => (
              <li key={f.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
                <span>
                  <span className="block text-body">{f.reason}</span>
                  <span className="block text-caption text-muted-foreground">
                    {formatDate(f.refundedOn)} · {METHOD_LABEL[f.method]}
                    {f.reference ? ` · ${f.reference}` : ""}
                  </span>
                </span>
                <Money paise={-f.amountPaise} className="text-body" />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </Gate>
  );
}
