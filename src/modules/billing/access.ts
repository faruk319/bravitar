import { and, eq, inArray, ne } from "drizzle-orm";
import { type AccessContext, allows, ForbiddenError } from "@/lib/auth/can";
import type { Tx } from "@/lib/db/client";
import { NotFoundError } from "@/lib/errors";
import { batches, programs } from "@/modules/batches/schema";
import { branches } from "@/modules/tenancy/schema";
import { activities, activitySubscriptions } from "./schema";

// Anything that uses an activity needs it on in that branch and not paused
// (agreed 2026-09-30). Reading and fees always work, and so does winding down:
// closing a batch or a student leaving is never blocked.
export type ActivityState = "trial" | "active" | "paused" | "off";

export async function activityState(tx: Tx, branchId: string, activityKey: string): Promise<ActivityState> {
  const [row] = await tx
    .select({ status: activitySubscriptions.status })
    .from(activitySubscriptions)
    .where(and(eq(activitySubscriptions.branchId, branchId), eq(activitySubscriptions.activityKey, activityKey), ne(activitySubscriptions.status, "cancelled")));
  return !row || row.status === "cancelled" ? "off" : row.status;
}

export async function assertActivityOpen(tx: Tx, ctx: AccessContext, branchId: string, activityKey: string): Promise<void> {
  const state = await activityState(tx, branchId, activityKey);
  if (state === "trial" || state === "active") return;
  const [n] = await tx.select({ activity: activities.name, branch: branches.name }).from(activities).innerJoin(branches, eq(branches.id, branchId)).where(eq(activities.key, activityKey));
  const what = `${n?.activity ?? "This activity"} at ${n?.branch ?? "this branch"}`;
  if (!allows(ctx, "billing:view")) throw new ForbiddenError(`${what} is unavailable. Please contact your academy administrator.`);
  throw new ForbiddenError(state === "paused" ? `${what} is paused: a Bravitar bill is overdue.` : `${what} isn't on. Turn it on in Billing.`);
}

// A batch uses its branch and its program's activity.
export async function assertBatchOpen(tx: Tx, ctx: AccessContext, batchId: string): Promise<void> {
  const [b] = await tx.select({ branchId: batches.branchId, activityKey: programs.activityKey }).from(batches).innerJoin(programs, eq(programs.id, batches.programId)).where(eq(batches.id, batchId));
  if (!b) throw new NotFoundError("Batch");
  await assertActivityOpen(tx, ctx, b.branchId, b.activityKey);
}

export type PausedActivity = { activity: string; branch: string };

// For the notice at the top of every page; empty branchIds means all branches.
export async function pausedActivities(tx: Tx, branchIds: string[]): Promise<PausedActivity[]> {
  return tx
    .select({ activity: activities.name, branch: branches.name })
    .from(activitySubscriptions)
    .innerJoin(activities, eq(activities.key, activitySubscriptions.activityKey))
    .innerJoin(branches, eq(branches.id, activitySubscriptions.branchId))
    .where(and(eq(activitySubscriptions.status, "paused"), branchIds.length ? inArray(activitySubscriptions.branchId, branchIds) : undefined));
}
