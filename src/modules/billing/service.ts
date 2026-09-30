import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AuditEntry } from "@/lib/db/audit";
import { type PlatformTx, platformRead, withPlatformAdmin } from "@/lib/db/platform";
import { addDays } from "@/lib/dates";
import { ConflictError, isUniqueViolation, NotFoundError } from "@/lib/errors";
import { parseRupees } from "@/lib/money/paise";
import { branchesPerActivity, getActivity, getBillingSettings, insertSubscription, listActivities, type PriceChange, recentPriceChanges } from "./repo";
import { ACTIVITY_STATUSES, type Activity, activities, activityPriceHistory, type ActivitySubscription, billingSettings, type BillingSettings } from "./schema";

// Bravitar's own billing (agreed 2026-09-30). Every write goes through the
// platform role; academies only read their rows.

type Actor = Pick<AuditEntry, "actorType" | "actorId">;

// What the next bill charges: the override while it lasts, else the price
// agreed when the activity started.
export function effectivePrice(s: Pick<ActivitySubscription, "pricePaise" | "overridePaise" | "overrideUntil">, on: string): bigint {
  return s.overridePaise !== null && (s.overrideUntil === null || on <= s.overrideUntil) ? s.overridePaise : s.pricePaise;
}

export type StartInput = { tenantId: string; branchId: string; activityKey: string; today: string; trial: boolean };

// At today's catalog price. Only an academy's first activity in its first
// branch gets the trial; the rest are billed from the day they start.
export async function startActivity(tx: PlatformTx, input: StartInput): Promise<ActivitySubscription> {
  const activity = await getActivity(tx, input.activityKey);
  if (!activity) throw new NotFoundError("Activity");
  if (activity.status !== "active") throw new ConflictError(`${activity.name} isn't available yet`);
  const periodEnd = input.trial ? addDays(input.today, (await getBillingSettings(tx)).trialDays) : input.today;
  return insertSubscription(tx, {
    tenantId: input.tenantId,
    branchId: input.branchId,
    activityKey: activity.key,
    status: input.trial ? "trial" : "active",
    pricePaise: activity.pricePaise,
    anchorDay: Number(periodEnd.slice(8)),
    periodStart: input.today,
    periodEnd,
  }).catch((e: unknown) => {
    if (isUniqueViolation(e)) throw new ConflictError(`${activity.name} is already on in this branch`);
    throw e;
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
  price: z.string().trim().transform((v, ctx) => parseRupees(v) ?? (ctx.addIssue({ code: "custom", message: "Enter the price in rupees" }), z.NEVER)),
  status: z.enum(ACTIVITY_STATUSES),
  reason: optionalText(200),
});

// A new price is for activities started from now on; running ones keep the
// price they started at. Every change is kept.
export async function editActivity(actor: Actor, key: string, input: z.input<typeof activityEditSchema>): Promise<void> {
  const d = activityEditSchema.parse(input);
  await withPlatformAdmin({ ...actor, action: "activity.edit", entityType: "activity", after: { key, name: d.name, price: String(d.price), status: d.status } }, async (tx, audit) => {
    const [before] = await tx.select().from(activities).where(eq(activities.key, key)).for("update");
    if (!before) throw new NotFoundError("Activity");
    audit.before = { key, name: before.name, price: String(before.pricePaise), status: before.status };
    if (before.pricePaise !== d.price) {
      await tx.insert(activityPriceHistory).values({ activityKey: key, oldPaise: before.pricePaise, newPaise: d.price, reason: d.reason, changedBy: actor.actorType === "platform" ? (actor.actorId ?? null) : null });
    }
    await tx.update(activities).set({ name: d.name, description: d.description, pricePaise: d.price, status: d.status, updatedAt: new Date() }).where(eq(activities.key, key));
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

export type CatalogActivity = Activity & { branches: number; changes: PriceChange[] };

export async function activityCatalog(): Promise<{ activities: CatalogActivity[]; settings: BillingSettings }> {
  return platformRead(async (tx) => {
    const [list, used, changes] = [await listActivities(tx), await branchesPerActivity(tx), await recentPriceChanges(tx)];
    return { activities: list.map((a) => ({ ...a, branches: used.get(a.key) ?? 0, changes: changes.filter((c) => c.activityKey === a.key) })), settings: await getBillingSettings(tx) };
  });
}
