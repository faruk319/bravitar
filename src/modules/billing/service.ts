import { eq } from "drizzle-orm";
import { z } from "zod";
import { type AuditEntry, writeAudit } from "@/lib/db/audit";
import { type PlatformTx, platformRead, withPlatformAdmin } from "@/lib/db/platform";
import { addDays, nextMonthOn } from "@/lib/dates";
import { ConflictError, isUniqueViolation, NotFoundError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import { financialYear } from "@/lib/money/fy";
import { parseRupees, percent } from "@/lib/money/paise";
import { students } from "./access";
import {
  activityStudentCounts,
  allocateInvoiceNumber,
  getActivity,
  getBillingSettings,
  getPlan,
  insertInvoice,
  insertSubscription,
  listActivities,
  listPlans,
  liveSubscriptions,
  lockSubscription,
  overdueNumbers,
  type PriceChange,
  recentPriceChanges,
  staffCounts,
  subscriptionLabel,
  subscriptionsPerPlan,
  updateSubscription,
  usageKey,
} from "./repo";
import {
  ACTIVITY_STATUSES,
  type Activity,
  activities,
  type ActivityPlan,
  activityPlans,
  type ActivitySubscription,
  billingSettings,
  type BillingSettings,
  planPriceHistory,
} from "./schema";

// Bravitar's own billing (agreed 2026-09-30). Every write goes through the
// platform role; academies only read their rows.

type Actor = Pick<AuditEntry, "actorType" | "actorId">;

// What the next bill charges: the override while it lasts, else the price
// agreed when the activity started or last moved up a plan.
export function effectivePrice(s: Pick<ActivitySubscription, "pricePaise" | "overridePaise" | "overrideUntil">, on: string): bigint {
  return s.overridePaise !== null && (s.overrideUntil === null || on <= s.overrideUntil) ? s.overridePaise : s.pricePaise;
}

export type StartInput = { tenantId: string; branchId: string; activityKey: string; planId?: string | undefined; today: string; trial: boolean };

// On the given plan, else the cheapest one on offer, at its price today. Only
// an academy's first activity in its first branch gets the trial; any other
// start bills its first month at once.
export async function startActivity(tx: PlatformTx, input: StartInput): Promise<ActivitySubscription> {
  const activity = await getActivity(tx, input.activityKey);
  if (!activity) throw new NotFoundError("Activity");
  if (activity.status !== "active") throw new ConflictError(`${activity.name} isn't available yet`);
  const plan = input.planId ? await getPlan(tx, input.planId) : (await listPlans(tx, activity.key)).find((p) => p.isOffered);
  if (!plan || plan.activityKey !== activity.key) throw input.planId ? new NotFoundError("Plan") : new ConflictError(`${activity.name} has no plan on offer`);
  const periodEnd = input.trial ? addDays(input.today, (await getBillingSettings(tx)).trialDays) : input.today;
  const created = await insertSubscription(tx, {
    tenantId: input.tenantId,
    branchId: input.branchId,
    activityKey: activity.key,
    planId: plan.id,
    status: input.trial ? "trial" : "active",
    pricePaise: plan.pricePaise,
    anchorDay: Number(periodEnd.slice(8)),
    periodStart: input.today,
    periodEnd,
  }).catch((e: unknown) => {
    if (isUniqueViolation(e)) throw new ConflictError(`${activity.name} is already on in this branch`);
    throw e;
  });
  return input.trial ? created : (await renew(tx, created, input.today)).subscription;
}

// ---- bills (agreed 2026-09-30): monthly in advance on the anchor day, one
// per activity in a branch; a ₹0 month has no bill.

export type Renewal = { subscription: ActivitySubscription; invoices: string[]; droppedPlanId: string | null };

// Brings a locked subscription up to today, a month at a time: it ends if
// cancelled at period end, takes a waiting downgrade that still fits (else
// drops it), leaves its trial, and bills the month. Paused ones are billed too.
export async function renew(tx: PlatformTx, s: ActivitySubscription, today: string): Promise<Renewal> {
  let cur = s;
  let droppedPlanId: string | null = null;
  const invoices: string[] = [];
  while (cur.status !== "cancelled" && cur.periodEnd <= today) {
    if (cur.cancelAtPeriodEnd) {
      cur = { ...cur, status: "cancelled", cancelledAt: new Date() };
      break;
    }
    if (cur.nextPlanId) {
      const plan = await getPlan(tx, cur.nextPlanId);
      if (plan && (await fits(tx, cur, plan))) cur = { ...cur, planId: plan.id, pricePaise: plan.pricePaise };
      else droppedPlanId = cur.nextPlanId;
      cur = { ...cur, nextPlanId: null };
    }
    const start = cur.periodEnd;
    const end = nextMonthOn(start, cur.anchorDay);
    const amount = effectivePrice(cur, start);
    if (amount > 0n) invoices.push(await issueInvoice(tx, cur, start, end, amount, today));
    cur = { ...cur, status: cur.status === "trial" ? "active" : cur.status, periodStart: start, periodEnd: end };
  }
  if (cur !== s) {
    const { status, planId, pricePaise, nextPlanId, periodStart, periodEnd, cancelledAt } = cur;
    await updateSubscription(tx, s.id, { status, planId, pricePaise, nextPlanId, periodStart, periodEnd, cancelledAt });
  }
  return { subscription: cur, invoices, droppedPlanId };
}

async function fits(tx: PlatformTx, s: ActivitySubscription, plan: ActivityPlan): Promise<boolean> {
  try {
    await assertFits(tx, s, plan);
    return true;
  } catch (e) {
    if (e instanceof ConflictError) return false;
    throw e;
  }
}

// Numbered in this transaction, taxed at today's rate, due after the grace
// days, and audited on its own.
async function issueInvoice(tx: PlatformTx, s: ActivitySubscription, periodStart: string, periodEnd: string, subtotal: bigint, today: string): Promise<string> {
  const settings = await getBillingSettings(tx);
  const tax = percent(subtotal, settings.taxRateBp);
  const number = await allocateInvoiceNumber(tx, financialYear(today));
  const invoice = await insertInvoice(tx, {
    tenantId: s.tenantId,
    subscriptionId: s.id,
    number,
    description: await subscriptionLabel(tx, s),
    periodStart,
    periodEnd,
    subtotalPaise: subtotal,
    taxRateBp: settings.taxRateBp,
    taxPaise: tax,
    totalPaise: subtotal + tax,
    gstin: settings.gstin,
    issuedOn: today,
    dueOn: addDays(today, settings.graceDays),
  });
  await writeAudit(tx, {
    actorType: "system",
    action: "billing_invoice.issue",
    tenantId: s.tenantId,
    entityType: "billing_invoice",
    entityId: invoice.id,
    after: { number, totalPaise: String(invoice.totalPaise), periodStart },
  });
  return number;
}

// The renewal job's work on one subscription, in its own transaction.
export async function renewSubscription(id: string, today: string): Promise<Renewal> {
  return withPlatformAdmin({ actorType: "system", action: "subscription.renew", entityType: "activity_subscription", entityId: id }, async (tx, audit) => {
    const s = await lockSubscription(tx, id);
    if (!s) throw new NotFoundError("Subscription");
    audit.tenantId = s.tenantId;
    audit.before = { status: s.status, planId: s.planId, periodEnd: s.periodEnd };
    const r = await renew(tx, s, today);
    const { status, planId, periodEnd } = r.subscription;
    audit.after = { status, planId, periodEnd, invoices: r.invoices, droppedPlanId: r.droppedPlanId };
    return r;
  });
}

// An active activity with a bill unpaid past its due date pauses; bills keep
// coming, and paying resumes it (step 4).
export async function pauseIfOverdue(id: string, today: string): Promise<boolean> {
  return withPlatformAdmin({ actorType: "system", action: "subscription.pause", entityType: "activity_subscription", entityId: id }, async (tx, audit) => {
    const s = await lockSubscription(tx, id);
    if (!s) throw new NotFoundError("Subscription");
    audit.tenantId = s.tenantId;
    const overdue = s.status === "active" ? await overdueNumbers(tx, id, today) : [];
    audit.after = { overdue };
    if (!overdue.length) return false;
    await updateSubscription(tx, id, { status: "paused", pausedAt: new Date() });
    return true;
  });
}

// Ends at the end of the paid month (or the trial) with no more bills; it can
// be turned off until then.
export async function setCancelAtPeriodEnd(actor: Actor, subscriptionId: string, cancel: boolean): Promise<void> {
  await withPlatformAdmin({ ...actor, action: cancel ? "subscription.cancel" : "subscription.cancel.undo", entityType: "activity_subscription", entityId: subscriptionId }, async (tx, audit) => {
    const s = await lockSubscription(tx, subscriptionId);
    if (!s || s.status === "cancelled") throw new NotFoundError("Subscription");
    audit.tenantId = s.tenantId;
    audit.after = { endsOn: cancel ? s.periodEnd : null };
    await updateSubscription(tx, s.id, { cancelAtPeriodEnd: cancel });
  });
}

// Would this subscription's usage fit the plan's limits?
async function assertFits(tx: PlatformTx, s: ActivitySubscription, plan: ActivityPlan): Promise<void> {
  if (plan.maxStudents !== null) {
    const n = (await activityStudentCounts(tx, { tenantIds: [s.tenantId], branchId: s.branchId, activityKey: s.activityKey })).get(usageKey(s.branchId, s.activityKey)) ?? 0;
    if (n > plan.maxStudents) throw new ConflictError(`${students(n)} in it here; ${plan.name} allows ${plan.maxStudents}.`);
  }
  if (plan.maxStaff !== null) {
    const others = (await liveSubscriptions(tx, { tenantIds: [s.tenantId] })).filter((x) => x.id !== s.id).map((x) => x.plan.maxStaff);
    if (others.includes(null)) return; // another plan has no staff limit
    const allowed = others.reduce<number>((sum, m) => sum + (m ?? 0), plan.maxStaff) + 1; // plus one owner
    const staff = (await staffCounts(tx, [s.tenantId])).get(s.tenantId) ?? 0;
    if (staff > allowed) throw new ConflictError(`The academy has ${staff} staff; with ${plan.name} its plans allow ${allowed}.`);
  }
}

export type PlanChange = "now" | "at_period_end" | "unchanged";

// Same price or more: now, billed from the next bill. Less: waits for the end
// of the paid month, if usage fits. Choosing the current plan cancels a
// waiting downgrade. Owners pick offered plans; the platform any.
export async function changePlan(actor: Actor, subscriptionId: string, planId: string): Promise<PlanChange> {
  return withPlatformAdmin({ ...actor, action: "subscription.plan.change", entityType: "activity_subscription", entityId: subscriptionId }, async (tx, audit) => {
    const s = await lockSubscription(tx, subscriptionId);
    if (!s || s.status === "cancelled") throw new NotFoundError("Subscription");
    audit.tenantId = s.tenantId;
    audit.before = { planId: s.planId, pricePaise: String(s.pricePaise), nextPlanId: s.nextPlanId };
    const plan = await getPlan(tx, planId);
    if (!plan || plan.activityKey !== s.activityKey) throw new NotFoundError("Plan");
    const set = (patch: Partial<ActivitySubscription>) => updateSubscription(tx, s.id, patch);
    let result: PlanChange;
    if (plan.id === s.planId) {
      await set({ nextPlanId: null });
      result = "unchanged";
    } else if (!plan.isOffered && actor.actorType === "staff") {
      throw new ConflictError(`${plan.name} isn't on offer`);
    } else if (plan.pricePaise >= s.pricePaise) {
      await set({ planId: plan.id, pricePaise: plan.pricePaise, nextPlanId: null });
      result = "now";
    } else {
      await assertFits(tx, s, plan);
      await set({ nextPlanId: plan.id });
      result = "at_period_end";
    }
    audit.after = { planId: plan.id, when: result };
    return result;
  });
}

// ---- the catalog and settings, in /platform/activities

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

export const activityEditSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: optionalText(200),
  status: z.enum(ACTIVITY_STATUSES),
});

export async function editActivity(actor: Actor, key: string, input: z.input<typeof activityEditSchema>): Promise<void> {
  const d = activityEditSchema.parse(input);
  await withPlatformAdmin({ ...actor, action: "activity.edit", entityType: "activity", after: { key, ...d } }, async (tx, audit) => {
    const [before] = await tx.select().from(activities).where(eq(activities.key, key));
    if (!before) throw new NotFoundError("Activity");
    audit.before = { key, name: before.name, description: before.description, status: before.status };
    await tx.update(activities).set({ ...d, updatedAt: new Date() }).where(eq(activities.key, key));
  });
}

const limit = z.union([z.literal(""), z.coerce.number().int().min(0).max(1_000_000)]).transform((v) => (v === "" ? null : v)); // blank = no limit

export const planSchema = z.object({
  name: z.string().trim().min(2, "Give the plan a name").max(40),
  price: z.string().trim().transform((v, ctx) => parseRupees(v) ?? (ctx.addIssue({ code: "custom", message: "Enter the price in rupees" }), z.NEVER)),
  maxStudents: limit,
  maxStaff: limit,
  isOffered: z.boolean(),
  reason: optionalText(200),
});

const planAudit = (p: Pick<ActivityPlan, "name" | "pricePaise" | "maxStudents" | "maxStaff" | "isOffered">) => ({
  name: p.name,
  price: String(p.pricePaise),
  maxStudents: p.maxStudents,
  maxStaff: p.maxStaff,
  isOffered: p.isOffered,
});

const nameTaken = (name: string) => (e: unknown) => {
  if (isUniqueViolation(e)) throw new ConflictError(`There is already a plan called ${name}`);
  throw e;
};

export async function addPlan(actor: Actor, activityKey: string, input: z.input<typeof planSchema>): Promise<ActivityPlan> {
  const d = planSchema.parse(input);
  const values = { name: d.name, pricePaise: d.price, maxStudents: d.maxStudents, maxStaff: d.maxStaff, isOffered: d.isOffered };
  return withPlatformAdmin({ ...actor, action: "activity_plan.create", entityType: "activity_plan", after: { activityKey, ...planAudit(values) } }, async (tx, audit) => {
    if (!(await getActivity(tx, activityKey))) throw new NotFoundError("Activity");
    const [plan] = await tx
      .insert(activityPlans)
      .values({ id: uuidv7(), activityKey, ...values })
      .returning()
      .catch(nameTaken(d.name));
    if (!plan) throw new Error("plan insert returned no row");
    audit.entityId = plan.id;
    return plan;
  });
}

// A new price is for activities started from now on (every change is kept);
// new limits apply to everyone on the plan.
export async function editPlan(actor: Actor, planId: string, input: z.input<typeof planSchema>): Promise<void> {
  const d = planSchema.parse(input);
  const values = { name: d.name, pricePaise: d.price, maxStudents: d.maxStudents, maxStaff: d.maxStaff, isOffered: d.isOffered };
  await withPlatformAdmin({ ...actor, action: "activity_plan.edit", entityType: "activity_plan", entityId: planId, after: planAudit(values) }, async (tx, audit) => {
    const [before] = await tx.select().from(activityPlans).where(eq(activityPlans.id, planId)).for("update");
    if (!before) throw new NotFoundError("Plan");
    audit.before = planAudit(before);
    if (before.pricePaise !== d.price) {
      await tx.insert(planPriceHistory).values({ planId, oldPaise: before.pricePaise, newPaise: d.price, reason: d.reason, changedBy: actor.actorType === "platform" ? (actor.actorId ?? null) : null });
    }
    await tx
      .update(activityPlans)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(activityPlans.id, planId))
      .catch(nameTaken(d.name));
  });
}

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const settingsSchema = z
  .object({
    graceDays: z.coerce.number().int().min(0).max(60),
    trialDays: z.coerce.number().int().min(0).max(365),
    taxPercent: z
      .string()
      .trim()
      .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter the tax as a percent")
      .transform((v) => Math.round(Number(v) * 100))
      .refine((bp) => bp <= 10_000, "Tax can't be over 100%"),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === "" || GSTIN.test(v), "That isn't a GSTIN")
      .transform((v) => v || null),
    howToPay: optionalText(1000),
  })
  .refine((d) => d.taxPercent === 0 || d.gstin, { message: "Add the GSTIN before charging tax", path: ["gstin"] })
  .transform(({ taxPercent, ...d }) => ({ ...d, taxRateBp: taxPercent }));

export async function editBillingSettings(actor: Actor, input: z.input<typeof settingsSchema>): Promise<void> {
  const d = settingsSchema.parse(input);
  await withPlatformAdmin({ ...actor, action: "billing_settings.edit", entityType: "billing_settings", after: d }, async (tx, audit) => {
    const s = await getBillingSettings(tx);
    audit.before = Object.fromEntries(Object.keys(d).map((k) => [k, s[k as keyof typeof d]]));
    await tx.update(billingSettings).set({ ...d, updatedAt: new Date() }).where(eq(billingSettings.id, true));
  });
}

// Offered first, each cheapest first: for pickers.
export async function allPlans(): Promise<ActivityPlan[]> {
  const plans = await platformRead((tx) => listPlans(tx));
  return [...plans.filter((p) => p.isOffered), ...plans.filter((p) => !p.isOffered)];
}

export type CatalogPlan = ActivityPlan & { branches: number; changes: PriceChange[] };
export type CatalogActivity = Activity & { plans: CatalogPlan[] };

export async function activityCatalog(): Promise<{ activities: CatalogActivity[]; settings: BillingSettings }> {
  return platformRead(async (tx) => {
    const [list, plans, used, changes] = [await listActivities(tx), await listPlans(tx), await subscriptionsPerPlan(tx), await recentPriceChanges(tx)];
    const withUse = plans.map((p) => ({ ...p, branches: used.get(p.id) ?? 0, changes: changes.filter((c) => c.planId === p.id) }));
    return { activities: list.map((a) => ({ ...a, plans: withUse.filter((p) => p.activityKey === a.key) })), settings: await getBillingSettings(tx) };
  });
}
