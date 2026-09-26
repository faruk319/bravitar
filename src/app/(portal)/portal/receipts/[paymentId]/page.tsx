import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintReceipt } from "@/components/payments/payment-actions";
import { ReceiptCard } from "@/components/payments/receipt-card";
import { requireGuardianPage } from "@/lib/auth/server";
import { withTenant } from "@/lib/db/with-tenant";
import { NotFoundError } from "@/lib/errors";
import { portalReceipt } from "@/modules/portal/service";

// One receipt of this family, to print or save as PDF (docs/03 §12).
export default async function PortalReceipt({ params }: PageProps<"/portal/receipts/[paymentId]">) {
  const s = await requireGuardianPage();
  const { paymentId } = await params;
  const r = await withTenant(s.tenant.id, (tx) => portalReceipt(tx, { tenantId: s.tenant.id, guardianId: s.actor.id }, paymentId)).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  return (
    <div className="mx-auto w-full max-w-xl print:p-0">
      <div className="mb-4 flex items-end justify-between gap-3 print:hidden">
        <div>
          <Link href="/portal/receipts" className="text-label text-accent-600 hover:underline">
            ← Receipts
          </Link>
          <h1 className="mt-1 text-display tabular-nums">{r.payment.receiptNumber}</h1>
        </div>
        <PrintReceipt />
      </div>
      <ReceiptCard r={r} />
    </div>
  );
}
