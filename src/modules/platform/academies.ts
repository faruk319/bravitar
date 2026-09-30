import { and, asc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { MODULES } from "@/lib/auth/permissions";
import { hashToken, newToken } from "@/lib/auth/token";
import type { AuditEntry } from "@/lib/db/audit";
import { type PlatformTx, platformRead, withPlatformAdmin } from "@/lib/db/platform";
import { todayIn } from "@/lib/dates";
import { ConflictError, isUniqueViolation, NotFoundError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import { tenantOrigin } from "@/lib/tenant/origin";
import { VERTICAL_PRESETS } from "@/lib/tenant/labels";
import { sessionsAuth } from "@/modules/auth/schema";
import { activityStudentCounts, liveSubscriptions, staffCounts, staffSeats, type SubscriptionRow, usageKey } from "@/modules/billing/repo";
import { effectivePrice } from "@/modules/billing/service";
import { INVITE_DAYS } from "@/modules/staff/service";
import { PASSWORD_UNSET, staffInvites, staffUsers } from "@/modules/staff/schema";
import { branches, type EnabledModules, tenants } from "@/modules/tenancy/schema";
import { createTenantWithDefaults, setTenantModules } from "@/modules/tenancy/service";
import { studentsByBranch } from "./usage";

// The /platform area's academies (Prompt 21). Every write goes through
// withPlatformAdmin, and the ones about an academy land in its audit log too.

type Actor = Pick<AuditEntry, "actorType" | "actorId">;

// Paused and cancelled activities pay nothing; a trial is priced as it will be.
const PAYING = new Set(["trial", "active"]);

// students: in this activity's batches at this branch, against the plan's limit.
export type BranchActivity = SubscriptionRow & { students: number };
export type AcademyBranch = { id: string; name: string; isDefault: boolean; students: number; activities: BranchActivity[] };
export type Academy = {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: "active" | "suspended" | "closed";
  timezone: string;
  createdAt: Date;
  branches: AcademyBranch[];
  staff: number;
  staffLimit: number | null; // its plans' seats plus one owner; null = no limit
  monthlyPaise: bigint;
};

async function academiesWhere(tx: PlatformTx, where: ReturnType<typeof and>): Promise<Academy[]> {
  const rows = await tx.select().from(tenants).where(and(isNull(tenants.deletedAt), where)).orderBy(asc(tenants.name));
  const ids = rows.map((t) => t.id);
  if (!ids.length) return [];
  const branchRows = await tx.select().from(branches).where(and(inArray(branches.tenantId, ids), isNull(branches.deletedAt))).orderBy(asc(branches.createdAt));
  const subs = await liveSubscriptions(tx, { tenantIds: ids });
  const [students, inActivity, staff, seats] = [await studentsByBranch(tx, ids), await activityStudentCounts(tx, { tenantIds: ids }), await staffCounts(tx, ids), await staffSeats(tx, { tenantIds: ids })];
  return rows.map((t) => {
    const today = todayIn(t.timezone);
    const own = branchRows
      .filter((b) => b.tenantId === t.id)
      .map((b) => ({
        id: b.id,
        name: b.name,
        isDefault: b.isDefault,
        students: students.get(b.id) ?? 0,
        activities: subs.filter((s) => s.branchId === b.id).map((s) => ({ ...s, students: inActivity.get(usageKey(b.id, s.activityKey)) ?? 0 })),
      }));
    const monthlyPaise = own.flatMap((b) => b.activities).reduce((sum, s) => (PAYING.has(s.status) ? sum + effectivePrice(s, today) : sum), 0n);
    const seat = seats.get(t.id);
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      type: t.verticalPreset,
      status: t.status,
      timezone: t.timezone,
      createdAt: t.createdAt,
      branches: own,
      staff: staff.get(t.id) ?? 0,
      staffLimit: seat === null ? null : (seat ?? 0) + 1,
      monthlyPaise,
    };
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
  planId: z.uuid().optional(),
  owner: z.object({ name: z.string().trim().min(1).max(120), email: z.email().trim().toLowerCase(), phone: z.string().trim().optional() }),
});

// The academy with its first branch (on trial, on the chosen plan), roles and
// owner, and the owner's link.
export async function createAcademy(actor: Actor, input: z.input<typeof newAcademySchema>): Promise<{ id: string; inviteUrl: string }> {
  const d = newAcademySchema.parse(input);
  const owner = { name: d.owner.name, email: d.owner.email, ...(d.owner.phone ? { phone: d.owner.phone } : {}) };
  const created = await createTenantWithDefaults(actor, { name: d.name, slug: d.slug, verticalPreset: d.verticalPreset, ...(d.planId ? { planId: d.planId } : {}), owner }).catch((e: unknown) => {
    if (isUniqueViolation(e)) throw new ConflictError("That address is taken");
    throw e;
  });
  return { id: created.tenant.id, inviteUrl: await ownerInvite(actor, created.tenant.id) };
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
