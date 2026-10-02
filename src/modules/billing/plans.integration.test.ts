import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { addTestActivities, removeTestActivities, testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformRead, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { addProgram, createBatch } from "@/modules/batches/service";
import { enroll, leaveEnrollment } from "@/modules/enrollments/service";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { addStaff, deactivateStaff, loadAccessContext, reactivateStaff } from "@/modules/staff/service";
import { createStudent } from "@/modules/students/service";
import { createBranch, tenantToday } from "@/modules/tenancy/repo";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { listPlans, liveSubscriptions } from "./repo";
import { activityPlans, planPriceHistory } from "./schema";
import { payToStart } from "./payments";
import { changePlan, editPlan, startActivity } from "./service";

// Plans inside an activity (agreed 2026-09-30): a new price is for new
// subscriptions only and limits apply to everyone on the plan; students count
// per branch and activity, staff seats add up across an academy's plans.

const stamp = Math.random().toString(36).slice(2, 8);
const ME = { actorType: "platform" as const };
const KEY = `test-plans-${stamp}` as const;
const BARE = `test-bare-${stamp}` as const;
const plan = { small: "", big: "", hidden: "", bare: "", seats: "" };
let A = "";
let C = "";
let main = "";
let second = "";
let owner: ScopedCtx;
let desk: ScopedCtx;
let cOwner: ScopedCtx;
let today = "";
let kabirInOne = "";
let vivaanInOne = "";
let yStaff = "";
const batch = { one: "", two: "", other: "" };
const student: string[] = [];

const makePlan = async (activityKey: string, name: string, v: { price: bigint; students?: number; staff?: number; offered?: boolean; isDefault?: boolean }) => {
  const id = uuidv7();
  await platformDb
    .insert(activityPlans)
    .values({ id, activityKey, name, pricePaise: v.price, maxStudents: v.students ?? null, maxStaff: v.staff ?? null, isOffered: v.offered ?? true, isDefault: v.isDefault ?? false });
  return id;
};
// Paid first when it costs something (pay first, agreed 2026-09-30).
const start = async (tenantId: string, branchId: string, activityKey: string, planId?: string) => {
  const s = await withPlatformAdmin({ action: "test.plans.start", actorType: "system" }, (tx) => startActivity(tx, { tenantId, branchId, activityKey, planId, today, trial: false }));
  if (s.status === "pending") await payToStart(ME, s.id);
  return s;
};
const branch = async (tenantId: string, name: string) => (await withPlatformAdmin({ action: "test.plans.branch", actorType: "system" }, (tx) => createBranch(tx, { tenantId, name }))).id;
const subOf = async (tenantId: string, branchId?: string) =>
  (await platformRead((tx) => liveSubscriptions(tx, { tenantIds: [tenantId] }))).find((s) => s.activityKey === KEY && (branchId === undefined || s.branchId === branchId));
const ctxFor = async (tenantId: string, staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(tenantId, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const join = async (as: ScopedCtx, i: number, batchId: string) => (await withTenant(A, (tx) => enroll(tx, as, { studentId: student[i] ?? "", batchId }))).id;
const leave = (enrollmentId: string) => withTenant(A, (tx) => leaveEnrollment(tx, owner, enrollmentId));

beforeAll(async () => {
  await addTestActivities([
    { key: KEY, name: "Test activity" },
    { key: BARE, name: "Test bare" },
  ]);
  plan.small = await makePlan(KEY, "Small", { price: 30_000n, students: 2, staff: 1, isDefault: true });
  plan.big = await makePlan(KEY, "Big", { price: 60_000n });
  plan.hidden = await makePlan(KEY, "Hidden", { price: 10_000n, offered: false });
  plan.bare = await makePlan(BARE, "Bare", { price: 0n, offered: false });

  const a = await testAcademy({ name: `Plans ${stamp}`, slug: `plans-${stamp}`, branchName: "Main", owner: { name: "Owner", email: `plans-${stamp}@example.test` } });
  [A, main] = [a.tenant.id, a.branch.id];
  today = await withTenant(A, tenantToday);
  second = await branch(A, "Second");
  await start(A, main, KEY, plan.small);
  await start(A, second, KEY, plan.small);
  owner = await ctxFor(A, a.owner.id);
  const roles = Object.fromEntries((await withTenant(A, listRoles)).map((r) => [r.name, r.id]));
  desk = await ctxFor(A, (await withTenant(A, (tx) => addStaff(tx, owner, { email: `plans-desk-${stamp}@example.test`, fullName: "Desk", roleId: roles["Front Desk"] ?? "" }))).staff.id);
  await withTenant(A, async (tx) => {
    const programId = (await addProgram(tx, owner, { name: "Test program", activityKey: KEY })).id;
    const slots = [{ weekday: 1, startTime: "17:00", endTime: "18:00" }];
    batch.one = (await createBatch(tx, owner, { name: "One", programId, branchId: main, slots, startDate: today })).id;
    batch.two = (await createBatch(tx, owner, { name: "Two", programId, branchId: main, slots, startDate: today })).id;
    batch.other = (await createBatch(tx, owner, { name: "Other", programId, branchId: second, slots, startDate: today })).id;
    for (const [i, name] of ["Sara", "Kabir", "Ira", "Vivaan"].entries()) {
      student.push((await createStudent(tx, owner, { fullName: name, branchId: main, guardian: { fullName: `Parent of ${name}`, phone: `98761 4000${i}`, relation: "mother" }, consents: { dataProcessing: true } })).student.id);
    }
  });
});

afterAll(async () => {
  await deleteTenantsCompletely([A, C].filter(Boolean));
  const ids = (await platformDb.select({ id: activityPlans.id }).from(activityPlans).where(inArray(activityPlans.activityKey, [KEY, BARE]))).map((p) => p.id);
  if (ids.length) await platformDb.delete(planPriceHistory).where(inArray(planPriceHistory.planId, ids));
  await platformDb.delete(activityPlans).where(inArray(activityPlans.id, [...ids, plan.seats].filter(Boolean)));
  await removeTestActivities([KEY, BARE]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("the student limit", () => {
  it("counts each student once per branch and activity; the next one is refused", async () => {
    await join(owner, 0, batch.one);
    kabirInOne = await join(owner, 1, batch.one);
    await expect(join(owner, 2, batch.one)).rejects.toThrow("Test activity Small at Main allows 2 students. Upgrade the plan in Billing.");
    await expect(join(desk, 3, batch.one)).rejects.toThrow("Test activity Small at Main allows 2 students. Please contact your academy administrator.");
    await join(owner, 0, batch.two); // Sara is already counted at Main
    await join(owner, 2, batch.other); // Second has its own count
  });

  it("frees a seat when a student leaves", async () => {
    await leave(kabirInOne);
    await join(owner, 2, batch.one);
  });
});

describe("changing plan", () => {
  it("up: now, the new price from the next bill; down: at the month's end, if the students fit", async () => {
    const sub = (await subOf(A, main))?.id ?? "";
    expect(await changePlan(ME, sub, plan.big)).toBe("now");
    expect(await subOf(A, main)).toMatchObject({ planId: plan.big, pricePaise: 60_000n, nextPlanId: null });
    vivaanInOne = await join(owner, 3, batch.one); // Big has no limit: 3 students at Main now
    await expect(changePlan(ME, sub, plan.small)).rejects.toThrow("3 students in it here; Small allows 2.");
    await leave(vivaanInOne);
    expect(await changePlan(ME, sub, plan.small)).toBe("at_period_end");
    expect(await subOf(A, main)).toMatchObject({ planId: plan.big, nextPlanId: plan.small, nextPlanName: "Small" });
    expect(await changePlan(ME, sub, plan.big)).toBe("unchanged"); // cancels the waiting downgrade
    expect((await subOf(A, main))?.nextPlanId).toBeNull();
  });

  it("lets owners pick only offered plans, and nobody another activity's plan", async () => {
    const sub = (await subOf(A, main))?.id ?? "";
    await expect(changePlan({ actorType: "staff", actorId: owner.staffId }, sub, plan.hidden)).rejects.toThrow("Hidden isn't on offer");
    const karate = (await platformRead((tx) => listPlans(tx, "karate")))[0]?.id ?? "";
    await expect(changePlan(ME, sub, karate)).rejects.toThrow("Plan not found");
    await expect(start(A, main, BARE, karate)).rejects.toThrow("Plan not found");
  });
});

describe("a plan's price and limits", () => {
  it("a new price is for new subscriptions only, and each change is kept", async () => {
    await editPlan(ME, plan.small, { name: "Small", price: "350", maxStudents: "2", maxStaff: "1", billingInterval: "month", isOffered: true, reason: "New year" });
    const third = await start(A, await branch(A, "Third"), KEY); // the default plan
    expect(third).toMatchObject({ planId: plan.small, pricePaise: 35_000n });
    expect((await subOf(A, second))?.pricePaise).toBe(30_000n);
    expect(await platformRead((tx) => tx.select().from(planPriceHistory).where(eq(planPriceHistory.planId, plan.small)))).toMatchObject([{ oldPaise: 30_000n, newPaise: 35_000n, reason: "New year" }]);
    const audit = await platformRead((tx) => tx.select({ before: auditLog.before, after: auditLog.after }).from(auditLog).where(and(eq(auditLog.action, "activity_plan.edit"), eq(auditLog.entityId, plan.small))));
    expect(audit).toMatchObject([{ before: { price: "30000" }, after: { price: "35000" } }]);
  });

  it("new limits apply to everyone on the plan", async () => {
    await editPlan(ME, plan.small, { name: "Small", price: "350", maxStudents: "1", maxStaff: "1", billingInterval: "month", isOffered: true });
    expect((await subOf(A, second))?.plan.maxStudents).toBe(1);
    await expect(join(owner, 0, batch.other)).rejects.toThrow("Test activity Small at Second allows 1 student. Upgrade the plan in Billing.");
  });

  it("with no plan on offer an activity can't start on its own, but the platform can use a hidden plan", async () => {
    await expect(start(A, main, BARE)).rejects.toThrow("Test bare has no plan on offer");
    expect((await start(A, main, BARE, plan.bare)).planId).toBe(plan.bare);
  });
});

describe("staff seats", () => {
  it("add up across the academy's plans, plus one owner; the next one is refused", async () => {
    plan.seats = await makePlan("general", `Seats ${stamp}`, { price: 0n, staff: 1, offered: false });
    const c = await createTenantWithDefaults({ actorType: "system" }, { name: `Seats ${stamp}`, slug: `seats-${stamp}`, planId: plan.seats, owner: { name: "Owner C", email: `seats-${stamp}@example.test` } });
    C = c.tenant.id;
    await start(C, await branch(C, "C Second"), KEY, plan.small); // 1 more seat
    cOwner = await ctxFor(C, c.owner.id);
    const roleId = await withTenant(C, async (tx) => (await listRoles(tx)).find((r) => r.name === "Teacher")?.id ?? "");
    const add = async (name: string) => (await withTenant(C, (tx) => addStaff(tx, cOwner, { email: `${name}-${stamp}@example.test`, fullName: name, roleId }))).staff.id;
    await add("x");
    yStaff = await add("y");
    await expect(add("z")).rejects.toThrow("Your plans allow 3 staff. Upgrade a plan in Billing.");
    await withTenant(C, (tx) => deactivateStaff(tx, cOwner, yStaff));
    await add("z");
    await expect(withTenant(C, (tx) => reactivateStaff(tx, cOwner, yStaff))).rejects.toThrow("Your plans allow 3 staff.");
  });

  it("a downgrade the staff don't fit is refused; a plan with no staff limit lifts the cap", async () => {
    const tiny = await makePlan(KEY, "Tiny", { price: 5_000n, staff: 0 });
    const sub = (await subOf(C))?.id ?? "";
    await expect(changePlan(ME, sub, tiny)).rejects.toThrow("The academy has 3 staff; with Tiny its plans allow 2.");
    expect(await changePlan(ME, sub, plan.big)).toBe("now");
    await withTenant(C, (tx) => reactivateStaff(tx, cOwner, yStaff));
  });
});
