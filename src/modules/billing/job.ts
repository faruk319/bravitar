import type { PgBoss } from "pg-boss";
import { platformRead } from "@/lib/db/platform";
import { todayIn } from "@/lib/dates";
import { type DueSubscription, dueSubscriptions, overdueSubscriptions } from "./repo";
import { pauseIfOverdue, renewSubscription } from "./service";

export const BILLING_RENEW = "billing.renew";

export type BillingRun = { renewed: number; invoices: number; paused: number; failed: { subscriptionId: string; error: string }[] };

// Daily: bills what has come due, then pauses activities with a bill unpaid
// past its due date. One transaction per subscription; a failing one is
// reported and the rest carry on.
export async function runBillingRenew(opts: { now?: Date; tenantIds?: string[] } = {}): Promise<BillingRun> {
  const now = opts.now ?? new Date();
  const run: BillingRun = { renewed: 0, invoices: 0, paused: 0, failed: [] };
  const each = async (list: DueSubscription[], fn: (id: string, today: string) => Promise<void>) => {
    for (const s of list) {
      try {
        await fn(s.id, todayIn(s.timezone, now));
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        run.failed.push({ subscriptionId: s.id, error });
        console.error(`${BILLING_RENEW}: ${s.id} failed: ${error}`);
      }
    }
  };
  await each(await platformRead((tx) => dueSubscriptions(tx, now, opts.tenantIds)), async (id, today) => {
    run.invoices += (await renewSubscription(id, today)).invoices.length;
    run.renewed++;
  });
  await each(await platformRead((tx) => overdueSubscriptions(tx, now, opts.tenantIds)), async (id, today) => {
    if (await pauseIfOverdue(id, today)) run.paused++;
  });
  return run;
}

export async function workBillingRenew(boss: PgBoss): Promise<void> {
  await boss.createQueue(BILLING_RENEW);
  await boss.work<{ tenantIds?: string[] } | null, BillingRun>(BILLING_RENEW, async ([job]) => runBillingRenew(job?.data?.tenantIds ? { tenantIds: job.data.tenantIds } : {}));
}
