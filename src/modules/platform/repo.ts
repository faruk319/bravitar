import { asc, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import type { PlatformTx } from "@/lib/db/platform";
import { uuidv7 } from "@/lib/ids";
import { branches } from "@/modules/tenancy/schema";
import { type BranchSubscription, branchSubscriptions, type PlatformPlan, platformPlans } from "./schema";

// PLACEHOLDER pricing and limits. Plans are rows, not constants, so the
// super-admin panel can change them; the seed inserts a plan only if its code
// is missing and never overwrites an edited one.
export const DEFAULT_PLANS: (typeof platformPlans.$inferInsert)[] = [
  { code: "starter", name: "Starter", pricePaise: 99_900n, billingCycle: "monthly", maxStudents: 100 },
  { code: "growth", name: "Growth", pricePaise: 199_900n, billingCycle: "monthly", maxStudents: 300 },
  { code: "pro", name: "Pro", pricePaise: 399_900n, billingCycle: "monthly", maxStudents: null },
];

// Returns the codes that were inserted (empty when everything already existed).
export async function ensurePlatformPlans(tx: PlatformTx): Promise<string[]> {
  const rows = await tx.insert(platformPlans).values(DEFAULT_PLANS).onConflictDoNothing({ target: platformPlans.code }).returning({ code: platformPlans.code });
  return rows.map((r) => r.code);
}

export async function listPlans(tx: Tx | PlatformTx): Promise<PlatformPlan[]> {
  return tx.select().from(platformPlans).where(eq(platformPlans.isActive, true)).orderBy(platformPlans.pricePaise);
}

export type NewBranchSubscription = { tenantId: string; branchId: string; planCode: string; status: BranchSubscription["status"]; trialEndsAt?: Date };

export async function createBranchSubscription(tx: Tx | PlatformTx, input: NewBranchSubscription): Promise<BranchSubscription> {
  const [row] = await tx
    .insert(branchSubscriptions)
    .values({ id: uuidv7(), ...input, trialEndsAt: input.trialEndsAt ?? null })
    .returning();
  if (!row) throw new Error("subscription insert returned no row");
  return row;
}

export type BranchPlan = { branchId: string; branchName: string; address: string | null; isDefault: boolean; subscription: BranchSubscription | null; plan: PlatformPlan | null };

// The academy on the transaction: each branch with its plan (none for a
// branch that never had one).
export async function ownBranchPlans(tx: Tx): Promise<BranchPlan[]> {
  const rows = await tx
    .select({ b: branches, s: branchSubscriptions, p: platformPlans })
    .from(branches)
    .leftJoin(branchSubscriptions, eq(branchSubscriptions.branchId, branches.id))
    .leftJoin(platformPlans, eq(platformPlans.code, branchSubscriptions.planCode))
    .orderBy(asc(branches.createdAt));
  return rows.filter((r) => !r.b.deletedAt).map((r) => ({ branchId: r.b.id, branchName: r.b.name, address: r.b.address, isDefault: r.b.isDefault, subscription: r.s, plan: r.p }));
}
