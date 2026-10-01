import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type AuditEntry, writeAudit } from "@/lib/db/audit";
import { type PlatformTx, platformRead, withPlatformAdmin } from "@/lib/db/platform";
import { addDays, isIsoDate, monthsLaterOn, todayIn } from "@/lib/dates";
import { BadRequestError, ConflictError, isUniqueViolation, NotFoundError } from "@/lib/errors";
import { ACTIVITY_ICONS } from "@/lib/activities";
import { uuidv7 } from "@/lib/ids";
import { financialYear } from "@/lib/money/fy";
import { parseRupees, percent, sum } from "@/lib/money/paise";
import { students } from "./access";
import {
  academyToday,
  activityStudentCounts,
  allocateInvoiceNumber,
  defaultPlan,
  getActivity,
  getBillingSettings,
  getPlan,
  insertInvoice,
  insertSubscription,
  type ListedPayment,
  type ListedSubscription,
  listActivities,
  listPayments,
  listPlans,
  liveSubscriptions,
  lockSubscription,
  overdueNumbers,
  type OwedBill,
  owedBills,
  receivedSince,
  type PriceChange,
  recentPriceChanges,
  staffCounts,
  subscriptionLabel,
  type SubscriptionFilters,
  subscriptionList,
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
  type BillingInvoice,
  BILLING_INTERVALS,
  type BillingInterval,
  billingSettings,
  type BillingSettings,
  planPriceHistory,
} from "./schema";

// Bravitar's own billing (agreed 2026-09-30). Every write goes through the
// platform role; academies only read their rows.

type Actor = Pick<AuditEntry, "actorType" | "actorId">;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

// What the next bill charges: the override while it lasts, else the price
// agreed when the activity started or last moved up a plan.
export function effectivePrice(s: Pick<ActivitySubscription, "pricePaise" | "overridePaise" | "overrideUntil">, on: string): bigint {
  return s.overridePaise !== null && (s.overrideUntil === null || on <= s.overrideUntil) ? s.overridePaise : s.pricePaise;
}

export type StartInput = { tenantId: string; branchId: string; activityKey: string; planId?: string | undefined; today: string; trial: boolean };

// On the given plan, else the module's default one, at its price today. Only
// an academy's first activity in its first branch gets the trial. Any other
// paid start waits for its first payment (pay first, agreed 2026-09-30); a
// free one starts at once. The platform may start a module that is coming
// soon, never a retired one; owners get offered modules only (agreed 2026-10-01).
export async function startActivity(tx: PlatformTx, input: StartInput): Promise<ActivitySubscription> {
  const activity = await getActivity(tx, input.activityKey);
  if (!activity) throw new NotFoundError("Activity");
  if (activity.status === "retired") throw new ConflictError(`${activity.name} isn't offered any more`);
  const plan = input.planId ? await getPlan(tx, input.planId) : await defaultPlan(tx, activity.key);
  if (!plan || plan.activityKey !== activity.key) throw input.planId ? new NotFoundError("Plan") : new ConflictError(`${activity.name} has no plan on offer`);
  const periodEnd = input.trial ? addDays(input.today, activity.trialDays ?? (await getBillingSettings(tx)).trialDays) : input.today;
  const created = await insertSubscription(tx, {
    tenantId: input.tenantId,
    branchId: input.branchId,
    activityKey: activity.key,
    planId: plan.id,
    status: input.trial ? "trial" : plan.pricePaise > 0n ? "pending" : "active",
    pricePaise: plan.pricePaise,
    billingInterval: plan.billingInterval,
    anchorDay: Number(periodEnd.slice(8)),
    periodStart: input.today,
    periodEnd,
  }).catch((e: unknown) => {
    if (isUniqueViolation(e)) throw new ConflictError(`${activity.name} is already on in this branch`);
    throw e;
  });
  return created.status === "active" ? (await renew(tx, created, input.today)).subscription : created;
}

// ---- bills (agreed 2026-09-30): in advance on the anchor day, monthly or
// yearly, one per activity in a branch; a ₹0 period has no bill.

const CYCLE_MONTHS: Record<BillingInterval, number> = { month: 1, year: 12 };

export type Renewal = { subscription: ActivitySubscription; invoices: string[]; droppedPlanId: string | null };

// Brings a locked subscription up to today, a period at a time: it ends if
// cancelled at period end, takes a waiting downgrade that still fits (else
// drops it) and bills the period; paused ones are billed too. A trial that
// ends with something to pay waits for its first payment instead.
export async function renew(tx: PlatformTx, s: ActivitySubscription, today: string): Promise<Renewal> {
  let cur = s;
  let droppedPlanId: string | null = null;
  const invoices: string[] = [];
  while (cur.status !== "cancelled" && cur.status !== "pending" && cur.periodEnd <= today) {
    if (cur.cancelAtPeriodEnd) {
      cur = { ...cur, status: "cancelled", cancelledAt: new Date() };
      break;
    }
    if (cur.nextPlanId) {
      const plan = await getPlan(tx, cur.nextPlanId);
      if (plan && (await fits(tx, cur, plan))) cur = { ...cur, planId: plan.id, pricePaise: plan.pricePaise, billingInterval: plan.billingInterval };
      else droppedPlanId = cur.nextPlanId;
      cur = { ...cur, nextPlanId: null };
    }
    const start = cur.periodEnd;
    const end = monthsLaterOn(start, CYCLE_MONTHS[cur.billingInterval], cur.anchorDay);
    const amount = effectivePrice(cur, start);
    if (cur.status === "trial" && amount > 0n) {
      cur = { ...cur, status: "pending" };
      break;
    }
    if (amount > 0n) invoices.push((await issueInvoice(tx, cur, { start, end }, amount, today)).number);
    cur = { ...cur, status: cur.status === "trial" ? "active" : cur.status, periodStart: start, periodEnd: end };
  }
  if (cur !== s) {
    const { status, planId, pricePaise, billingInterval, nextPlanId, periodStart, periodEnd, cancelledAt } = cur;
    await updateSubscription(tx, s.id, { status, planId, pricePaise, billingInterval, nextPlanId, periodStart, periodEnd, cancelledAt });
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

// The first paid period of a waiting module, or of one paid during its trial:
// from today, or from the trial's end.
export function firstPeriod(s: Pick<ActivitySubscription, "status" | "periodEnd" | "billingInterval">, today: string): { start: string; end: string } {
  const start = s.status === "trial" && s.periodEnd > today ? s.periodEnd : today;
  return { start, end: monthsLaterOn(start, CYCLE_MONTHS[s.billingInterval], Number(start.slice(8))) };
}

// What starting it costs: the first period's price, with tax.
export function dueToStart(s: ActivitySubscription, taxRateBp: number, today: string): bigint {
  const subtotal = effectivePrice(s, firstPeriod(s, today).start);
  return subtotal + percent(subtotal, taxRateBp);
}

// Numbered in this transaction, taxed at today's rate, due after the grace
// days unless told otherwise, and audited on its own.
export async function issueInvoice(tx: PlatformTx, s: ActivitySubscription, period: { start: string; end: string }, subtotal: bigint, today: string, dueOn?: string): Promise<BillingInvoice> {
  const settings = await getBillingSettings(tx);
  const tax = percent(subtotal, settings.taxRateBp);
  const number = await allocateInvoiceNumber(tx, financialYear(today));
  const invoice = await insertInvoice(tx, {
    tenantId: s.tenantId,
    subscriptionId: s.id,
    number,
    description: await subscriptionLabel(tx, s),
    periodStart: period.start,
    periodEnd: period.end,
    subtotalPaise: subtotal,
    taxRateBp: settings.taxRateBp,
    taxPaise: tax,
    totalPaise: subtotal + tax,
    gstin: settings.gstin,
    issuedOn: today,
    dueOn: dueOn ?? addDays(today, settings.graceDays),
  });
  await writeAudit(tx, {
    actorType: "system",
    action: "billing_invoice.issue",
    tenantId: s.tenantId,
    entityType: "billing_invoice",
    entityId: invoice.id,
    after: { number, totalPaise: String(invoice.totalPaise), periodStart: period.start },
  });
  return invoice;
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

// Free use or a special price (agreed 2026-09-30): from the next bill, until a
// date or for good; a blank price removes it. A waiting module that becomes
// free starts at once, since a free period starts at once.
export const priceSchema = z
  .object({
    price: z.string().trim(),
    until: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || null)
      .refine((v) => v === null || isIsoDate(v), "Pick a date"),
    reason: optionalText(200),
  })
  .transform((d, ctx) => {
    if (!d.price) return { paise: null, until: null, reason: null };
    const paise = parseRupees(d.price);
    if (paise === undefined) {
      ctx.addIssue({ code: "custom", message: "Enter the price in rupees", path: ["price"] });
      return z.NEVER;
    }
    if (!d.reason || d.reason.length < 3) {
      ctx.addIssue({ code: "custom", message: "Add a reason", path: ["reason"] });
      return z.NEVER;
    }
    return { paise, until: d.until, reason: d.reason };
  });

export async function setPrice(actor: Actor, subscriptionId: string, input: z.input<typeof priceSchema>, opts: { now?: Date } = {}): Promise<{ started: boolean }> {
  const d = priceSchema.parse(input);
  return withPlatformAdmin({ ...actor, action: "subscription.price", entityType: "activity_subscription", entityId: subscriptionId }, async (tx, audit) => {
    const s = await lockSubscription(tx, subscriptionId);
    if (!s || s.status === "cancelled") throw new NotFoundError("Subscription");
    audit.tenantId = s.tenantId;
    audit.before = { price: s.overridePaise === null ? null : String(s.overridePaise), until: s.overrideUntil, reason: s.overrideReason };
    const today = await academyToday(tx, s.tenantId, opts.now);
    if (d.until && d.until < today) throw new BadRequestError("The until date has passed");
    const priced = { ...s, overridePaise: d.paise, overrideUntil: d.until, overrideReason: d.reason };
    await updateSubscription(tx, s.id, { overridePaise: d.paise, overrideUntil: d.until, overrideReason: d.reason });
    const started = s.status === "pending" && effectivePrice(priced, today) === 0n;
    if (started) {
      const from = { status: "active" as const, anchorDay: Number(today.slice(8)), periodStart: today, periodEnd: today };
      await updateSubscription(tx, s.id, from);
      await renew(tx, { ...priced, ...from }, today); // the free period rolls on, with no bill
    }
    audit.after = { price: d.paise === null ? null : String(d.paise), until: d.until, reason: d.reason, started };
    return { started };
  });
}

export const trialDaysSchema = z.object({
  days: z.coerce.number().int().min(1, "At least 1 day").max(365, "At most 365 days"),
  reason: z.string().trim().min(3, "Add a reason").max(200),
});

// Extra trial days for one branch module (agreed 2026-10-01): a trial runs
// that much longer; a module waiting for payment goes on trial from today. A
// paid one gets free use instead.
export async function addTrialDays(actor: Actor, subscriptionId: string, input: z.input<typeof trialDaysSchema>, opts: { now?: Date } = {}): Promise<{ until: string }> {
  const d = trialDaysSchema.parse(input);
  return withPlatformAdmin({ ...actor, action: "subscription.trial.extend", entityType: "activity_subscription", entityId: subscriptionId }, async (tx, audit) => {
    const s = await lockSubscription(tx, subscriptionId);
    if (!s || s.status === "cancelled") throw new NotFoundError("Subscription");
    audit.tenantId = s.tenantId;
    if (s.status !== "trial" && s.status !== "pending") throw new ConflictError("Only a trial, or a module waiting for payment, can get trial days. Give a paid one free use instead.");
    const today = await academyToday(tx, s.tenantId, opts.now);
    const from = s.status === "trial" && s.periodEnd > today ? s.periodEnd : today;
    const until = addDays(from, d.days);
    await updateSubscription(tx, s.id, { status: "trial", periodStart: s.status === "trial" ? s.periodStart : today, periodEnd: until, anchorDay: Number(until.slice(8)) });
    audit.before = { status: s.status, until: s.periodEnd };
    audit.after = { days: d.days, reason: d.reason, until };
    return { until };
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

// Same cycle and the same price or more: now, billed from the next bill. Less,
// or another cycle: waits for the end of the paid period, if usage fits. On
// trial or waiting, nothing is paid yet: any plan that fits, at once. Choosing
// the current plan cancels a waiting change. Owners pick offered plans; the
// platform any.
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
    } else if (s.status === "trial" || s.status === "pending") {
      await assertFits(tx, s, plan);
      await set({ planId: plan.id, pricePaise: plan.pricePaise, billingInterval: plan.billingInterval, nextPlanId: null });
      result = "now";
    } else if (plan.billingInterval === s.billingInterval && plan.pricePaise >= s.pricePaise) {
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

// ---- the catalog and settings, in /platform/modules

// A module's own trial length; blank uses the Billing card's default.
const trialLength = z.union([z.literal(""), z.coerce.number().int().min(0).max(365)]).transform((v) => (v === "" ? null : v));

export const activityEditSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: optionalText(200),
  icon: z.enum(ACTIVITY_ICONS),
  status: z.enum(ACTIVITY_STATUSES),
  trialDays: trialLength.optional(),
});

export async function editActivity(actor: Actor, key: string, input: z.input<typeof activityEditSchema>): Promise<void> {
  const d = activityEditSchema.parse(input);
  await withPlatformAdmin({ ...actor, action: "activity.edit", entityType: "activity", after: { key, ...d } }, async (tx, audit) => {
    const [before] = await tx.select().from(activities).where(eq(activities.key, key));
    if (!before) throw new NotFoundError("Activity");
    audit.before = { key, name: before.name, description: before.description, icon: before.icon, status: before.status, trialDays: before.trialDays };
    await tx.update(activities).set({ ...d, updatedAt: new Date() }).where(eq(activities.key, key));
  });
}

const limit = z.union([z.literal(""), z.coerce.number().int().min(0).max(1_000_000)]).transform((v) => (v === "" ? null : v)); // blank = no limit

export const planSchema = z.object({
  name: z.string().trim().min(2, "Give the plan a name").max(40),
  price: z.string().trim().transform((v, ctx) => parseRupees(v) ?? (ctx.addIssue({ code: "custom", message: "Enter the price in rupees" }), z.NEVER)),
  maxStudents: limit,
  maxStaff: limit,
  billingInterval: z.enum(BILLING_INTERVALS),
  isOffered: z.boolean(),
  reason: optionalText(200),
});

const planAudit = (p: Pick<ActivityPlan, "name" | "pricePaise" | "billingInterval" | "maxStudents" | "maxStaff" | "isOffered">) => ({
  name: p.name,
  price: String(p.pricePaise),
  billingInterval: p.billingInterval,
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
  const values = { name: d.name, pricePaise: d.price, billingInterval: d.billingInterval, maxStudents: d.maxStudents, maxStaff: d.maxStaff, isOffered: d.isOffered };
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

// A new price or cycle is for activities started from now on (every price
// change is kept); new limits apply to everyone on the plan.
export async function editPlan(actor: Actor, planId: string, input: z.input<typeof planSchema>): Promise<void> {
  const d = planSchema.parse(input);
  const values = { name: d.name, pricePaise: d.price, billingInterval: d.billingInterval, maxStudents: d.maxStudents, maxStaff: d.maxStaff, isOffered: d.isOffered };
  await withPlatformAdmin({ ...actor, action: "activity_plan.edit", entityType: "activity_plan", entityId: planId, after: planAudit(values) }, async (tx, audit) => {
    const [before] = await tx.select().from(activityPlans).where(eq(activityPlans.id, planId)).for("update");
    if (!before) throw new NotFoundError("Plan");
    if (before.isDefault && !d.isOffered) throw new ConflictError(`${before.name} is the default plan: make another one the default first`);
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

// The plan a new start gets when none is picked: one per module, on offer.
export async function setDefaultPlan(actor: Actor, planId: string): Promise<void> {
  await withPlatformAdmin({ ...actor, action: "activity_plan.default", entityType: "activity_plan", entityId: planId }, async (tx, audit) => {
    const [plan] = await tx.select().from(activityPlans).where(eq(activityPlans.id, planId)).for("update");
    if (!plan) throw new NotFoundError("Plan");
    if (!plan.isOffered) throw new ConflictError(`Offer ${plan.name} before making it the default`);
    const was = await defaultPlan(tx, plan.activityKey);
    audit.before = { defaultPlanId: was?.id ?? null };
    const now = new Date();
    await tx.update(activityPlans).set({ isDefault: false, updatedAt: now }).where(and(eq(activityPlans.activityKey, plan.activityKey), eq(activityPlans.isDefault, true)));
    await tx.update(activityPlans).set({ isDefault: true, updatedAt: now }).where(eq(activityPlans.id, planId));
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

export type BillingOverview = {
  owed: (OwedBill & { overdue: boolean })[]; // oldest due first
  overduePaise: bigint;
  overdueCount: number;
  owedPaise: bigint;
  receivedPaise: bigint; // this month, on India time
  waiting: ListedSubscription[];
  endingTrials: ListedSubscription[]; // within 7 days
  specialPrices: ListedSubscription[];
  payments: ListedPayment[];
};

// /platform/billing (agreed 2026-10-01): what academies owe and what is
// overdue, who waits for a first payment, trials ending within a week, special
// prices still running, and the latest payments. Tests pass their academies.
export async function billingOverview(opts: { now?: Date; tenantIds?: string[] } = {}): Promise<BillingOverview> {
  const { now = new Date(), tenantIds } = opts;
  return platformRead(async (tx) => {
    const owed = (await owedBills(tx, tenantIds)).map((b) => ({ ...b, overdue: todayIn(b.timezone, now) > b.dueOn }));
    const overdue = owed.filter((b) => b.overdue);
    const live = await subscriptionList(tx, { tenantIds });
    const local = (s: ListedSubscription) => todayIn(s.timezone, now);
    return {
      owed,
      overduePaise: sum(overdue.map((b) => b.balance)),
      overdueCount: overdue.length,
      owedPaise: sum(owed.map((b) => b.balance)),
      receivedPaise: await receivedSince(tx, `${todayIn("Asia/Kolkata", now).slice(0, 7)}-01`, tenantIds),
      waiting: live.filter((s) => s.status === "pending"),
      endingTrials: live.filter((s) => s.status === "trial" && s.periodEnd <= addDays(local(s), 7)).sort((x, y) => x.periodEnd.localeCompare(y.periodEnd)),
      specialPrices: live.filter((s) => s.overridePaise !== null && (s.overrideUntil === null || s.overrideUntil >= local(s))),
      payments: await listPayments(tx, { limit: 20, ...(tenantIds ? { tenantIds } : {}) }),
    };
  });
}

export async function allSubscriptions(f: SubscriptionFilters): Promise<{ rows: ListedSubscription[]; modules: Activity[] }> {
  return platformRead(async (tx) => ({ rows: await subscriptionList(tx, f), modules: await listActivities(tx) }));
}

// For pickers: each module's default first, then the others on offer, then
// the hidden ones, each cheapest first.
export async function allPlans(): Promise<ActivityPlan[]> {
  const plans = await platformRead((tx) => listPlans(tx));
  return [...plans.filter((p) => p.isDefault), ...plans.filter((p) => p.isOffered && !p.isDefault), ...plans.filter((p) => !p.isOffered)];
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
