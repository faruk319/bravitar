import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AuditEntry } from "@/lib/db/audit";
import { withPlatformAdmin } from "@/lib/db/platform";
import { isTimeZone, todayIn } from "@/lib/dates";
import { financialYear } from "@/lib/money/fy";
import { ensureSeries } from "@/modules/numbering/repo";
import { VERTICAL_PRESETS } from "@/lib/tenant/labels";
import { createSubscription } from "@/modules/platform/repo";
import type { TenantSubscription } from "@/modules/platform/schema";
import { createStaff, replaceStaffRoles, syncPermissions } from "@/modules/staff/repo";
import { PASSWORD_UNSET, type StaffUser } from "@/modules/staff/schema";
import { createPresetRoles } from "@/modules/staff/service";
import { invalidateSessionsForTenant } from "@/modules/auth/repo";
import { createBranch, createTenant } from "./repo";
import { type Branch, type EnabledModules, type Tenant, tenants } from "./schema";

// docs/03 §1: creating a tenant creates everything it needs in one transaction:
// tenant, default branch, subscription, permission catalog, the four preset
// roles and the owner. Number series arrive with the money slice.
export const newTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/, "lowercase letters, digits and hyphens"),
  verticalPreset: z.enum(VERTICAL_PRESETS).default("general"),
  timezone: z.string().default("Asia/Kolkata").refine(isTimeZone, "Unknown timezone"),
  branchName: z.string().trim().min(1).max(120).default("Main branch"),
  planCode: z.string().default("starter"),
  trialDays: z.number().int().min(0).max(365).default(30),
  owner: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.email().trim().toLowerCase(),
    phone: z.string().trim().min(6).max(20).optional(),
  }),
});
export type NewTenantInput = z.input<typeof newTenantSchema>;

// "Shivaji Karate Academy" -> SKA; padded to two letters, capped at five.
export function codePrefixFor(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z ]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0] ?? "");
  const p = letters.join("").slice(0, 5);
  return p.length >= 2 ? p : (p + "ST").slice(0, 2);
}

export type CreatedTenant = { tenant: Tenant; branch: Branch; subscription: TenantSubscription; owner: StaffUser };

export async function createTenantWithDefaults(
  actor: Pick<AuditEntry, "actorType" | "actorId" | "impersonatedBy">,
  input: NewTenantInput,
): Promise<CreatedTenant> {
  const data = newTenantSchema.parse(input);
  const trialEndsAt = new Date(Date.now() + data.trialDays * 86_400_000);
  return withPlatformAdmin({ ...actor, action: "tenant.create", entityType: "tenant", after: { slug: data.slug, plan: data.planCode } }, async (tx, audit) => {
    const tenant = await createTenant(tx, { name: data.name, slug: data.slug, verticalPreset: data.verticalPreset, timezone: data.timezone, codePrefix: codePrefixFor(data.name) });
    audit.tenantId = tenant.id;
    audit.entityId = tenant.id;
    const branch = await createBranch(tx, { tenantId: tenant.id, name: data.branchName, isDefault: true });
    await ensureSeries(tx, tenant.id, financialYear(todayIn(tenant.timezone), tenant.fyStartMonth));
    const subscription = await createSubscription(tx, { tenantId: tenant.id, planCode: data.planCode, status: "trial", trialEndsAt });
    await syncPermissions(tx);
    const roles = await createPresetRoles(tx, tenant.id);
    // No password yet: the invite / set-password flow (auth slice) sets it.
    const owner = await createStaff(tx, {
      tenantId: tenant.id,
      email: data.owner.email,
      fullName: data.owner.name,
      passwordHash: PASSWORD_UNSET,
      isOwner: true,
      ...(data.owner.phone !== undefined ? { phone: data.owner.phone } : {}),
    });
    await replaceStaffRoles(tx, tenant.id, owner.id, [roles.Owner.id]);
    return { tenant, branch, subscription, owner };
  });
}

// Platform-admin action. Every live session of the tenant rebuilds its
// context on the next request, so nav and route gates follow immediately.
export async function setTenantModules(
  actor: Pick<AuditEntry, "actorType" | "actorId" | "impersonatedBy">,
  tenantId: string,
  modules: EnabledModules,
): Promise<Tenant> {
  return withPlatformAdmin({ ...actor, action: "tenant.modules.set", tenantId, entityType: "tenant", entityId: tenantId, after: modules }, async (tx) => {
    const [row] = await tx.update(tenants).set({ enabledModules: modules }).where(eq(tenants.id, tenantId)).returning();
    if (!row) throw new Error("tenant not found");
    await invalidateSessionsForTenant(tx, tenantId);
    return row;
  });
}
