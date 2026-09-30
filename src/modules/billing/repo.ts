import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import type { PlatformTx } from "@/lib/db/platform";
import { uuidv7 } from "@/lib/ids";
import { branches } from "@/modules/tenancy/schema";
import { type Activity, activities, activityPriceHistory, type ActivitySubscription, activitySubscriptions, billingSettings, type BillingSettings } from "./schema";

type AnyTx = Tx | PlatformTx;

// Offered first (active, coming soon, retired), then by name.
export async function listActivities(tx: AnyTx): Promise<Activity[]> {
  return tx.select().from(activities).orderBy(asc(activities.status), asc(activities.name));
}

export async function getActivity(tx: AnyTx, key: string): Promise<Activity | undefined> {
  const [row] = await tx.select().from(activities).where(eq(activities.key, key));
  return row;
}

export async function getBillingSettings(tx: AnyTx): Promise<BillingSettings> {
  const [row] = await tx.select().from(billingSettings);
  if (!row) throw new Error("billing_settings has no row (migration 0026)");
  return row;
}

export type PriceChange = { activityKey: string; oldPaise: bigint; newPaise: bigint; reason: string | null; changedAt: Date };

export async function recentPriceChanges(tx: PlatformTx, limit = 50): Promise<PriceChange[]> {
  return tx
    .select({ activityKey: activityPriceHistory.activityKey, oldPaise: activityPriceHistory.oldPaise, newPaise: activityPriceHistory.newPaise, reason: activityPriceHistory.reason, changedAt: activityPriceHistory.changedAt })
    .from(activityPriceHistory)
    .orderBy(desc(activityPriceHistory.changedAt))
    .limit(limit);
}

export async function insertSubscription(tx: PlatformTx, row: Omit<typeof activitySubscriptions.$inferInsert, "id">): Promise<ActivitySubscription> {
  const [created] = await tx
    .insert(activitySubscriptions)
    .values({ id: uuidv7(), ...row })
    .returning();
  if (!created) throw new Error("subscription insert returned no row");
  return created;
}

export type SubscriptionRow = ActivitySubscription & { activityName: string; branchName: string };

// Everything not cancelled, with names. In an academy's own context its
// policies narrow this to that academy.
export async function liveSubscriptions(tx: AnyTx, opts: { tenantIds?: string[] } = {}): Promise<SubscriptionRow[]> {
  const rows = await tx
    .select({ s: activitySubscriptions, activityName: activities.name, branchName: branches.name })
    .from(activitySubscriptions)
    .innerJoin(activities, eq(activities.key, activitySubscriptions.activityKey))
    .innerJoin(branches, eq(branches.id, activitySubscriptions.branchId))
    .where(and(ne(activitySubscriptions.status, "cancelled"), opts.tenantIds ? inArray(activitySubscriptions.tenantId, opts.tenantIds) : undefined))
    .orderBy(asc(branches.createdAt), asc(activities.name));
  return rows.map((r) => ({ ...r.s, activityName: r.activityName, branchName: r.branchName }));
}

// The activities an academy has on, in any branch or in one.
export async function liveActivityKeys(tx: Tx, branchId?: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ key: activitySubscriptions.activityKey })
    .from(activitySubscriptions)
    .where(and(ne(activitySubscriptions.status, "cancelled"), branchId ? eq(activitySubscriptions.branchId, branchId) : undefined));
  return rows.map((r) => r.key);
}

// Branches using each activity, across all academies.
export async function branchesPerActivity(tx: PlatformTx): Promise<Map<string, number>> {
  const rows = await tx.select({ key: activitySubscriptions.activityKey, n: count() }).from(activitySubscriptions).where(ne(activitySubscriptions.status, "cancelled")).groupBy(activitySubscriptions.activityKey);
  return new Map(rows.map((r) => [r.key, r.n]));
}
