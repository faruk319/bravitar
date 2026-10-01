import { notFound } from "next/navigation";
import { BillStatus } from "@/components/bill-status";
import { METHOD_LABEL } from "@/components/billing-text";
import { PageHeader } from "@/components/page-header";
import { PrintReceipt } from "@/components/payments/payment-actions";
import { Gate } from "@/components/shell/gate";
import { Card } from "@/components/ui/card";
import { allows } from "@/lib/auth/can";
import { scopedCtx } from "@/lib/auth/route";
import { requireStaffPage } from "@/lib/auth/server";
import { addDays, formatDate } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { NotFoundError } from "@/lib/errors";
import { formatPaise } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import { billPage } from "@/modules/billing/owner";

function Line({ label, paise, strong }: { label: string; paise: bigint; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3 py-1 text-body", strong && "font-semibold text-neutral-900")}>
      <span>{label}</span>
      <span className="tabular-nums">{formatPaise(paise)}</span>
    </div>
  );
}

// One of Bravitar's bills to this academy, to read or print (the browser can
// also save it as a PDF).
export default async function BillPage({ params }: PageProps<"/billing/bills/[id]">) {
  const { id } = await params;
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "billing:view")) return <Gate permission="billing:view">{null}</Gate>;
  const d = await withTenant(session.tenant.id, (tx) => billPage(tx, ctx, id)).catch((e: unknown) => {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  });
  if (!d) notFound();
  const b = d.bill;
  const paid = d.payments.filter((p) => !p.cancelledAt);
  return (
    <>
      <div className="print:hidden">
        <PageHeader title={b.number} crumbs={[{ label: "Billing", href: "/billing" }]} actions={<PrintReceipt />} />
      </div>
      <Card className="mx-auto max-w-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-heading text-neutral-900">Bravitar</p>
            {b.gstin ? <p className="text-caption text-muted-foreground">GSTIN {b.gstin}</p> : null}
          </div>
          <div className="text-right">
            <p className="text-heading text-neutral-900">{b.number}</p>
            <p className="text-caption text-muted-foreground">Issued {formatDate(b.issuedOn)}</p>
            <p className="text-caption text-muted-foreground">Due {formatDate(b.dueOn)}</p>
          </div>
        </div>
        <p className="mt-5 text-caption text-muted-foreground">Billed to</p>
        <p className="text-body text-neutral-900">
          {d.academy.name}
          {d.academy.gstin ? <span className="block text-caption text-muted-foreground">GSTIN {d.academy.gstin}</span> : null}
        </p>
        <div className="mt-5 border-t border-neutral-100 pt-3">
          <div className="flex justify-between gap-3 py-1 text-body">
            <span>
              {b.description}
              <span className="block text-caption text-muted-foreground">
                {formatDate(b.periodStart)} – {formatDate(addDays(b.periodEnd, -1))}
              </span>
            </span>
            <span className="tabular-nums">{formatPaise(b.subtotalPaise)}</span>
          </div>
          {b.taxRateBp > 0 ? <Line label={`Tax (${b.taxRateBp / 100}%)`} paise={b.taxPaise} /> : null}
          <Line label="Total" paise={b.totalPaise} strong />
          {b.paidPaise > 0n ? <Line label="Paid" paise={b.paidPaise} /> : null}
          {b.status === "open" ? <Line label="Still to pay" paise={b.totalPaise - b.paidPaise} strong /> : null}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <BillStatus bill={b} today={d.today} />
          {b.voidReason ? <span className="text-caption text-muted-foreground">Void: {b.voidReason}</span> : null}
        </div>
        {paid.length ? (
          <div className="mt-4 border-t border-neutral-100 pt-3">
            <p className="mb-1 text-caption text-muted-foreground">Payments</p>
            {paid.map((p) => (
              <div key={p.id} className="flex justify-between gap-3 py-1 text-body">
                <span>
                  {formatDate(p.receivedOn)} · {METHOD_LABEL[p.method]}
                  {p.reference ? ` · ${p.reference}` : ""}
                </span>
                <span className="tabular-nums">{formatPaise(p.amountPaise)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
    </>
  );
}
