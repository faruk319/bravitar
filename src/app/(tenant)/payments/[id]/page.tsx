import Link from "next/link";
import { notFound } from "next/navigation";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { METHOD_LABEL } from "@/components/payments/method-label";
import { CancelPayment, PrintReceipt, RefundPayment } from "@/components/payments/payment-actions";
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

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="text-right text-body">{children}</dd>
    </div>
  );
}

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
              {canRefund ? <RefundPayment id={p.id} left={String(state.refundablePaise)} invoices={state.onInvoices.map((i) => ({ id: i.invoiceId, label: `${i.number ?? "Invoice"} · ${formatPaise(i.net)}` }))} /> : null}
              {canCancel ? <CancelPayment id={p.id} receiptNumber={p.receiptNumber} /> : null}
            </>
          }
        />
      </div>

      {online && state.refundablePaise > 0n && allows(ctx, "fees:refund") ? (
        <p className="mx-auto mb-3 max-w-xl text-caption text-muted-foreground print:hidden">Paid online through Razorpay. To refund it, use your Razorpay dashboard; the refund shows here by itself.</p>
      ) : null}
      <Card className="mx-auto max-w-xl print:max-w-none print:border-0 print:p-0 print:shadow-none">
        {cancelled ? (
          <p role="status" className="mb-4 rounded-lg border border-danger-600 px-3 py-2 text-center text-label text-danger-600">
            ✗ Cancelled · {p.cancelReason}
          </p>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 pb-3">
          <div className="min-w-0">
            <p className="text-heading">{r.academy.name}</p>
            <p className="text-caption text-muted-foreground">{[r.academy.branch, r.academy.address].filter(Boolean).join(" · ")}</p>
            {r.academy.gstin ? <p className="text-caption tabular-nums">GSTIN {r.academy.gstin}</p> : null}
          </div>
          <div className="text-right">
            <p className="text-caption uppercase tracking-wide text-muted-foreground">Receipt</p>
            <p className="text-body font-medium tabular-nums">{p.receiptNumber}</p>
            <p className="text-caption text-muted-foreground">{formatDate(p.receivedOn)}</p>
          </div>
        </div>

        <dl className="divide-y divide-neutral-100">
          <Fact label="Received from">{r.householdName}</Fact>
          <Fact label="Amount">
            <Money paise={p.amountPaise} className="text-number" />
          </Fact>
          <Fact label="Paid by">{[METHOD_LABEL[p.method], p.reference].filter(Boolean).join(" · ")}</Fact>
          {p.recordedOn !== p.receivedOn ? <Fact label="Recorded on">{formatDate(p.recordedOn)}</Fact> : null}
          <Fact label="Received by">{r.collectorName ?? "Online"}</Fact>
        </dl>

        <h2 className="mt-4 text-label text-muted-foreground">Towards</h2>
        <ul className="mt-1 divide-y divide-neutral-100">
          {r.lines.map((l) => (
            <li key={l.invoiceId} className="flex min-h-11 items-center justify-between gap-3">
              {invoiceLinks ? (
                <Link href={`/invoices/${l.invoiceId}`} className="text-body tabular-nums text-accent-600 hover:underline print:text-neutral-900">
                  {l.number}
                </Link>
              ) : (
                <span className="text-body tabular-nums">{l.number}</span>
              )}
              <Money paise={l.amountPaise} className="text-body" />
            </li>
          ))}
          {r.advancePaise > 0n ? (
            <li className="flex min-h-11 items-center justify-between gap-3">
              <span className="text-body">Kept as advance</span>
              <Money paise={r.advancePaise} className="text-body" />
            </li>
          ) : null}
        </ul>
      </Card>

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
