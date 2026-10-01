import { and, eq, inArray, ne } from "drizzle-orm";
import { type AccessContext, allows, ForbiddenError } from "@/lib/auth/can";
import type { Tx } from "@/lib/db/client";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { batches, programs } from "@/modules/batches/schema";
import { branches } from "@/modules/tenancy/schema";
import { activityStudentCounts, isActivityStudent, staffCounts, staffSeats, usageKey } from "./repo";
import { activities, activityPlans, activitySubscriptions } from "./schema";

// Anything that uses an activity needs it on in that branch, not paused and
// not waiting for its first payment (agreed 2026-09-30). Reading and fees
// always work, and so does winding down: closing a batch or a student leaving
// is never blocked.
export type ActivityState = "trial" | "active" | "paused" | "pending" | "off";

// Why it's locked, for people who see Billing.
export const LOCKED = {
  paused: "is paused: a Bravitar bill is overdue.",
  pending: "is waiting for payment. Subscribe in Billing.",
  off: "isn't on. Turn it on in Billing.",
} as const;

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
  throw new ForbiddenError(`${what} ${LOCKED[state]}`);
}

// A batch uses its branch and its program's activity.
export async function assertBatchOpen(tx: Tx, ctx: AccessContext, batchId: string): Promise<void> {
  const [b] = await tx.select({ branchId: batches.branchId, activityKey: programs.activityKey }).from(batches).innerJoin(programs, eq(programs.id, batches.programId)).where(eq(batches.id, batchId));
  if (!b) throw new NotFoundError("Batch");
  await assertActivityOpen(tx, ctx, b.branchId, b.activityKey);
}

// A plan's limits (agreed 2026-09-30): students per branch and activity, and
// staff seats added up across the academy's plans. At a limit, adding is
// refused; nobody is removed.
const nextStep = (ctx: AccessContext, what: string) => (allows(ctx, "billing:view") ? `Upgrade ${what} in Billing.` : "Please contact your academy administrator.");
export const students = (n: number): string => `${n} ${n === 1 ? "student" : "students"}`;

export async function assertStudentRoom(tx: Tx, ctx: AccessContext, batchId: string, studentId: string): Promise<void> {
  const [row] = await tx
    .select({ branchId: batches.branchId, activityKey: programs.activityKey, max: activityPlans.maxStudents, plan: activityPlans.name, activity: activities.name, branch: branches.name })
    .from(batches)
    .innerJoin(programs, eq(programs.id, batches.programId))
    .innerJoin(activitySubscriptions, and(eq(activitySubscriptions.branchId, batches.branchId), eq(activitySubscriptions.activityKey, programs.activityKey), ne(activitySubscriptions.status, "cancelled")))
    .innerJoin(activityPlans, eq(activityPlans.id, activitySubscriptions.planId))
    .innerJoin(activities, eq(activities.key, programs.activityKey))
    .innerJoin(branches, eq(branches.id, batches.branchId))
    .where(eq(batches.id, batchId));
  if (!row || row.max === null || (await isActivityStudent(tx, row.branchId, row.activityKey, studentId))) return;
  const used = (await activityStudentCounts(tx, { branchId: row.branchId, activityKey: row.activityKey })).get(usageKey(row.branchId, row.activityKey)) ?? 0;
  if (used >= row.max) throw new ConflictError(`${row.activity} ${row.plan} at ${row.branch} allows ${students(row.max)}. ${nextStep(ctx, "the plan")}`);
}

export async function assertStaffRoom(tx: Tx, ctx: AccessContext): Promise<void> {
  const seats = await staffSeats(tx, { tenantIds: [ctx.tenantId] });
  const mine = seats.get(ctx.tenantId);
  if (mine === null) return; // a plan with no staff limit
  const allowed = (mine ?? 0) + 1; // plus one owner
  if (((await staffCounts(tx, [ctx.tenantId])).get(ctx.tenantId) ?? 0) >= allowed) throw new ConflictError(`Your plans allow ${allowed} staff. ${nextStep(ctx, "a plan")}`);
}

export type LockedActivity = { activity: string; branch: string; status: "paused" | "pending" };

// For the notice at the top of every page; empty branchIds means all branches.
export async function lockedActivities(tx: Tx, branchIds: string[]): Promise<LockedActivity[]> {
  const rows = await tx
    .select({ activity: activities.name, branch: branches.name, status: activitySubscriptions.status })
    .from(activitySubscriptions)
    .innerJoin(activities, eq(activities.key, activitySubscriptions.activityKey))
    .innerJoin(branches, eq(branches.id, activitySubscriptions.branchId))
    .where(and(inArray(activitySubscriptions.status, ["paused", "pending"]), branchIds.length ? inArray(activitySubscriptions.branchId, branchIds) : undefined));
  return rows.flatMap((r) => (r.status === "paused" || r.status === "pending" ? [{ ...r, status: r.status }] : []));
}
