import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { Card } from "@/components/ui/card";
import { requireGuardianPage } from "@/lib/auth/server";
import { formatDate } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { METHOD_LABEL } from "@/modules/payments/labels";
import { familyReceipts } from "@/modules/portal/service";

// The family's receipts, newest first; each opens to print or save.
export default async function PortalReceipts() {
  const s = await requireGuardianPage();
  const receipts = await withTenant(s.tenant.id, (tx) => familyReceipts(tx, { tenantId: s.tenant.id, guardianId: s.actor.id }));
  return (
    <>
      <Link href="/portal" className="text-label text-accent-600 hover:underline">
        ← Back
      </Link>
      <h1 className="mt-1 mb-4 text-display">Receipts</h1>
      <Card className="p-0 md:p-0">
        {receipts.length ? (
          <ul className="divide-y divide-neutral-100">
            {receipts.map((r) => (
              <li key={r.id}>
                <Link href={`/portal/receipts/${r.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-neutral-50">
                  <span className="min-w-0">
                    <span className="block text-body tabular-nums">{r.receiptNumber}</span>
                    <span className="block text-caption text-muted-foreground">
                      {formatDate(r.receivedOn)} · {METHOD_LABEL[r.method]}
                      {r.status === "refunded" ? " · refunded" : ""}
                    </span>
                  </span>
                  <Money paise={r.amountPaise} className="shrink-0 text-body font-medium" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No receipts yet" hint="Each payment you make shows here." />
        )}
      </Card>
    </>
  );
}
