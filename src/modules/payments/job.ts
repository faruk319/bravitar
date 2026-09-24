import type { PgBoss } from "pg-boss";
import type { Tx } from "@/lib/db/client";
import { forEachTenant, type TenantRun } from "@/lib/jobs/tenants";
import { httpRazorpay, type RazorpayApi, RazorpayError } from "@/modules/integrations/razorpay";
import { razorpayKeys } from "@/modules/integrations/service";
import { closeLink, staleLinks } from "./repo";
import { recordGatewayPayment } from "./service";

export const PAYMENTS_RECONCILE = "payments.reconcile";
const AFTER_MINUTES = 30;

export type Reconciled = { checked: number; recorded: number; closed: number; unreachable: number };

// docs/04: "Webhooks get lost. This job is what stops an angry 'I paid and it
// still shows pending' call." Links still live 30 minutes after they were made
// are asked about; a payment is recorded once, as if the webhook had come.
export async function reconcileLinks(tx: Tx, opts: { now?: Date; api?: RazorpayApi } = {}): Promise<Reconciled> {
  const out: Reconciled = { checked: 0, recorded: 0, closed: 0, unreachable: 0 };
  const keys = await razorpayKeys(tx, { includeInactive: true });
  if (!keys) return out;
  const now = opts.now ?? new Date();
  const client = (opts.api ?? httpRazorpay)(keys);
  for (const link of await staleLinks(tx, new Date(now.getTime() - AFTER_MINUTES * 60_000))) {
    out.checked++;
    let remote: Awaited<ReturnType<typeof client.fetchLink>>;
    try {
      remote = await client.fetchLink(link.gatewayLinkId);
    } catch (e) {
      if (!(e instanceof RazorpayError)) throw e;
      out.unreachable++; // asked again next hour
      continue;
    }
    for (const p of remote.payments.filter((x) => x.status === "captured")) {
      const r = await recordGatewayPayment(tx, { invoiceId: link.invoiceId, gatewayPaymentId: p.id, amountPaise: p.amountPaise, capturedAt: p.capturedAt }, { now });
      if (r.created) out.recorded++;
    }
    if (remote.status === "paid" || remote.status === "cancelled" || remote.status === "expired") {
      await closeLink(tx, link.id, remote.status, now);
      out.closed++;
    }
  }
  return out;
}

export function runPaymentsReconcile(opts: { now?: Date; tenantIds?: string[]; api?: RazorpayApi } = {}): Promise<TenantRun> {
  return forEachTenant(
    PAYMENTS_RECONCILE,
    async (tx) => {
      await reconcileLinks(tx, opts);
    },
    opts.tenantIds,
  );
}

export async function workPaymentsReconcile(boss: PgBoss): Promise<void> {
  await boss.createQueue(PAYMENTS_RECONCILE);
  await boss.work<{ tenantIds?: string[] } | null, TenantRun>(PAYMENTS_RECONCILE, async ([job]) => runPaymentsReconcile(job?.data?.tenantIds ? { tenantIds: job.data.tenantIds } : {}));
}
