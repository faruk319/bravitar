import Link from "next/link";
import { notFound } from "next/navigation";
import { IssueInvoices, VoidInvoice } from "@/components/fees/invoice-actions";
import { InvoiceStatus } from "@/components/fees/invoice-status";
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
import { cn } from "@/lib/utils";
import type { LineRow } from "@/modules/fees/repo";
import { invoiceDetail } from "@/modules/fees/service";
import { invoiceReceipts } from "@/modules/payments/service";

const period = (l: Pick<LineRow, "periodStart" | "periodEnd">) =>
  l.periodStart ? (l.periodEnd && l.periodEnd !== l.periodStart ? `${formatDate(l.periodStart)} – ${formatDate(l.periodEnd)}` : formatDate(l.periodStart)) : "";

function Total({ label, paise, strong }: { label: string; paise: bigint; strong?: boolean }) {
  return (
    <div className={cn("flex min-h-10 items-center justify-between gap-3", strong && "text-heading")}>
      <dt>{label}</dt>
      <dd>
        <Money paise={paise} showPaise={paise % 100n !== 0n} />
      </dd>
    </div>
  );
}

export default async function InvoicePage({ params, searchParams }: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  const openVoid = (await searchParams).void === "1"; // straight from the leave screens
  const session = await requireStaffPage();
  const ctx = scopedCtx(session);
  if (!allows(ctx, "invoices:read")) return <Gate permission="invoices:read">{null}</Gate>;
  const d = await withTenant(session.tenant.id, async (tx) => ({ ...(await invoiceDetail(tx, ctx, id)), receipts: await invoiceReceipts(tx, ctx, id) })).catch((e: unknown) => {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  });
  if (!d) notFound();
  const inv = d.invoice;
  const draft = inv.status === "draft";
  const canManage = allows(ctx, "invoices:manage") && inv.status !== "void";
  const canCollect = allows(ctx, "fees:collect") && (inv.status === "issued" || inv.status === "part_paid");
  const receiptLinks = allows(ctx, "payments:read") || allows(ctx, "fees:collect");
  // docs/04: without a GSTIN the invoice says nothing about GST.
  const gst = Boolean(d.academy.gstin) || inv.taxPaise > 0n;
  const facts: [string, string][] = [
    [draft ? "Planned for" : "Issued", formatDate(inv.issueDate)],
    ["Due", formatDate(inv.dueDate)],
    ...(inv.periodStart ? ([["Period", period(inv)]] as [string, string][]) : []),
    ...(inv.voidReason ? ([["Void because", inv.voidReason]] as [string, string][]) : []),
  ];

  return (
    <Gate permission="invoices:read">
      <PageHeader
        title={inv.number ?? "Draft invoice"}
        crumbs={[{ label: "Invoices", href: "/invoices" }]}
        actions={
          canManage || canCollect ? (
            <>
              {canCollect ? (
                <Button nativeButton={false} render={<Link href={`/payments/new?invoice=${inv.id}`} />}>
                  Collect
                </Button>
              ) : null}
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
          <ul className="divide-y divide-neutral-100">
            {d.lines.map((l) => (
              <li key={l.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-body font-medium">{l.description}</p>
                    <p className="text-caption text-muted-foreground">{[l.studentName, period(l)].filter(Boolean).join(" · ")}</p>
                  </div>
                  <Money paise={l.unitPaise * BigInt(l.quantity)} className="text-body" />
                </div>
                {l.discountPaise > 0n ? (
                  <div className="mt-1 flex items-start justify-between gap-3 text-success-600">
                    <p className="text-label">Discount · {l.discountNote}</p>
                    <Money paise={-l.discountPaise} className="text-label" />
                  </div>
                ) : null}
                {l.taxPaise > 0n ? (
                  <div className="mt-1 flex items-start justify-between gap-3 text-muted-foreground">
                    <p className="text-label">GST</p>
                    <Money paise={l.taxPaise} className="text-label" />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <dl className="mt-2 border-t border-neutral-100 pt-2 text-body">
            <Total label="Fees" paise={inv.subtotalPaise} />
            {inv.discountPaise > 0n ? <Total label="Discount" paise={-inv.discountPaise} /> : null}
            {gst ? <Total label="GST" paise={inv.taxPaise} /> : null}
            <Total label="Total" paise={inv.totalPaise} strong />
            {inv.paidPaise > 0n ? <Total label="Balance" paise={inv.totalPaise - inv.paidPaise} strong /> : null}
          </dl>
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
          <p className="text-body font-medium">{d.academy.name}</p>
          <p className="text-caption text-muted-foreground">{[d.academy.branch, d.academy.address].filter(Boolean).join(" · ")}</p>
          {d.academy.gstin ? <p className="mt-1 text-caption tabular-nums">GSTIN {d.academy.gstin}</p> : null}
          <dl className="mt-3 divide-y divide-neutral-100 border-t border-neutral-100">
            <div className="flex min-h-12 items-center justify-between gap-3">
              <dt className="text-label text-muted-foreground">Bill to</dt>
              <dd className="text-body">{d.householdName}</dd>
            </div>
            {facts.map(([k, v]) => (
              <div key={k} className="flex min-h-12 items-center justify-between gap-3">
                <dt className="text-label text-muted-foreground">{k}</dt>
                <dd className="text-right text-body tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </Gate>
  );
}
