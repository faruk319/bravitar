import { and, asc, count, countDistinct, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "@/lib/db/client";
import type { PlatformTx } from "@/lib/db/platform";
import { uuidv7 } from "@/lib/ids";
import { batches, programs } from "@/modules/batches/schema";
import { enrollments } from "@/modules/enrollments/schema";
import { staffUsers } from "@/modules/staff/schema";
import { branches } from "@/modules/tenancy/schema";
import {
  type Activity,
  type ActivityPlan,
  activities,
  activityPlans,
  type ActivitySubscription,
  activitySubscriptions,
  billingSettings,
  type BillingSettings,
  planPriceHistory,
} from "./schema";

type AnyTx = Tx | PlatformTx;

// Offered first (active, coming soon, retired), then by name.
export async function listActivities(tx: AnyTx): Promise<Activity[]> {
  return tx.select().from(activities).orderBy(asc(activities.status), asc(activities.name));
}

export async function getActivity(tx: AnyTx, key: string): Promise<Activity | undefined> {
  const [row] = await tx.select().from(activities).where(eq(activities.key, key));
  return row;
}

// Cheapest first.
export async function listPlans(tx: AnyTx, activityKey?: string): Promise<ActivityPlan[]> {
  return tx
    .select()
    .from(activityPlans)
    .where(activityKey ? eq(activityPlans.activityKey, activityKey) : undefined)
    .orderBy(asc(activityPlans.pricePaise), asc(activityPlans.name));
}

export async function getPlan(tx: AnyTx, id: string): Promise<ActivityPlan | undefined> {
  const [row] = await tx.select().from(activityPlans).where(eq(activityPlans.id, id));
  return row;
}

export async function getBillingSettings(tx: AnyTx): Promise<BillingSettings> {
  const [row] = await tx.select().from(billingSettings);
  if (!row) throw new Error("billing_settings has no row (migration 0026)");
  return row;
}

export type PriceChange = { planId: string; oldPaise: bigint; newPaise: bigint; reason: string | null; changedAt: Date };

export async function recentPriceChanges(tx: PlatformTx, limit = 100): Promise<PriceChange[]> {
  return tx
    .select({ planId: planPriceHistory.planId, oldPaise: planPriceHistory.oldPaise, newPaise: planPriceHistory.newPaise, reason: planPriceHistory.reason, changedAt: planPriceHistory.changedAt })
    .from(planPriceHistory)
    .orderBy(desc(planPriceHistory.changedAt))
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

export type SubscriptionRow = ActivitySubscription & { activityName: string; branchName: string; plan: ActivityPlan; nextPlanName: string | null };

const nextPlan = alias(activityPlans, "next_plan");

// Everything not cancelled, with names and plans. In an academy's own context
// its policies narrow this to that academy.
export async function liveSubscriptions(tx: AnyTx, opts: { tenantIds?: string[] } = {}): Promise<SubscriptionRow[]> {
  const rows = await tx
    .select({ s: activitySubscriptions, activityName: activities.name, branchName: branches.name, plan: activityPlans, nextPlanName: nextPlan.name })
    .from(activitySubscriptions)
    .innerJoin(activities, eq(activities.key, activitySubscriptions.activityKey))
    .innerJoin(branches, eq(branches.id, activitySubscriptions.branchId))
    .innerJoin(activityPlans, eq(activityPlans.id, activitySubscriptions.planId))
    .leftJoin(nextPlan, eq(nextPlan.id, activitySubscriptions.nextPlanId))
    .where(and(ne(activitySubscriptions.status, "cancelled"), opts.tenantIds ? inArray(activitySubscriptions.tenantId, opts.tenantIds) : undefined))
    .orderBy(asc(branches.createdAt), asc(activities.name));
  return rows.map((r) => ({ ...r.s, activityName: r.activityName, branchName: r.branchName, plan: r.plan, nextPlanName: r.nextPlanName }));
}

// The activities an academy has on, in any branch or in one.
export async function liveActivityKeys(tx: Tx, branchId?: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ key: activitySubscriptions.activityKey })
    .from(activitySubscriptions)
    .where(and(ne(activitySubscriptions.status, "cancelled"), branchId ? eq(activitySubscriptions.branchId, branchId) : undefined));
  return rows.map((r) => r.key);
}

// Branches on each plan, across all academies.
export async function subscriptionsPerPlan(tx: PlatformTx): Promise<Map<string, number>> {
  const rows = await tx.select({ planId: activitySubscriptions.planId, n: count() }).from(activitySubscriptions).where(ne(activitySubscriptions.status, "cancelled")).groupBy(activitySubscriptions.planId);
  return new Map(rows.map((r) => [r.planId, r.n]));
}

// ---- usage against a plan's limits

export const usageKey = (branchId: string, activityKey: string): string => `${branchId}|${activityKey}`;

const currentEnrollment = and(inArray(enrollments.status, ["active", "paused"]), isNull(batches.deletedAt));

// Students in each activity at each branch: in one of its batches, active or paused.
export async function activityStudentCounts(tx: AnyTx, opts: { tenantIds?: string[]; branchId?: string; activityKey?: string } = {}): Promise<Map<string, number>> {
  const rows = await tx
    .select({ branchId: batches.branchId, activityKey: programs.activityKey, n: countDistinct(enrollments.studentId) })
    .from(enrollments)
    .innerJoin(batches, eq(batches.id, enrollments.batchId))
    .innerJoin(programs, eq(programs.id, batches.programId))
    .where(
      and(
        currentEnrollment,
        opts.tenantIds ? inArray(enrollments.tenantId, opts.tenantIds) : undefined,
        opts.branchId ? eq(batches.branchId, opts.branchId) : undefined,
        opts.activityKey ? eq(programs.activityKey, opts.activityKey) : undefined,
      ),
    )
    .groupBy(batches.branchId, programs.activityKey);
  return new Map(rows.map((r) => [usageKey(r.branchId, r.activityKey), r.n]));
}

export async function isActivityStudent(tx: Tx, branchId: string, activityKey: string, studentId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: enrollments.id })
    .from(enrollments)
    .innerJoin(batches, eq(batches.id, enrollments.batchId))
    .innerJoin(programs, eq(programs.id, batches.programId))
    .where(and(currentEnrollment, eq(enrollments.studentId, studentId), eq(batches.branchId, branchId), eq(programs.activityKey, activityKey)))
    .limit(1);
  return Boolean(row);
}

// Active staff, owners and those who haven't signed in yet included.
export async function staffCounts(tx: AnyTx, tenantIds: string[]): Promise<Map<string, number>> {
  const rows = await tx
    .select({ tenantId: staffUsers.tenantId, n: count() })
    .from(staffUsers)
    .where(and(isNull(staffUsers.deletedAt), eq(staffUsers.isActive, true), inArray(staffUsers.tenantId, tenantIds)))
    .groupBy(staffUsers.tenantId);
  return new Map(rows.map((r) => [r.tenantId, r.n]));
}

// Staff seats per academy: its plans' staff limits added up, or null (no
// limit) when any of them has none.
export async function staffSeats(tx: AnyTx, opts: { tenantIds?: string[] } = {}): Promise<Map<string, number | null>> {
  const rows = await tx
    .select({ tenantId: activitySubscriptions.tenantId, max: activityPlans.maxStaff })
    .from(activitySubscriptions)
    .innerJoin(activityPlans, eq(activityPlans.id, activitySubscriptions.planId))
    .where(and(ne(activitySubscriptions.status, "cancelled"), opts.tenantIds ? inArray(activitySubscriptions.tenantId, opts.tenantIds) : undefined));
  const out = new Map<string, number | null>();
  for (const r of rows) {
    const sofar = out.get(r.tenantId);
    out.set(r.tenantId, sofar === null || r.max === null ? null : (sofar ?? 0) + r.max);
  }
  return out;
}
