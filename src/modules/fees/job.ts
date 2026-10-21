import type { PgBoss } from "pg-boss";
import { forEachTenant, type TenantRun } from "@/lib/jobs/tenants";
import { generateInvoices } from "./invoicing";

export const INVOICES_GENERATE = "invoices.generate";

// Nightly: each academy's charges for the day become drafts, or are sent at once in auto mode (docs/03 §8).
export function runInvoicesGenerate(opts: { now?: Date; tenantIds?: string[] } = {}): Promise<TenantRun> {
  return forEachTenant(
    INVOICES_GENERATE,
    async (tx, tenantId) => {
      const r = await generateInvoices(tx, { actorType: "system", tenantId }, opts.now ? { now: opts.now } : {});
      if (r.skipped.length) console.warn(`[${INVOICES_GENERATE}] tenant ${tenantId}: ${r.skipped.length} member(s) not billed`);
    },
    opts.tenantIds,
  );
}

export async function workInvoicesGenerate(boss: PgBoss): Promise<void> {
  await boss.createQueue(INVOICES_GENERATE);
  await boss.work<{ tenantIds?: string[] } | null, TenantRun>(INVOICES_GENERATE, async ([job]) => runInvoicesGenerate(job?.data?.tenantIds ? { tenantIds: job.data.tenantIds } : {}));
}
