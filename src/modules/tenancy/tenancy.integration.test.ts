import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog } from "@/lib/db/audit";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { sql as runtimeSql } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import { resolveLabels } from "@/lib/tenant/labels";
import { resolveTenantBySlug } from "@/lib/tenant/resolve";
import { ensurePlatformPlans, ownBranchPlans } from "@/modules/platform/repo";
import { getOwnTenant, listBranches } from "@/modules/tenancy/repo";
import { branches, tenants } from "@/modules/tenancy/schema";
import { createTenantWithDefaults } from "@/modules/tenancy/service";

const stamp = Math.random().toString(36).slice(2, 8);
const slug = `int-${stamp}`;
const created: string[] = [];

afterAll(async () => {
  await deleteTenantsCompletely(created);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("createTenantWithDefaults", () => {
  it("creates tenant, default branch, trial subscription and an audit row in one go", async () => {
    await withPlatformAdmin({ action: "test.setup", actorType: "system" }, ensurePlatformPlans);
    const before = Date.now();
    const { tenant, branch, subscription, owner } = await createTenantWithDefaults({ actorType: "system" }, { name: "Integration Karate", slug, verticalPreset: "karate", owner: { name: "Owner", email: `owner-${stamp}@example.test` } });
    created.push(tenant.id);
    expect(owner).toMatchObject({ tenantId: tenant.id, isOwner: true, isActive: true, passwordHash: "!" });

    expect(tenant.slug).toBe(slug);
    expect(branch).toMatchObject({ tenantId: tenant.id, isDefault: true, name: "Main branch" });
    expect(subscription).toMatchObject({ tenantId: tenant.id, planCode: "starter", status: "trial" });
    const trialMs = (subscription.trialEndsAt?.getTime() ?? 0) - before;
    expect(trialMs).toBeGreaterThan(29 * 86_400_000);
    expect(trialMs).toBeLessThan(31 * 86_400_000);

    // Visible from inside the tenant's own context, including its creation audit row.
    const seen = await withTenant(tenant.id, async (tx) => ({
      tenant: await getOwnTenant(tx),
      branches: await listBranches(tx),
      plans: await ownBranchPlans(tx),
      audit: await tx.select({ action: auditLog.action, actorType: auditLog.actorType, entityId: auditLog.entityId }).from(auditLog),
    }));
    expect(seen.tenant?.id).toBe(tenant.id);
    expect(seen.branches.map((b) => b.id)).toEqual([branch.id]);
    expect(seen.plans.map((p) => [p.branchId, p.subscription?.id, p.plan?.code])).toEqual([[branch.id, subscription.id, "starter"]]); // the first branch's trial
    expect(seen.audit).toEqual([{ action: "tenant.create", actorType: "system", entityId: tenant.id }]);
  });

  it("rejects a duplicate slug and leaves nothing behind", async () => {
    const countRows = async () => {
      const [t] = await platformDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
      const rows = await platformDb.select({ id: branches.id }).from(branches).where(eq(branches.tenantId, t?.id ?? ""));
      return { tenantId: t?.id, branchCount: rows.length };
    };
    const before = await countRows();
    await expect(createTenantWithDefaults({ actorType: "system" }, { name: "Dup", slug, owner: { name: "Dup", email: "dup@example.test" } })).rejects.toThrow();
    expect(await countRows()).toEqual(before);
  });

  it("validates its input before touching the database", async () => {
    const owner = { name: "O", email: "o@example.test" };
    await expect(createTenantWithDefaults({ actorType: "system" }, { name: "X", slug: "Bad Slug!", owner })).rejects.toThrow();
    await expect(createTenantWithDefaults({ actorType: "system" }, { name: "Okay", slug: `x-${stamp}`, verticalPreset: "swimming" as never, owner })).rejects.toThrow();
    await expect(createTenantWithDefaults({ actorType: "system" }, { name: "Okay", slug: `y-${stamp}`, owner: { name: "O", email: "not-an-email" } })).rejects.toThrow();
  });

  it("is resolvable by slug and carries the karate label pack", async () => {
    const found = await resolveTenantBySlug(slug);
    expect(found?.verticalPreset).toBe("karate");
    const tenant = await withTenant(found?.id ?? "", getOwnTenant);
    const labels = resolveLabels({ verticalPreset: tenant?.verticalPreset ?? "", labelOverrides: tenant?.labelOverrides });
    expect(labels.staff.one).toBe("Coach");
    expect(labels.session.many).toBe("Classes");
    console.log(`labels for ${slug}:`, Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, v.one])));
  });
});
