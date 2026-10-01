import { eq } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { uuidv7 } from "@/lib/ids";
import { createBranch } from "@/modules/tenancy/repo";
import { activityPlans, activitySubscriptions, billingAllocations, billingInvoices, billingPayments } from "./schema";

async function subscription(tx: Tx, tenantId: string): Promise<string> {
  const branch = await createBranch(tx, { tenantId, name: `Iso branch ${uuidv7()}` });
  const [plan] = await tx.select({ id: activityPlans.id }).from(activityPlans).where(eq(activityPlans.activityKey, "general")).limit(1);
  const id = uuidv7();
  await tx
    .insert(activitySubscriptions)
    .values({ id, tenantId, branchId: branch.id, activityKey: "general", planId: plan?.id ?? "", status: "active", pricePaise: 0n, billingInterval: "month", anchorDay: 1, periodStart: "2026-10-01", periodEnd: "2026-10-01" });
  return id;
}

async function invoice(tx: Tx, tenantId: string, subscriptionId: string): Promise<string> {
  const id = uuidv7();
  await tx.insert(billingInvoices).values({
    id,
    tenantId,
    subscriptionId,
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
  });
  return id;
}

async function payment(tx: Tx, tenantId: string, subscriptionId: string): Promise<string> {
  const id = uuidv7();
  await tx.insert(billingPayments).values({ id, tenantId, subscriptionId, requestId: uuidv7(), amountPaise: 50n, method: "upi", receivedOn: "2026-10-01" });
  return id;
}

// Written through the platform role (PLATFORM_WRITTEN in the registry).
export const billingFixtures: IsolationFixtures = {
  activity_subscriptions: subscription,
  billing_invoices: async (tx, tenantId) => invoice(tx, tenantId, await subscription(tx, tenantId)),
  billing_payments: async (tx, tenantId) => payment(tx, tenantId, await subscription(tx, tenantId)),
  billing_allocations: async (tx, tenantId) => {
    const sub = await subscription(tx, tenantId);
    const [paymentId, invoiceId] = [await payment(tx, tenantId, sub), await invoice(tx, tenantId, sub)];
    return tx.insert(billingAllocations).values({ id: uuidv7(), tenantId, paymentId, invoiceId, amountPaise: 50n });
  },
};
