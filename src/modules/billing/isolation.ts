import { eq } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { uuidv7 } from "@/lib/ids";
import { createBranch } from "@/modules/tenancy/repo";
import { activityPlans, activitySubscriptions, billingInvoices } from "./schema";

async function subscription(tx: Tx, tenantId: string): Promise<string> {
  const branch = await createBranch(tx, { tenantId, name: `Iso branch ${uuidv7()}` });
  const [plan] = await tx.select({ id: activityPlans.id }).from(activityPlans).where(eq(activityPlans.activityKey, "general")).limit(1);
  const id = uuidv7();
  await tx
    .insert(activitySubscriptions)
    .values({ id, tenantId, branchId: branch.id, activityKey: "general", planId: plan?.id ?? "", status: "active", pricePaise: 0n, billingInterval: "month", anchorDay: 1, periodStart: "2026-10-01", periodEnd: "2026-10-01" });
  return id;
}

// Written through the platform role (PLATFORM_WRITTEN in the registry).
export const billingFixtures: IsolationFixtures = {
  activity_subscriptions: subscription,
  billing_invoices: async (tx, tenantId) =>
    tx.insert(billingInvoices).values({
      id: uuidv7(),
      tenantId,
      subscriptionId: await subscription(tx, tenantId),
      number: `BRV/TEST/${uuidv7()}`,
      description: "Iso",
      periodStart: "2026-10-01",
      periodEnd: "2026-11-01",
      subtotalPaise: 100n,
      taxRateBp: 0,
      taxPaise: 0n,
      totalPaise: 100n,
      issuedOn: "2026-10-01",
      dueOn: "2026-10-08",
    }),
};
