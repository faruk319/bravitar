import { and, asc, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { MODULES } from "@/lib/auth/permissions";
import { hashToken, newToken } from "@/lib/auth/token";
import type { AuditEntry } from "@/lib/db/audit";
import { type PlatformTx, platformRead, withPlatformAdmin } from "@/lib/db/platform";
import { ConflictError, isUniqueViolation, NotFoundError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import { parseRupees } from "@/lib/money/paise";
import { tenantOrigin } from "@/lib/tenant/origin";
import { VERTICAL_PRESETS } from "@/lib/tenant/labels";
import { sessionsAuth } from "@/modules/auth/schema";
import { INVITE_DAYS } from "@/modules/staff/service";
import { PASSWORD_UNSET, staffInvites, staffUsers } from "@/modules/staff/schema";
import { type EnabledModules, tenants } from "@/modules/tenancy/schema";
import { createTenantWithDefaults, setTenantModules } from "@/modules/tenancy/service";
import { type PlatformPlan, platformPlans, SUBSCRIPTION_STATUSES, type TenantSubscription, tenantSubscriptions } from "./schema";
import { NO_USAGE, type Usage, usageByTenant } from "./usage";

// The /platform area's academies (Prompt 21). Every write goes through
// withPlatformAdmin, and the ones about an academy land in its audit log too.

type Actor = Pick<AuditEntry, "actorType" | "actorId">;
export type Academy = {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: "active" | "suspended" | "closed";
  createdAt: Date;
  plan: PlatformPlan | undefined;
  subscription: Pick<TenantSubscription, "planCode" | "status" | "trialEndsAt"> | undefined;
  usage: Usage;
};

async function currentSubscriptions(tx: PlatformTx, tenantIds: string[]): Promise<Map<string, TenantSubscription>> {
  if (!tenantIds.length) return new Map();
  const rows = await tx
    .selectDistinctOn([tenantSubscriptions.tenantId])
    .from(tenantSubscriptions)
    .where(inArray(tenantSubscriptions.tenantId, tenantIds))
    .orderBy(tenantSubscriptions.tenantId, desc(tenantSubscriptions.createdAt));
  return new Map(rows.map((r) => [r.tenantId, r]));
}

async function academiesWhere(tx: PlatformTx, where: ReturnType<typeof and>): Promise<Academy[]> {
  const rows = await tx.select().from(tenants).where(and(isNull(tenants.deletedAt), where)).orderBy(asc(tenants.name));
  const ids = rows.map((t) => t.id);
  const [usage, subs, plans] = [await usageByTenant(tx, ids), await currentSubscriptions(tx, ids), new Map((await tx.select().from(platformPlans)).map((p) => [p.code, p]))];
  return rows.map((t) => {
    const sub = subs.get(t.id);
    return { id: t.id, name: t.name, slug: t.slug, type: t.verticalPreset, status: t.status, createdAt: t.createdAt, plan: sub ? plans.get(sub.planCode) : undefined, subscription: sub, usage: usage.get(t.id) ?? NO_USAGE };
  });
}

export async function listAcademies(q?: string): Promise<Academy[]> {
  const term = q?.trim();
  return platformRead((tx) => academiesWhere(tx, term ? or(ilike(tenants.name, `%${term}%`), ilike(tenants.slug, `%${term}%`)) : undefined));
}

export type AcademyDetail = Academy & { modules: EnabledModules; owner: { id: string; name: string; email: string; signedUp: boolean } | undefined };

export async function academyDetail(id: string): Promise<AcademyDetail> {
  return platformRead(async (tx) => {
    const [academy] = await academiesWhere(tx, eq(tenants.id, id));
    const [t] = await tx.select({ modules: tenants.enabledModules }).from(tenants).where(eq(tenants.id, id));
    if (!academy || !t) throw new NotFoundError("Academy");
    const [owner] = await tx
      .select({ id: staffUsers.id, name: staffUsers.fullName, email: staffUsers.email, hash: staffUsers.passwordHash })
      .from(staffUsers)
      .where(and(eq(staffUsers.tenantId, id), eq(staffUsers.isOwner, true), isNull(staffUsers.deletedAt)));
    return { ...academy, modules: t.modules, owner: owner ? { id: owner.id, name: owner.name, email: owner.email, signedUp: owner.hash !== PASSWORD_UNSET } : undefined };
  });
}

// A link for the owner to set their password; older links stop working.
export async function ownerInvite(actor: Actor, tenantId: string, now = new Date()): Promise<string> {
  const token = newToken();
  const slug = await withPlatformAdmin({ ...actor, action: "staff.invite", tenantId, entityType: "staff_user" }, async (tx, audit) => {
    const [t] = await tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
    const [owner] = await tx.select({ id: staffUsers.id }).from(staffUsers).where(and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.isOwner, true), isNull(staffUsers.deletedAt)));
    if (!t || !owner) throw new NotFoundError("Owner");
    audit.entityId = owner.id;
    await tx.update(staffInvites).set({ expiresAt: now }).where(and(eq(staffInvites.staffId, owner.id), isNull(staffInvites.usedAt)));
    await tx.insert(staffInvites).values({ id: uuidv7(), tenantId, staffId: owner.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000), createdBy: null });
    return t.slug;
  });
  return `${tenantOrigin(slug)}/invite/${token}`;
}

export const newAcademySchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase(),
  verticalPreset: z.enum(VERTICAL_PRESETS),
  planCode: z.string().min(1),
  owner: z.object({ name: z.string().trim().min(1).max(120), email: z.email().trim().toLowerCase(), phone: z.string().trim().optional() }),
});

// The academy with its first branch, roles and owner, and the owner's link.
export async function createAcademy(actor: Actor, input: z.input<typeof newAcademySchema>): Promise<{ id: string; inviteUrl: string }> {
  const d = newAcademySchema.parse(input);
  const created = await createTenantWithDefaults(actor, { name: d.name, slug: d.slug, verticalPreset: d.verticalPreset, planCode: d.planCode, owner: { name: d.owner.name, email: d.owner.email, ...(d.owner.phone ? { phone: d.owner.phone } : {}) } }).catch((e: unknown) => {
    if (isUniqueViolation(e)) throw new ConflictError("That address is taken");
    throw e;
  });
  return { id: created.tenant.id, inviteUrl: await ownerInvite(actor, created.tenant.id) };
}

export const planChangeSchema = z.object({ planCode: z.string().min(1), status: z.enum(SUBSCRIPTION_STATUSES) });

export async function setPlan(actor: Actor, tenantId: string, input: z.input<typeof planChangeSchema>): Promise<void> {
  const d = planChangeSchema.parse(input);
  await withPlatformAdmin({ ...actor, action: "tenant.plan.set", tenantId, entityType: "tenant", entityId: tenantId, after: d }, async (tx, audit) => {
    const current = (await currentSubscriptions(tx, [tenantId])).get(tenantId);
    if (!current) throw new NotFoundError("Subscription");
    if (!(await tx.select({ code: platformPlans.code }).from(platformPlans).where(eq(platformPlans.code, d.planCode))).length) throw new NotFoundError("Plan");
    audit.before = { planCode: current.planCode, status: current.status };
    await tx.update(tenantSubscriptions).set({ planCode: d.planCode, status: d.status }).where(eq(tenantSubscriptions.id, current.id));
  });
}

export const statusChangeSchema = z.object({ status: z.enum(["active", "suspended"]), reason: z.string().trim().min(3, "Add a reason").max(300) });

// Suspending blocks sign-in with a clear message and ends every session; it
// never deletes anything. Restoring lets everyone sign in again.
export async function setAcademyStatus(actor: Actor, tenantId: string, input: z.input<typeof statusChangeSchema>): Promise<void> {
  const d = statusChangeSchema.parse(input);
  await withPlatformAdmin({ ...actor, action: d.status === "suspended" ? "tenant.suspend" : "tenant.restore", tenantId, entityType: "tenant", entityId: tenantId, after: { reason: d.reason } }, async (tx) => {
    const [t] = await tx.update(tenants).set({ status: d.status }).where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt))).returning({ id: tenants.id });
    if (!t) throw new NotFoundError("Academy");
    if (d.status === "suspended") await tx.update(sessionsAuth).set({ revokedAt: new Date() }).where(and(eq(sessionsAuth.tenantId, tenantId), isNull(sessionsAuth.revokedAt)));
  });
}

const OPTIONAL = MODULES.filter((m) => m !== "core");
export const modulesSchema = z.object(Object.fromEntries(OPTIONAL.map((m) => [m, z.boolean()])));

export async function setModules(actor: Actor, tenantId: string, input: Record<string, boolean>): Promise<void> {
  const d = modulesSchema.parse(input);
  const current = (await academyDetail(tenantId)).modules;
  await setTenantModules(actor, tenantId, { ...current, ...d });
}

// ---- plans (placeholder prices and limits, editable here)

const limit = z.union([z.literal(""), z.coerce.number().int().min(0).max(1_000_000)]).transform((v) => (v === "" ? null : v));
export const planEditSchema = z.object({
  name: z.string().trim().min(2).max(60),
  price: z.string().trim().transform((v, ctx) => parseRupees(v) ?? (ctx.addIssue({ code: "custom", message: "Enter the price in rupees" }), z.NEVER)),
  maxStudents: limit,
  maxStaff: limit,
  maxBranches: limit,
  isActive: z.boolean(),
});

export const allPlans = (): Promise<PlatformPlan[]> => platformRead((tx) => tx.select().from(platformPlans).orderBy(asc(platformPlans.pricePaise)));

export async function editPlan(actor: Actor, code: string, input: z.input<typeof planEditSchema>): Promise<void> {
  const d = planEditSchema.parse(input);
  await withPlatformAdmin({ ...actor, action: "platform_plan.edit", entityType: "platform_plan", after: { code, ...d, price: String(d.price) } }, async (tx) => {
    const [row] = await tx
      .update(platformPlans)
      .set({ name: d.name, pricePaise: d.price, maxStudents: d.maxStudents, maxStaff: d.maxStaff, maxBranches: d.maxBranches, isActive: d.isActive })
      .where(eq(platformPlans.code, code))
      .returning({ code: platformPlans.code });
    if (!row) throw new NotFoundError("Plan");
  });
}
