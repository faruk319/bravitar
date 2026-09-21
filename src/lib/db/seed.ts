import { pathToFileURL } from "node:url";
import { platformRead, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { sql as runtimeSql } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import { ensurePlatformPlans } from "@/modules/platform/repo";
import { createBranch, createResource, findTenantBySlug } from "@/modules/tenancy/repo";
import { setPassword } from "@/modules/auth/service";
import { listRoles } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { createTenantWithDefaults, type NewTenantInput } from "@/modules/tenancy/service";

// Dev-only login for the seeded owners. Never reuse in production.
const DEMO_PASSWORD = "Demo@1234";

// Demo data for local development. Idempotent by natural key (plan code,
// tenant slug): inserts what is missing, never updates what is there.
const DEMO_TENANTS: (NewTenantInput & { resource: string; coach: { name: string; email: string }; extraBranch?: string })[] = [
  { name: "Shivaji Karate Academy", slug: "shivaji-karate", verticalPreset: "karate", branchName: "Main Dojo", resource: "Main Hall", owner: { name: "Amit Shinde", email: "owner@shivaji-karate.demo" }, coach: { name: "Ravi Patil", email: "coach@shivaji-karate.demo" } },
  { name: "Bright Future Tuition", slug: "bright-future", verticalPreset: "tuition", branchName: "Main Centre", resource: "Room 1", owner: { name: "Farah Khan", email: "owner@bright-future.demo" }, coach: { name: "Sana Shaikh", email: "teacher@bright-future.demo" }, extraBranch: "Kothrud Centre" },
];

export type SeedResult = { plansCreated: string[]; tenantsCreated: string[]; tenantsPresent: string[] };

export async function seed(): Promise<SeedResult> {
  const plansCreated = await withPlatformAdmin({ action: "seed.plans", actorType: "system" }, ensurePlatformPlans);
  const result: SeedResult = { plansCreated, tenantsCreated: [], tenantsPresent: [] };

  for (const { resource, coach, extraBranch, ...input } of DEMO_TENANTS) {
    const existing = await platformRead((tx) => findTenantBySlug(tx, input.slug));
    if (existing) {
      result.tenantsPresent.push(input.slug);
      continue;
    }
    const { tenant, branch, owner } = await createTenantWithDefaults({ actorType: "system" }, input);
    // Through the tenant's own context, like the app would.
    await withTenant(tenant.id, async (tx) => {
      const ctx = await loadAccessContext(tx, owner.id);
      await setPassword(tx, ctx, owner.id, DEMO_PASSWORD);
      await createResource(tx, { tenantId: tenant.id, branchId: branch.id, name: resource });
      if (extraBranch) await createBranch(tx, { tenantId: tenant.id, name: extraBranch });
      const teacherRole = (await listRoles(tx)).find((r) => r.name === "Teacher");
      const staff = await createStaffMember(tx, ctx, { email: coach.email, fullName: coach.name, roleIds: teacherRole ? [teacherRole.id] : [] });
      await setPassword(tx, ctx, staff.id, DEMO_PASSWORD);
    });
    console.log(`seed: ${input.slug} owner ${owner.email} / coach ${coach.email}, password ${DEMO_PASSWORD} (dev only)`);
    result.tenantsCreated.push(input.slug);
  }
  return result;
}

async function main(): Promise<void> {
  try {
    const r = await seed();
    console.log(`seed: plans created [${r.plansCreated.join(", ")}]`);
    console.log(`seed: tenants created [${r.tenantsCreated.join(", ")}], already present [${r.tenantsPresent.join(", ")}]`);
  } finally {
    await runtimeSql.end({ timeout: 5 });
    await platformSql.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
