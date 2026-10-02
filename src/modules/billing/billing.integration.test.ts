import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { sql as runtimeSql } from "@/lib/db/client";
import { testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformDb, platformRead, platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { classRoster, saveAttendance } from "@/modules/attendance/service";
import { addProgram, batchDetail, changeSchedule, closeBatch, createBatch, editBatch, programList } from "@/modules/batches/service";
import { createEnquiry } from "@/modules/enquiries/service";
import { bookTrial } from "@/modules/enquiries/trials";
import { enroll, leaveEnrollment } from "@/modules/enrollments/service";
import { recordPayment } from "@/modules/payments/service";
import { localToUtc } from "@/modules/sessions/occurrences";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { sessions } from "@/modules/sessions/schema";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { createStudent } from "@/modules/students/service";
import { createBranch, tenantToday } from "@/modules/tenancy/repo";
import { lockedActivities } from "./access";
import { getActivity, getBillingSettings, liveSubscriptions } from "./repo";
import { activityPlans, activitySubscriptions } from "./schema";
import { editBillingSettings, startActivity } from "./service";

// Bravitar's own billing, step 1 (agreed 2026-09-30): each activity in each
// branch stands alone. A paused one is read-only there and nowhere else;
// reading, fees and winding down keep working.

const stamp = Math.random().toString(36).slice(2, 8);
const ME = { actorType: "platform" as const };
let A = "";
let B = "";
let main = "";
let kothrud = "";
let owner: ScopedCtx;
let teacher: ScopedCtx;
let today = "";
let danceName = "";
let danceProgram = "";
let danceEnrollment = "";
let householdId = "";
const batch = { mainKarate: "", karate: "", dance: "" };
const student = { karate: "", dance: "" };
const plans: string[] = [];

const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(A, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const everyDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "17:00", endTime: "18:00" }));
const classToday = async (batchId: string) => (await withTenant(A, (tx) => tx.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.batchId, batchId), eq(sessions.sessionDate, today)))))[0]?.id ?? "";
const setStatus = (branchId: string, activityKey: string, status: "active" | "paused") =>
  withPlatformAdmin({ action: "test.billing.status", actorType: "system" }, (tx) =>
    tx
      .update(activitySubscriptions)
      .set({ status })
      .where(and(eq(activitySubscriptions.branchId, branchId), eq(activitySubscriptions.activityKey, activityKey))),
  );
// Kothrud's activities on hidden plans with no limits: limits aren't tested here.
const startOpen = async (branchId: string, activityKey: string) => {
  const planId = uuidv7();
  await platformDb.insert(activityPlans).values({ id: planId, activityKey, name: `Test ${planId}`, pricePaise: 0n, isOffered: false });
  plans.push(planId);
  return withPlatformAdmin({ action: "test.billing.start", actorType: "system" }, (tx) => startActivity(tx, { tenantId: A, branchId, activityKey, planId, today, trial: false }));
};

beforeAll(async () => {
  const a = await testAcademy({ name: `Billing ${stamp}`, slug: `bill-a-${stamp}`, verticalPreset: "karate", branchName: "Main Dojo", owner: { name: "Owner", email: `bill-a-${stamp}@example.test` } });
  const b = await testAcademy({ name: `Billing B ${stamp}`, slug: `bill-b-${stamp}`, verticalPreset: "tuition", owner: { name: "Owner B", email: `bill-b-${stamp}@example.test` } });
  [A, B, main] = [a.tenant.id, b.tenant.id, a.branch.id];
  today = await withTenant(A, tenantToday);
  kothrud = (await withPlatformAdmin({ action: "test.billing.branch", actorType: "system" }, (tx) => createBranch(tx, { tenantId: A, name: "Kothrud Centre" }))).id;
  await startOpen(kothrud, "karate");
  await startOpen(kothrud, "dance");
  danceName = (await platformRead((tx) => getActivity(tx, "dance")))?.name ?? "";

  owner = await ctxFor(a.owner.id);
  const roles = Object.fromEntries((await withTenant(A, listRoles)).map((r) => [r.name, r.id]));
  teacher = await ctxFor((await withTenant(A, (tx) => createStaffMember(tx, owner, { email: `bill-t-${stamp}@example.test`, fullName: "Coach", roleId: roles.Teacher ?? "" }))).id);
  await withTenant(A, async (tx) => {
    const karate = await addProgram(tx, owner, { name: "Karate Kids", activityKey: "karate" });
    danceProgram = (await addProgram(tx, owner, { name: "Bollywood", activityKey: "dance" })).id;
    const make = async (name: string, programId: string, branchId: string) => (await createBatch(tx, owner, { name, programId, branchId, coachId: teacher.staffId, slots: everyDay, startDate: today })).id;
    batch.mainKarate = await make("Main Karate", karate.id, main);
    batch.karate = await make("Kothrud Karate", karate.id, kothrud);
    batch.dance = await make("Kothrud Dance", danceProgram, kothrud);
    await reconcileSessions(tx, { now: localToUtc(today, "00:00", "Asia/Kolkata"), batchIds: Object.values(batch) }); // today's classes too
    const add = (fullName: string, phone: string) => createStudent(tx, owner, { fullName, branchId: kothrud, guardian: { fullName: `Parent of ${fullName}`, phone, relation: "mother" }, consents: { dataProcessing: true } });
    const k = await add("Aarav", "98760 30001");
    const d = await add("Meher", "98760 30002");
    [student.karate, student.dance, householdId] = [k.student.id, d.student.id, d.household.id];
    await enroll(tx, owner, { studentId: k.student.id, batchId: batch.karate, startDate: today });
    danceEnrollment = (await enroll(tx, owner, { studentId: d.student.id, batchId: batch.dance, startDate: today })).id;
  });
});

afterAll(async () => {
  await deleteTenantsCompletely([A, B]);
  await platformDb.delete(activityPlans).where(inArray(activityPlans.id, plans));
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("an activity in a branch stands alone", () => {
  it("pausing Dance at Kothrud refuses using Dance there, and nothing else", async () => {
    await setStatus(kothrud, "dance", "paused");
    const danceClass = await classToday(batch.dance);
    const paused = `${danceName} at Kothrud Centre is paused: a Bravitar bill is overdue.`;
    const mark = (as: ScopedCtx, sessionId: string, studentId: string) => withTenant(A, (tx) => saveAttendance(tx, as, sessionId, { marks: [{ studentId, status: "present" }] }));

    await expect(mark(teacher, danceClass, student.dance)).rejects.toThrow(`${danceName} at Kothrud Centre is unavailable. Please contact your academy administrator.`);
    await expect(mark(owner, danceClass, student.dance)).rejects.toThrow(paused);
    await expect(withTenant(A, (tx) => createBatch(tx, owner, { name: "Dance 2", programId: danceProgram, branchId: kothrud, slots: everyDay }))).rejects.toThrow(paused);
    await expect(withTenant(A, (tx) => editBatch(tx, owner, batch.dance, { name: "Renamed" }))).rejects.toThrow(paused);
    await expect(withTenant(A, (tx) => changeSchedule(tx, owner, batch.dance, { slots: everyDay }))).rejects.toThrow(paused);
    await expect(withTenant(A, (tx) => enroll(tx, owner, { studentId: student.karate, batchId: batch.dance }))).rejects.toThrow(paused);
    const e = await withTenant(A, (tx) => createEnquiry(tx, owner, { name: "Trial kid", phone: "98760 30009", programId: danceProgram }));
    await expect(withTenant(A, (tx) => bookTrial(tx, owner, e.id, { sessionId: danceClass }))).rejects.toThrow(paused);

    // Karate in the same branch and in the other branch carries on.
    expect((await mark(teacher, await classToday(batch.karate), student.karate)).changed).toBe(1);
    await withTenant(A, (tx) => editBatch(tx, owner, batch.mainKarate, { name: "Main Karate A" }));

    // Reading, fees and winding down still work.
    expect((await withTenant(A, (tx) => batchDetail(tx, owner, batch.dance))).name).toBe("Kothrud Dance");
    expect((await withTenant(A, (tx) => classRoster(tx, teacher, danceClass))).entries.map((x) => x.name)).toEqual(["Meher"]);
    await withTenant(A, (tx) => recordPayment(tx, owner, { requestId: uuidv7(), householdId, branchId: kothrud, amountPaise: "50000" }));
    await withTenant(A, (tx) => leaveEnrollment(tx, owner, danceEnrollment));

    expect(await withTenant(A, (tx) => lockedActivities(tx, []))).toEqual([{ activity: danceName, branch: "Kothrud Centre", status: "paused" }]);
    expect(await withTenant(A, (tx) => lockedActivities(tx, [main]))).toEqual([]);
  });

  it("works again once active; closing a batch works even while paused", async () => {
    await setStatus(kothrud, "dance", "active");
    await withTenant(A, (tx) => editBatch(tx, owner, batch.dance, { name: "Kothrud Dance B" }));
    await setStatus(kothrud, "dance", "paused");
    await withTenant(A, (tx) => closeBatch(tx, owner, batch.dance));
  });

  it("can't be used in a branch where it isn't on", async () => {
    await expect(withTenant(A, (tx) => createBatch(tx, owner, { name: "Dance at Main", programId: danceProgram, branchId: main, slots: everyDay }))).rejects.toThrow(
      `${danceName} at Main Dojo isn't on. Turn it on in Billing.`,
    );
  });
});

describe("a program is one activity", () => {
  it("takes the one asked for, or the only one on; with two on, one must be picked", async () => {
    await expect(withTenant(A, (tx) => addProgram(tx, owner, { name: "Kata" }))).rejects.toThrow("Pick the module for this program");
    await expect(withTenant(A, (tx) => addProgram(tx, owner, { name: "Algebra", activityKey: "tuition" }))).rejects.toThrow("That module isn't on");
    const made = await withTenant(A, (tx) => createBatch(tx, owner, { name: "Kumite", newProgramName: "Kumite", branchId: main, slots: everyDay }));
    const program = (await withTenant(A, (tx) => programList(tx, owner))).find((p) => p.id === made.programId);
    expect(program?.activityKey).toBe("karate"); // the only one on at Main Dojo
  });

  it("a new program on the batch form takes the module picked there", async () => {
    const salsa = { name: "Salsa", newProgramName: "Salsa", newProgramActivityKey: "dance", branchId: main, slots: everyDay };
    await expect(withTenant(A, (tx) => createBatch(tx, owner, salsa))).rejects.toThrow(`${danceName} at Main Dojo isn't on`);
  });
});

describe("billing settings", () => {
  it("tax needs a GSTIN, and a GSTIN must look like one", async () => {
    const s = await platformRead(getBillingSettings);
    const same = { graceDays: String(s.graceDays), trialDays: String(s.trialDays), taxPercent: String(s.taxRateBp / 100), gstin: s.gstin ?? "", howToPay: s.howToPay ?? "" };
    await expect(editBillingSettings(ME, { ...same, taxPercent: "18", gstin: "" })).rejects.toThrow("Add the GSTIN before charging tax");
    await expect(editBillingSettings(ME, { ...same, gstin: "27ABCDE1234F1Z" })).rejects.toThrow("That isn't a GSTIN");
    await editBillingSettings(ME, same); // saving what is there changes nothing
    expect(await platformRead(getBillingSettings)).toMatchObject({ graceDays: s.graceDays, trialDays: s.trialDays, taxRateBp: s.taxRateBp, gstin: s.gstin });
  });
});

describe("each academy sees only its own", () => {
  it("B sees B's activities and none of A's", async () => {
    expect((await withTenant(B, (tx) => liveSubscriptions(tx))).map((s) => [s.tenantId, s.activityKey])).toEqual([[B, "tuition"]]);
    expect(await withTenant(B, (tx) => lockedActivities(tx, []))).toEqual([]);
  });
});
