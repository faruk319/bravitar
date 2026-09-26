import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { staffBranchIds } from "@/modules/staff/repo";
import { loadAccessContext } from "@/modules/staff/service";
import { createStudent, setStudentStatus } from "@/modules/students/service";
import { createBranch } from "@/modules/tenancy/repo";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { setBranchPlan } from "./academies";
import { createBranchSubscription, ensurePlatformPlans } from "./repo";
import { platformPlans } from "./schema";

// A plan per branch caps that branch's students (agreed 2026-09-26): active
// and paused ones by home branch; other branches are unaffected.

const stamp = Math.random().toString(36).slice(2, 8);
const PLAN = `two-${stamp}`;
let T = "";
let owner: ScopedCtx;
let main = "";
let second = "";
let n = 0;

const add = (branchId: string) =>
  withTenant(T, (tx) => createStudent(tx, owner, { fullName: `Kid ${++n}`, branchId, guardian: { fullName: `Parent ${n}`, phone: `98766${String(20_000 + n)}`, relation: "mother" }, consents: { dataProcessing: true } }));

beforeAll(async () => {
  await withPlatformAdmin({ action: "test.setup", actorType: "system" }, async (tx) => {
    await ensurePlatformPlans(tx);
    await tx.insert(platformPlans).values({ code: PLAN, name: "Two", pricePaise: 10_000n, billingCycle: "monthly", maxStudents: 2 });
  });
  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Limits ${stamp}`, slug: `limits-${stamp}`, owner: { name: "Owner", email: `limits-${stamp}@example.test` } });
  T = t.tenant.id;
  main = t.branch.id;
  await setBranchPlan({ actorType: "system" }, main, { planCode: PLAN, status: "active" });
  second = await withTenant(T, async (tx) => {
    const b = await createBranch(tx, { tenantId: T, name: "Second" });
    await createBranchSubscription(tx, { tenantId: T, branchId: b.id, planCode: "pro", status: "active" });
    return b.id;
  });
  owner = await withTenant(T, async (tx) => ({ ...(await loadAccessContext(tx, t.owner.id)), branchIds: await staffBranchIds(tx, t.owner.id) }));
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await platformDb.delete(platformPlans).where(eq(platformPlans.code, PLAN));
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("a branch's student limit", () => {
  it("refuses one over, with the branch named; another branch's plan is its own", async () => {
    await add(main);
    const kept = await add(main);
    await expect(add(main)).rejects.toMatchObject({ status: 409, message: "Main branch's plan allows 2 students. Ask Bravitar to upgrade it." });
    await expect(add(second)).resolves.toBeTruthy(); // unlimited

    // Left students don't count; one coming back does.
    await withTenant(T, (tx) => setStudentStatus(tx, owner, kept.student.id, { status: "left", reason: "moved_away" }));
    await add(main);
    await expect(withTenant(T, (tx) => setStudentStatus(tx, owner, kept.student.id, { status: "active" }))).rejects.toMatchObject({ status: 409 });
    await setBranchPlan({ actorType: "system" }, main, { planCode: "pro", status: "active" });
    await expect(withTenant(T, (tx) => setStudentStatus(tx, owner, kept.student.id, { status: "active" }))).resolves.toBeTruthy();
  });
});
