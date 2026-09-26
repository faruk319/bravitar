import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getStaffSessionFromToken } from "@/lib/auth/session";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformRead, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { login } from "@/modules/auth/service";
import { ensurePlatformPlans } from "@/modules/platform/repo";
import { acceptInvite, inviteInfo, loadAccessContext } from "@/modules/staff/service";
import { createStudent, setStudentStatus } from "@/modules/students/service";
import { findTenantBySlug } from "@/modules/tenancy/repo";
import { academyDetail, createAcademy, editPlan, listAcademies, setAcademyStatus, setModules, setPlan } from "./academies";
import { platformPlans } from "./schema";

// Prompt 21: academies from /platform. A new one is usable with zero manual
// SQL; suspending stops sign-in and ends sessions without deleting anything.

const stamp = Math.random().toString(36).slice(2, 8);
const ME = { actorType: "platform" as const };
const SLUG = `made-${stamp}`;
const OWNER = `owner-${stamp}@example.test`;
const PASSWORD = "Owner-Horse-42";
const PLAN = `test-${stamp}`;
let tenantId = "";

beforeAll(async () => {
  await withPlatformAdmin({ action: "test.setup", actorType: "system" }, async (tx) => {
    await ensurePlatformPlans(tx);
    await tx.insert(platformPlans).values({ code: PLAN, name: "Test plan", pricePaise: 50_000n, billingCycle: "monthly", maxStudents: 1, maxStaff: 2, maxBranches: 1 });
  });
});

afterAll(async () => {
  if (tenantId) await deleteTenantsCompletely([tenantId]);
  await platformDb.delete(platformPlans).where(eq(platformPlans.code, PLAN));
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("a new academy", () => {
  it("comes with its owner's link to set a password, and the owner signs in", async () => {
    const made = await createAcademy(ME, { name: `Made ${stamp}`, slug: SLUG, verticalPreset: "deeniyat", planCode: "starter", owner: { name: "Maulana Owner", email: OWNER } });
    tenantId = made.id;
    const token = made.inviteUrl.split("/invite/")[1] ?? "";
    expect(made.inviteUrl).toMatch(new RegExp(`^http://${SLUG}\\.`));
    expect(await inviteInfo(token)).toMatchObject({ ok: true });
    await acceptInvite(token, PASSWORD);
    expect((await login({ slug: SLUG, email: OWNER, password: PASSWORD })).context.isOwner).toBe(true);
    await expect(createAcademy(ME, { name: "Again", slug: SLUG, verticalPreset: "general", planCode: "starter", owner: { name: "X", email: `x-${stamp}@example.test` } })).rejects.toThrow("That address is taken");
  });

  it("is listed with what it uses against its plan: left students don't count", async () => {
    const owner = (await academyDetail(tenantId)).owner?.id ?? "";
    await withTenant(tenantId, async (tx) => {
      const ctx = { ...(await loadAccessContext(tx, owner)), branchIds: [] };
      const add = (fullName: string, phone: string) => createStudent(tx, ctx, { fullName, guardian: { fullName: `Parent of ${fullName}`, phone, relation: "mother" }, consents: { dataProcessing: true } });
      await add("Ayaan", "98744 20001");
      const paused = await add("Maryam", "98744 20002");
      const left = await add("Umar", "98744 20003");
      await setStudentStatus(tx, ctx, paused.student.id, { status: "paused" });
      await setStudentStatus(tx, ctx, left.student.id, { status: "left", reason: "moved_away" });
    });
    const [row] = await listAcademies(SLUG);
    expect(row).toMatchObject({ slug: SLUG, type: "deeniyat", status: "active", plan: { code: "starter" }, usage: { students: 2, staff: 1, branches: 1 } });
  });
});

describe("changing an academy", () => {
  it("plan and modules follow; a plan's limits and price can be edited", async () => {
    await setPlan(ME, tenantId, { planCode: PLAN, status: "active" });
    await setModules(ME, tenantId, { students: true, enquiries: false, batches: true, attendance: true, fees: true, messaging: true, reports: true });
    const a = await academyDetail(tenantId);
    expect([a.plan?.code, a.subscription?.status, a.modules.enquiries]).toEqual([PLAN, "active", false]);
    await editPlan(ME, PLAN, { name: "Test plan", price: "750", maxStudents: "", maxStaff: "3", maxBranches: "2", isActive: false });
    expect((await academyDetail(tenantId)).plan).toMatchObject({ pricePaise: 75_000n, maxStudents: null, maxStaff: 3, maxBranches: 2, isActive: false });
  });

  it("suspending ends sessions and refuses sign-in with the paused message; restoring lets them back", async () => {
    const { token } = await login({ slug: SLUG, email: OWNER, password: PASSWORD });
    await expect(setAcademyStatus(ME, tenantId, { status: "suspended", reason: "no" })).rejects.toThrow("Add a reason");
    await setAcademyStatus(ME, tenantId, { status: "suspended", reason: "Unpaid for two months" });
    expect(await getStaffSessionFromToken(token)).toBeUndefined();
    await expect(login({ slug: SLUG, email: OWNER, password: PASSWORD })).rejects.toMatchObject({ status: 403, message: "This academy's account is paused. Contact Bravitar support." });
    expect((await platformRead((tx) => findTenantBySlug(tx, SLUG)))?.status).toBe("suspended");
    await setAcademyStatus(ME, tenantId, { status: "active", reason: "Paid up" });
    expect((await login({ slug: SLUG, email: OWNER, password: PASSWORD })).token).toBeTruthy();
    expect((await listAcademies(SLUG))[0]?.usage.students).toBe(2); // nothing deleted
  });
});
