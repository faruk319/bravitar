import { and, asc, count, countDistinct, desc, eq, gte, inArray, isNull, lt, lte, ne, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "@/lib/db/client";
import type { PlatformTx } from "@/lib/db/platform";
import { todayIn } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { batches, programs } from "@/modules/batches/schema";
import { enrollments } from "@/modules/enrollments/schema";
import { staffUsers } from "@/modules/staff/schema";
import { branches, tenants } from "@/modules/tenancy/schema";
import {
  type Activity,
  type ActivityPlan,
  activities,
  activityPlans,
  type ActivitySubscription,
  activitySubscriptions,
  billingAllocations,
  type BillingInvoice,
  billingInvoiceSeries,
  billingInvoices,
  type BillingPayment,
  billingPayments,
  billingSettings,
  type BillingSettings,
  planPriceHistory,
  type SubscriptionStatus,
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

// The plan a new start gets when none is picked.
export async function defaultPlan(tx: AnyTx, activityKey: string): Promise<ActivityPlan | undefined> {
  const [row] = await tx
    .select()
    .from(activityPlans)
    .where(and(eq(activityPlans.activityKey, activityKey), eq(activityPlans.isDefault, true)));
  return row;
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

export async function getSubscription(tx: AnyTx, id: string): Promise<ActivitySubscription | undefined> {
  const [row] = await tx.select().from(activitySubscriptions).where(eq(activitySubscriptions.id, id));
  return row;
}

export async function lockSubscription(tx: PlatformTx, id: string): Promise<ActivitySubscription | undefined> {
  const [row] = await tx.select().from(activitySubscriptions).where(eq(activitySubscriptions.id, id)).for("update");
  return row;
}

export async function updateSubscription(tx: PlatformTx, id: string, patch: Partial<ActivitySubscription>): Promise<void> {
  await tx.update(activitySubscriptions).set(patch).where(eq(activitySubscriptions.id, id));
}

export type SubscriptionRow = ActivitySubscription & { activityName: string; activityIcon: string; branchName: string; plan: ActivityPlan; nextPlanName: string | null };

const nextPlan = alias(activityPlans, "next_plan");

// Everything not cancelled, with names and plans. In an academy's own context
// its policies narrow this to that academy.
export async function liveSubscriptions(tx: AnyTx, opts: { tenantIds?: string[] } = {}): Promise<SubscriptionRow[]> {
  const rows = await tx
    .select({ s: activitySubscriptions, activityName: activities.name, activityIcon: activities.icon, branchName: branches.name, plan: activityPlans, nextPlanName: nextPlan.name })
    .from(activitySubscriptions)
    .innerJoin(activities, eq(activities.key, activitySubscriptions.activityKey))
    .innerJoin(branches, eq(branches.id, activitySubscriptions.branchId))
    .innerJoin(activityPlans, eq(activityPlans.id, activitySubscriptions.planId))
    .leftJoin(nextPlan, eq(nextPlan.id, activitySubscriptions.nextPlanId))
    .where(and(ne(activitySubscriptions.status, "cancelled"), opts.tenantIds ? inArray(activitySubscriptions.tenantId, opts.tenantIds) : undefined))
    .orderBy(asc(branches.createdAt), asc(activities.name));
  return rows.map((r) => ({ ...r.s, activityName: r.activityName, activityIcon: r.activityIcon, branchName: r.branchName, plan: r.plan, nextPlanName: r.nextPlanName }));
}

export type ListedSubscription = ActivitySubscription & { academyName: string; timezone: string; branchName: string; activityName: string; activityIcon: string; planName: string };

// Every academy's branch modules, for /platform/subscriptions: live ones
// unless a status is asked for.
export type SubscriptionFilters = { status?: SubscriptionStatus | undefined; activityKey?: string | undefined; tenantIds?: string[] | undefined };

export async function subscriptionList(tx: PlatformTx, f: SubscriptionFilters = {}): Promise<ListedSubscription[]> {
  const rows = await tx
    .select({ s: activitySubscriptions, academyName: tenants.name, timezone: tenants.timezone, branchName: branches.name, activityName: activities.name, activityIcon: activities.icon, planName: activityPlans.name })
    .from(activitySubscriptions)
    .innerJoin(tenants, eq(tenants.id, activitySubscriptions.tenantId))
    .innerJoin(branches, eq(branches.id, activitySubscriptions.branchId))
    .innerJoin(activities, eq(activities.key, activitySubscriptions.activityKey))
    .innerJoin(activityPlans, eq(activityPlans.id, activitySubscriptions.planId))
    .where(
      and(
        isNull(tenants.deletedAt),
        f.status ? eq(activitySubscriptions.status, f.status) : ne(activitySubscriptions.status, "cancelled"),
        f.activityKey ? eq(activitySubscriptions.activityKey, f.activityKey) : undefined,
        f.tenantIds ? inArray(activitySubscriptions.tenantId, f.tenantIds) : undefined,
      ),
    )
    .orderBy(asc(tenants.name), asc(branches.createdAt), asc(activities.name));
  return rows.map(({ s, ...names }) => ({ ...s, ...names }));
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

// ---- Bravitar's bills

// Gapless because it runs in the bill's own transaction (a rollback gives the
// number back); the row lock keeps it unique. BRV/2026-27/00001.
export async function allocateInvoiceNumber(tx: PlatformTx, fy: string): Promise<string> {
  await tx.insert(billingInvoiceSeries).values({ fy }).onConflictDoNothing();
  const [row] = await tx
    .update(billingInvoiceSeries)
    .set({ nextValue: sql`${billingInvoiceSeries.nextValue} + 1` })
    .where(eq(billingInvoiceSeries.fy, fy))
    .returning({ assigned: sql<number>`${billingInvoiceSeries.nextValue} - 1` });
  if (!row) throw new Error("allocateInvoiceNumber: series row missing");
  return `BRV/${fy}/${String(row.assigned).padStart(5, "0")}`;
}

export async function insertInvoice(tx: PlatformTx, row: Omit<typeof billingInvoices.$inferInsert, "id">): Promise<BillingInvoice> {
  const [created] = await tx
    .insert(billingInvoices)
    .values({ id: uuidv7(), ...row })
    .returning();
  if (!created) throw new Error("invoice insert returned no row");
  return created;
}

// Newest first. In an academy's own context its policies narrow this to that academy.
export async function listInvoices(tx: AnyTx, opts: { tenantIds?: string[]; limit?: number } = {}): Promise<BillingInvoice[]> {
  return tx
    .select()
    .from(billingInvoices)
    .where(opts.tenantIds ? inArray(billingInvoices.tenantId, opts.tenantIds) : undefined)
    .orderBy(desc(billingInvoices.issuedOn), desc(billingInvoices.number))
    .limit(opts.limit ?? 50);
}

// "Karate Starter · Kothrud Centre", as a bill describes it.
export async function subscriptionLabel(tx: PlatformTx, s: Pick<ActivitySubscription, "activityKey" | "planId" | "branchId">): Promise<string> {
  const [row] = await tx
    .select({ activity: activities.name, plan: activityPlans.name, branch: branches.name })
    .from(activities)
    .innerJoin(activityPlans, eq(activityPlans.id, s.planId))
    .innerJoin(branches, eq(branches.id, s.branchId))
    .where(eq(activities.key, s.activityKey));
  if (!row) throw new Error("subscriptionLabel: names missing");
  return `${row.activity} ${row.plan} · ${row.branch}`;
}

export type DueSubscription = { id: string; timezone: string };

const localToday = (now: Date) => sql`(${now.toISOString()}::timestamptz AT TIME ZONE ${tenants.timezone})::date`;
const billed = (tenantIds?: string[]) => and(isNull(tenants.deletedAt), ne(tenants.status, "closed"), tenantIds ? inArray(activitySubscriptions.tenantId, tenantIds) : undefined);

// Live subscriptions whose bill date has come in their academy's timezone;
// waiting ones wait for their first payment instead. Suspended academies are
// billed; closed and deleted ones aren't.
export async function dueSubscriptions(tx: PlatformTx, now: Date, tenantIds?: string[]): Promise<DueSubscription[]> {
  return tx
    .select({ id: activitySubscriptions.id, timezone: tenants.timezone })
    .from(activitySubscriptions)
    .innerJoin(tenants, eq(tenants.id, activitySubscriptions.tenantId))
    .where(and(billed(tenantIds), notInArray(activitySubscriptions.status, ["cancelled", "pending"]), lte(activitySubscriptions.periodEnd, localToday(now))))
    .orderBy(asc(activitySubscriptions.periodEnd));
}

// Active subscriptions with an open bill past its due date.
export async function overdueSubscriptions(tx: PlatformTx, now: Date, tenantIds?: string[]): Promise<DueSubscription[]> {
  return tx
    .selectDistinct({ id: activitySubscriptions.id, timezone: tenants.timezone })
    .from(activitySubscriptions)
    .innerJoin(tenants, eq(tenants.id, activitySubscriptions.tenantId))
    .innerJoin(billingInvoices, and(eq(billingInvoices.subscriptionId, activitySubscriptions.id), eq(billingInvoices.status, "open")))
    .where(and(billed(tenantIds), eq(activitySubscriptions.status, "active"), lt(billingInvoices.dueOn, localToday(now))));
}

export async function overdueNumbers(tx: PlatformTx, subscriptionId: string, today: string): Promise<string[]> {
  const rows = await tx
    .select({ number: billingInvoices.number })
    .from(billingInvoices)
    .where(and(eq(billingInvoices.subscriptionId, subscriptionId), eq(billingInvoices.status, "open"), lt(billingInvoices.dueOn, today)))
    .orderBy(asc(billingInvoices.dueOn));
  return rows.map((r) => r.number);
}

// ---- payments, recorded by hand

export async function academyToday(tx: PlatformTx, tenantId: string, now = new Date()): Promise<string> {
  const [t] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw new Error("academyToday: no such academy");
  return todayIn(t.timezone, now);
}

export type OpenBill = { id: string; number: string; balance: bigint };

// A subscription's unpaid bills, oldest first.
export async function openBills(tx: PlatformTx, subscriptionId: string): Promise<OpenBill[]> {
  return tx
    .select({ id: billingInvoices.id, number: billingInvoices.number, balance: sql<bigint>`${billingInvoices.totalPaise} - ${billingInvoices.paidPaise}`.mapWith(BigInt) })
    .from(billingInvoices)
    .where(and(eq(billingInvoices.subscriptionId, subscriptionId), eq(billingInvoices.status, "open")))
    .orderBy(asc(billingInvoices.periodStart));
}

// What each subscription still owes on its bills.
export async function openBalances(tx: AnyTx, tenantIds: string[]): Promise<Map<string, bigint>> {
  const rows = await tx
    .select({ id: billingInvoices.subscriptionId, owed: sql<bigint>`sum(${billingInvoices.totalPaise} - ${billingInvoices.paidPaise})`.mapWith(BigInt) })
    .from(billingInvoices)
    .where(and(eq(billingInvoices.status, "open"), inArray(billingInvoices.tenantId, tenantIds)))
    .groupBy(billingInvoices.subscriptionId);
  return new Map(rows.map((r) => [r.id, r.owed]));
}

export async function paymentByRequest(tx: PlatformTx, requestId: string): Promise<BillingPayment | undefined> {
  const [row] = await tx.select().from(billingPayments).where(eq(billingPayments.requestId, requestId));
  return row;
}

export async function insertPayment(tx: PlatformTx, row: Omit<typeof billingPayments.$inferInsert, "id">): Promise<BillingPayment> {
  const [created] = await tx
    .insert(billingPayments)
    .values({ id: uuidv7(), ...row })
    .returning();
  if (!created) throw new Error("payment insert returned no row");
  return created;
}

export async function getInvoice(tx: AnyTx, id: string): Promise<BillingInvoice | undefined> {
  const [row] = await tx.select().from(billingInvoices).where(eq(billingInvoices.id, id));
  return row;
}

export async function lockInvoice(tx: PlatformTx, id: string): Promise<BillingInvoice | undefined> {
  const [row] = await tx.select().from(billingInvoices).where(eq(billingInvoices.id, id)).for("update");
  return row;
}

export async function updateInvoice(tx: PlatformTx, id: string, patch: Partial<BillingInvoice>): Promise<void> {
  await tx.update(billingInvoices).set(patch).where(eq(billingInvoices.id, id));
}

export async function getPayment(tx: AnyTx, id: string): Promise<BillingPayment | undefined> {
  const [row] = await tx.select().from(billingPayments).where(eq(billingPayments.id, id));
  return row;
}

export async function lockPayment(tx: PlatformTx, id: string): Promise<BillingPayment | undefined> {
  const [row] = await tx.select().from(billingPayments).where(eq(billingPayments.id, id)).for("update");
  return row;
}

export async function updatePayment(tx: PlatformTx, id: string, patch: Partial<BillingPayment>): Promise<void> {
  await tx.update(billingPayments).set(patch).where(eq(billingPayments.id, id));
}

// The bills a payment paid, and how much of each.
export async function allocationsOf(tx: PlatformTx, paymentId: string): Promise<{ invoiceId: string; amountPaise: bigint }[]> {
  return tx.select({ invoiceId: billingAllocations.invoiceId, amountPaise: billingAllocations.amountPaise }).from(billingAllocations).where(eq(billingAllocations.paymentId, paymentId));
}

// Takes a cancelled payment's money back off a bill, which is open again.
export async function deallocate(tx: PlatformTx, invoiceId: string, amountPaise: bigint): Promise<void> {
  await tx
    .update(billingInvoices)
    .set({ paidPaise: sql`${billingInvoices.paidPaise} - ${amountPaise.toString()}::bigint`, status: "open" })
    .where(eq(billingInvoices.id, invoiceId));
}

// Puts part of a payment on a bill; the bill is paid once nothing is left.
export async function allocate(tx: PlatformTx, row: { tenantId: string; paymentId: string; invoiceId: string; amountPaise: bigint }): Promise<void> {
  await tx.insert(billingAllocations).values({ id: uuidv7(), ...row });
  const paid = sql`${billingInvoices.paidPaise} + ${row.amountPaise.toString()}::bigint`;
  await tx
    .update(billingInvoices)
    .set({ paidPaise: paid, status: sql`CASE WHEN ${paid} = ${billingInvoices.totalPaise} THEN 'paid' ELSE 'open' END` })
    .where(eq(billingInvoices.id, row.invoiceId));
}

export type ListedPayment = BillingPayment & { academyName: string; activityName: string; branchName: string };

// Newest first, with who paid and for what; every academy's unless given.
export async function listPayments(tx: AnyTx, opts: { tenantIds?: string[]; limit?: number } = {}): Promise<ListedPayment[]> {
  const rows = await tx
    .select({ p: billingPayments, academyName: tenants.name, activityName: activities.name, branchName: branches.name })
    .from(billingPayments)
    .innerJoin(tenants, eq(tenants.id, billingPayments.tenantId))
    .innerJoin(activitySubscriptions, eq(activitySubscriptions.id, billingPayments.subscriptionId))
    .innerJoin(activities, eq(activities.key, activitySubscriptions.activityKey))
    .innerJoin(branches, eq(branches.id, activitySubscriptions.branchId))
    .where(opts.tenantIds ? inArray(billingPayments.tenantId, opts.tenantIds) : undefined)
    .orderBy(desc(billingPayments.createdAt))
    .limit(opts.limit ?? 50);
  return rows.map(({ p, ...names }) => ({ ...p, ...names }));
}

export type OwedBill = { id: string; tenantId: string; academyName: string; timezone: string; number: string; description: string; dueOn: string; balance: bigint };

// Every academy's unpaid bills (or those of the given ones), the longest due first.
export async function owedBills(tx: PlatformTx, tenantIds?: string[]): Promise<OwedBill[]> {
  return tx
    .select({
      id: billingInvoices.id,
      tenantId: billingInvoices.tenantId,
      academyName: tenants.name,
      timezone: tenants.timezone,
      number: billingInvoices.number,
      description: billingInvoices.description,
      dueOn: billingInvoices.dueOn,
      balance: sql<bigint>`${billingInvoices.totalPaise} - ${billingInvoices.paidPaise}`.mapWith(BigInt),
    })
    .from(billingInvoices)
    .innerJoin(tenants, eq(tenants.id, billingInvoices.tenantId))
    .where(and(eq(billingInvoices.status, "open"), isNull(tenants.deletedAt), tenantIds ? inArray(billingInvoices.tenantId, tenantIds) : undefined))
    .orderBy(asc(billingInvoices.dueOn), asc(billingInvoices.number));
}

// What academies paid Bravitar from a date on; cancelled payments left out.
export async function receivedSince(tx: PlatformTx, from: string, tenantIds?: string[]): Promise<bigint> {
  const [row] = await tx
    .select({ total: sql<bigint>`coalesce(sum(${billingPayments.amountPaise}), 0)`.mapWith(BigInt) })
    .from(billingPayments)
    .where(and(isNull(billingPayments.cancelledAt), gte(billingPayments.receivedOn, from), tenantIds ? inArray(billingPayments.tenantId, tenantIds) : undefined));
  return row?.total ?? 0n;
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
