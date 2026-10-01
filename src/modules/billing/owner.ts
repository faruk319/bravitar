import { z } from "zod";
import { assertCan, ForbiddenError } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { writeAudit } from "@/lib/db/audit";
import type { Tx } from "@/lib/db/client";
import { withPlatformAdmin } from "@/lib/db/platform";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { createBranch, getBranch, getOwnTenant, listBranches, renameBranch, tenantToday } from "@/modules/tenancy/repo";
import {
  activityStudentCounts,
  type BillPayment,
  getActivity,
  getBillingSettings,
  getInvoice,
  getPlan,
  getSubscription,
  type ListedPayment,
  listInvoices,
  listPayments,
  listActivities,
  listPlans,
  liveSubscriptions,
  openBalances,
  paymentsForBill,
  staffCounts,
  staffSeats,
  type SubscriptionRow,
  usageKey,
} from "./repo";
import type { ActivityPlan, ActivitySubscription, BillingInvoice } from "./schema";
import { changePlan, dueToStart, type PlanChange, setCancelAtPeriodEnd, startActivity } from "./service";

// The academy's own Billing page (agreed 2026-09-30). Everything is read
// through its transaction, so row-level security keeps it to this academy;
// staff kept to some branches see those branches only.

// duePaise: what paying now takes. The first period while waiting, else what
// its bills still owe; nothing on trial.
export type OwnerModule = SubscriptionRow & { students: number; duePaise: bigint };
export type OwnerBranch = { id: string; name: string; isDefault: boolean; modules: OwnerModule[] };
export type BillingPageData = {
  today: string;
  branches: OwnerBranch[];
  staff: number;
  staffLimit: number | null; // its plans' seats plus one owner; null = no limit
  bills: BillingInvoice[];
  payments: ListedPayment[];
  howToPay: string | null;
  offer: { modules: { key: string; name: string }[]; plans: ActivityPlan[] }; // what an owner may start or move to
};

export async function billingPage(tx: Tx, ctx: ScopedCtx): Promise<BillingPageData> {
  assertCan(ctx, "billing:view");
  const mine = (branchId: string) => !ctx.branchIds.length || ctx.branchIds.includes(branchId);
  const ids = [ctx.tenantId];
  const [today, branches, subs, students, staff, seats, owed, settings] = [
    await tenantToday(tx),
    (await listBranches(tx)).filter((b) => mine(b.id)).sort((x, y) => Number(y.isDefault) - Number(x.isDefault)), // the first branch first
    await liveSubscriptions(tx),
    await activityStudentCounts(tx, { tenantIds: ids }),
    await staffCounts(tx, ids),
    await staffSeats(tx, { tenantIds: ids }),
    await openBalances(tx, ids),
    await getBillingSettings(tx),
  ];
  const due = (s: SubscriptionRow) => (s.status === "pending" ? dueToStart(s, settings.taxRateBp, today) : s.status === "trial" ? 0n : (owed.get(s.id) ?? 0n));
  const seat = seats.get(ctx.tenantId);
  const shown = new Set(subs.filter((s) => mine(s.branchId)).map((s) => s.id));
  const [modules, plans] = [await listActivities(tx), await listPlans(tx)];
  return {
    today,
    branches: branches.map((b) => ({
      id: b.id,
      name: b.name,
      isDefault: b.isDefault,
      modules: subs.filter((s) => s.branchId === b.id).map((s) => ({ ...s, students: students.get(usageKey(b.id, s.activityKey)) ?? 0, duePaise: due(s) })),
    })),
    staff: staff.get(ctx.tenantId) ?? 0,
    staffLimit: seat === null ? null : (seat ?? 0) + 1,
    bills: (await listInvoices(tx, { tenantIds: ids })).filter((i) => shown.has(i.subscriptionId)),
    payments: (await listPayments(tx, { tenantIds: ids })).filter((p) => shown.has(p.subscriptionId)),
    howToPay: settings.howToPay,
    offer: { modules: modules.filter((a) => a.status === "active").map((a) => ({ key: a.key, name: a.name })), plans: plans.filter((p) => p.isOffered) },
  };
}

export type BillPageData = { today: string; bill: BillingInvoice; payments: BillPayment[]; academy: { name: string; gstin: string | null } };

// One bill, to read or print; another academy's (or another branch's, for
// staff kept to some branches) is not found.
export async function billPage(tx: Tx, ctx: ScopedCtx, invoiceId: string): Promise<BillPageData> {
  assertCan(ctx, "billing:view");
  const bill = await getInvoice(tx, invoiceId);
  const sub = bill ? await getSubscription(tx, bill.subscriptionId) : undefined;
  if (!bill || !sub || (ctx.branchIds.length && !ctx.branchIds.includes(sub.branchId))) throw new NotFoundError("Bill");
  const tenant = await getOwnTenant(tx);
  return { today: await tenantToday(tx), bill, payments: await paymentsForBill(tx, bill.id), academy: { name: tenant?.name ?? "", gstin: tenant?.gstin ?? null } };
}

// ---- the owner's changes (agreed 2026-09-30). Each target is read through
// the academy's own rules first, so another academy's module or branch is
// not found; the platform role then writes it.

const asStaff = (ctx: ScopedCtx) => ({ actorType: "staff" as const, actorId: ctx.staffId });
const inScope = (ctx: ScopedCtx, branchId: string) => !ctx.branchIds.length || ctx.branchIds.includes(branchId);

async function ownModule(tx: Tx, ctx: ScopedCtx, id: string): Promise<ActivitySubscription> {
  const s = await getSubscription(tx, id);
  if (!s || s.status === "cancelled" || !inScope(ctx, s.branchId)) throw new NotFoundError("Module");
  return s;
}

// Offered plans only (changePlan checks that for staff).
export async function ownerChangePlan(tx: Tx, ctx: ScopedCtx, subscriptionId: string, planId: string): Promise<PlanChange> {
  assertCan(ctx, "billing:manage");
  await ownModule(tx, ctx, subscriptionId);
  return changePlan(asStaff(ctx), subscriptionId, planId);
}

export async function ownerSetCancel(tx: Tx, ctx: ScopedCtx, subscriptionId: string, cancel: boolean): Promise<void> {
  assertCan(ctx, "billing:manage");
  await ownModule(tx, ctx, subscriptionId);
  await setCancelAtPeriodEnd(asStaff(ctx), subscriptionId, cancel);
}

const moduleSchema = z.object({ activityKey: z.string().min(1, "Pick a module"), planId: z.uuid("Pick a plan") });
const branchName = z.string().trim().min(2, "Give the branch a name").max(120);

// Owners start offered modules on offered plans only.
async function assertOffered(tx: Tx, activityKey: string, planId: string): Promise<void> {
  const activity = await getActivity(tx, activityKey);
  if (!activity || activity.status !== "active") throw new ConflictError(`${activity?.name ?? "That module"} isn't on offer`);
  const plan = await getPlan(tx, planId);
  if (!plan || plan.activityKey !== activityKey || !plan.isOffered) throw new ConflictError("Pick a plan on offer");
}

// Branch names are unique in an academy, whatever the case.
async function assertNewName(tx: Tx, name: string, except?: string): Promise<void> {
  if ((await listBranches(tx)).some((b) => b.id !== except && b.name.toLowerCase() === name.toLowerCase())) throw new ConflictError(`There is already a branch called ${name}`);
}

// A module in a branch: it waits for its first payment, or starts at once
// when free (pay first).
export async function startModule(tx: Tx, ctx: ScopedCtx, branchId: string, input: z.input<typeof moduleSchema>): Promise<ActivitySubscription> {
  assertCan(ctx, "billing:manage");
  const d = moduleSchema.parse(input);
  if (!(await getBranch(tx, branchId)) || !inScope(ctx, branchId)) throw new NotFoundError("Branch");
  await assertOffered(tx, d.activityKey, d.planId);
  const today = await tenantToday(tx);
  return withPlatformAdmin({ ...asStaff(ctx), tenantId: ctx.tenantId, action: "subscription.start", entityType: "activity_subscription" }, async (ptx, audit) => {
    const s = await startActivity(ptx, { tenantId: ctx.tenantId, branchId, activityKey: d.activityKey, planId: d.planId, today, trial: false });
    audit.entityId = s.id;
    audit.after = { branchId, activityKey: d.activityKey, planId: d.planId, status: s.status };
    return s;
  });
}

// A new branch comes with its first module, in one go.
export async function addBranch(tx: Tx, ctx: ScopedCtx, input: z.input<typeof moduleSchema> & { name: string }): Promise<{ branchId: string; subscription: ActivitySubscription }> {
  assertCan(ctx, "billing:manage");
  if (ctx.branchIds.length) throw new ForbiddenError("Only staff with every branch can add one");
  const d = moduleSchema.extend({ name: branchName }).parse(input);
  await assertNewName(tx, d.name);
  await assertOffered(tx, d.activityKey, d.planId);
  const today = await tenantToday(tx);
  return withPlatformAdmin({ ...asStaff(ctx), tenantId: ctx.tenantId, action: "branch.create", entityType: "branch" }, async (ptx, audit) => {
    const branch = await createBranch(ptx, { tenantId: ctx.tenantId, name: d.name });
    const subscription = await startActivity(ptx, { tenantId: ctx.tenantId, branchId: branch.id, activityKey: d.activityKey, planId: d.planId, today, trial: false });
    audit.entityId = branch.id;
    audit.after = { name: d.name, activityKey: d.activityKey, planId: d.planId, status: subscription.status };
    return { branchId: branch.id, subscription };
  });
}

export async function ownerRenameBranch(tx: Tx, ctx: ScopedCtx, branchId: string, input: { name?: unknown }): Promise<void> {
  assertCan(ctx, "settings:manage");
  const name = branchName.parse(input.name);
  const branch = await getBranch(tx, branchId);
  if (!branch || !inScope(ctx, branchId)) throw new NotFoundError("Branch");
  await assertNewName(tx, name, branchId);
  await renameBranch(tx, branchId, name);
  await writeAudit(tx, { actorType: "staff", actorId: ctx.staffId, tenantId: ctx.tenantId, action: "branch.rename", entityType: "branch", entityId: branchId, before: { name: branch.name }, after: { name } });
}
