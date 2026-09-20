import { desc, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import type { PlatformTx } from "@/lib/db/platform";
import { uuidv7 } from "@/lib/ids";
import { type PlatformPlan, platformPlans, type TenantSubscription, tenantSubscriptions } from "./schema";

// PLACEHOLDER pricing and limits. Plans are rows, not constants, so the
// super-admin panel can change them; the seed inserts a plan only if its code
// is missing and never overwrites an edited one.
export const DEFAULT_PLANS: (typeof platformPlans.$inferInsert)[] = [
  { code: "starter", name: "Starter", pricePaise: 99_900n, billingCycle: "monthly", maxStudents: 100, maxStaff: 5, maxBranches: 1 },
  { code: "growth", name: "Growth", pricePaise: 199_900n, billingCycle: "monthly", maxStudents: 300, maxStaff: 15, maxBranches: 3 },
  { code: "pro", name: "Pro", pricePaise: 399_900n, billingCycle: "monthly", maxStudents: null, maxStaff: null, maxBranches: null },
];

// Returns the codes that were inserted (empty when everything already existed).
export async function ensurePlatformPlans(tx: PlatformTx): Promise<string[]> {
  const rows = await tx.insert(platformPlans).values(DEFAULT_PLANS).onConflictDoNothing({ target: platformPlans.code }).returning({ code: platformPlans.code });
  return rows.map((r) => r.code);
}

export async function listPlans(tx: Tx | PlatformTx): Promise<PlatformPlan[]> {
  return tx.select().from(platformPlans).where(eq(platformPlans.isActive, true)).orderBy(platformPlans.pricePaise);
}

export type CreateSubscriptionInput = {
  tenantId: string;
  planCode: string;
  status: TenantSubscription["status"];
  trialEndsAt?: Date;
};

export async function createSubscription(tx: PlatformTx, input: CreateSubscriptionInput): Promise<TenantSubscription> {
  const [row] = await tx
    .insert(tenantSubscriptions)
    .values({ id: uuidv7(), ...input, trialEndsAt: input.trialEndsAt ?? null })
    .returning();
  if (!row) throw new Error("subscription insert returned no row");
  return row;
}

// Latest subscription of the tenant on the transaction.
export async function getOwnSubscription(tx: Tx): Promise<TenantSubscription | undefined> {
  const [row] = await tx.select().from(tenantSubscriptions).orderBy(desc(tenantSubscriptions.createdAt)).limit(1);
  return row;
}
