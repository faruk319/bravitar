import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { addDays, todayIn } from "@/lib/dates";
import { addProgram, archiveBatch, closeBatch, createBatch } from "@/modules/batches/service";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext, setStaffBranches } from "@/modules/staff/service";
import { archiveStudent, createStudent, setStudentStatus } from "@/modules/students/service";
import { createBranch } from "@/modules/tenancy/repo";
import { testAcademy } from "@/lib/db/isolation/academy";
import { rosterOf } from "./repo";
import { enrollments } from "./schema";
import { batchChoices, batchRoster, enroll, leaveEnrollment, pauseEnrollment, resumeEnrollment, studentBatches, transferEnrollment } from "./service";

const stamp = Math.random().toString(36).slice(2, 8);
const today = todayIn("Asia/Kolkata");
const MWF = [1, 3, 5].map((weekday) => ({ weekday, startTime: "18:00", endTime: "19:00" }));
let T = "";
let owner: ScopedCtx;
let frontDesk: ScopedCtx;
let teacher: ScopedCtx;
let kothrudDesk: ScopedCtx;
let kothrud = "";
let karate = "";
let phone = 0;

const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const student = async (name: string, branchId?: string) =>
  (await withTenant(T, (tx) => createStudent(tx, owner, { fullName: name, guardian: { fullName: `Parent of ${name}`, phone: `+9198${String(10_000_000 + ++phone)}`, relation: "father" }, consents: { dataProcessing: true }, ...(branchId ? { branchId } : {}) }))).student.id;
const batch = async (name: string, extra: { branchId?: string; startDate?: string } = {}) =>
  (await withTenant(T, (tx) => createBatch(tx, owner, { name, programId: karate, slots: MWF, startDate: addDays(today, -30), ...extra }))).id;
const one = async (id: string) => (await withTenant(T, (tx) => tx.select().from(enrollments).where(eq(enrollments.id, id))))[0];
const actions = async (ids: string[]) => (await withTenant(T, (tx) => tx.select({ a: auditLog.action }).from(auditLog).where(inArray(auditLog.entityId, ids)))).map((r) => r.a).sort();

beforeAll(async () => {
  const t = await testAcademy({ name: `Enrol Test ${stamp}`, slug: `enr-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `enr-owner-${stamp}@example.test` } });
  T = t.tenant.id;
  owner = await ctxFor(t.owner.id);
  kothrud = (await withTenant(T, (tx) => createBranch(tx, { tenantId: T, name: "Kothrud" }))).id;
  karate = (await withTenant(T, (tx) => addProgram(tx, owner, { name: "Karate" }))).id;
  const roles = Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r.id]));
  const staff = async (name: string, role: string, branches: string[] = []) =>
    ctxFor(
      await withTenant(T, async (tx) => {
        const s = await createStaffMember(tx, owner, { email: `${name}-${stamp}@example.test`, fullName: name, roleIds: [roles[role] ?? ""] });
        if (branches.length) await setStaffBranches(tx, owner, s.id, branches);
        return s.id;
      }),
    );
  frontDesk = await staff("desk", "Front Desk");
  teacher = await staff("teacher", "Teacher");
  kothrudDesk = await staff("kdesk", "Front Desk", [kothrud]);
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("joining a batch", () => {
  it("Front Desk enrolls from today; the student is on the roster and it is audited", async () => {
    const [s, b] = await Promise.all([student("Aarav Deshmukh"), batch("Beginners B")]);
    const e = await withTenant(T, (tx) => enroll(tx, frontDesk, { studentId: s, batchId: b }));
    expect(e).toMatchObject({ status: "active", startDate: today, endDate: null });
    expect((await withTenant(T, (tx) => batchRoster(tx, owner, b))).map((r) => r.studentName)).toEqual(["Aarav Deshmukh"]);
    expect(await actions([e.id])).toEqual(["enrollment.create"]);
    expect((await withTenant(T, (tx) => batchChoices(tx, frontDesk))).map((c) => c.id)).toContain(b);
  });

  it("refuses in plain words", async () => {
    const [s, b] = await Promise.all([student("Zoya Shaikh"), batch("Refusals")]);
    const tryEnroll = (ctx: ScopedCtx, input: { studentId: string; batchId: string; startDate?: string }) => withTenant(T, (tx) => enroll(tx, ctx, input));
    await expect(tryEnroll(teacher, { studentId: s, batchId: b })).rejects.toMatchObject({ status: 403 });
    await expect(tryEnroll(owner, { studentId: s, batchId: b, startDate: addDays(today, -31) })).rejects.toThrow("Refusals starts on");
    await tryEnroll(owner, { studentId: s, batchId: b });
    await expect(tryEnroll(owner, { studentId: s, batchId: b, startDate: addDays(today, 10) })).rejects.toThrow("Already in Refusals");

    const closed = await batch("Closed one");
    await withTenant(T, (tx) => closeBatch(tx, owner, closed, {}));
    await expect(tryEnroll(owner, { studentId: s, batchId: closed })).rejects.toThrow("Closed one is closed");

    const gone = await batch("Gone");
    await withTenant(T, (tx) => archiveBatch(tx, owner, gone));
    await expect(tryEnroll(owner, { studentId: s, batchId: gone })).rejects.toMatchObject({ status: 404 });

    const paused = await student("Meher Kaur");
    await withTenant(T, (tx) => setStudentStatus(tx, owner, paused, { status: "paused" }));
    await expect(tryEnroll(owner, { studentId: paused, batchId: b })).rejects.toThrow("Only active students can join a batch");

    const k = await student("Kothrud Kid", kothrud);
    await expect(tryEnroll(kothrudDesk, { studentId: k, batchId: b })).rejects.toMatchObject({ status: 404 }); // batch in another branch
  });

  it("a batch or student with enrollments can't be deleted", async () => {
    const [s, b] = await Promise.all([student("Ishaan Patil"), batch("In use")]);
    await withTenant(T, (tx) => enroll(tx, owner, { studentId: s, batchId: b }));
    await expect(withTenant(T, (tx) => archiveBatch(tx, owner, b))).rejects.toThrow("This batch has students. Close it instead.");
    await expect(withTenant(T, (tx) => archiveStudent(tx, owner, s))).rejects.toThrow("Mark them as left instead");
  });
});

describe("pause, move, leave", () => {
  it("pause keeps them on the roster, flagged; resume clears it", async () => {
    const [s, b] = await Promise.all([student("Anaya Deshmukh"), batch("Pausing")]);
    const e = await withTenant(T, (tx) => enroll(tx, frontDesk, { studentId: s, batchId: b }));
    await withTenant(T, (tx) => pauseEnrollment(tx, frontDesk, e.id));
    expect(await one(e.id)).toMatchObject({ status: "paused", pausedOn: today });
    expect((await withTenant(T, (tx) => batchRoster(tx, owner, b))).map((r) => [r.studentName, r.status])).toEqual([["Anaya Deshmukh", "paused"]]);
    await expect(withTenant(T, (tx) => pauseEnrollment(tx, frontDesk, e.id))).rejects.toThrow("Already paused");
    await withTenant(T, (tx) => resumeEnrollment(tx, frontDesk, e.id));
    expect(await one(e.id)).toMatchObject({ status: "active", pausedOn: null });
    expect(await actions([e.id])).toEqual(["enrollment.create", "enrollment.pause", "enrollment.resume"]);
  });

  it("a move closes the old enrollment, links it and never re-points its batch", async () => {
    const [s, six, seven] = await Promise.all([student("Rohan Jadhav"), batch("Six PM"), batch("Seven PM")]);
    const old = await withTenant(T, (tx) => enroll(tx, owner, { studentId: s, batchId: six, startDate: addDays(today, -20) }));
    const moveOn = addDays(today, 3);
    const next = await withTenant(T, (tx) => transferEnrollment(tx, owner, old.id, { batchId: seven, date: moveOn }));
    expect(await one(old.id)).toMatchObject({ batchId: six, status: "transferred", endDate: addDays(moveOn, -1), transferredToEnrollmentId: next.id });
    expect(next).toMatchObject({ batchId: seven, status: "active", startDate: moveOn });
    expect((await withTenant(T, (tx) => rosterOf(tx, six, today))).map((r) => r.id)).toEqual([old.id]); // until the move
    expect(await withTenant(T, (tx) => rosterOf(tx, six, moveOn))).toEqual([]);
    expect((await withTenant(T, (tx) => rosterOf(tx, seven, moveOn))).map((r) => r.id)).toEqual([next.id]);
    expect(await actions([old.id])).toEqual(["enrollment.create", "enrollment.transfer"]);
    await expect(withTenant(T, (tx) => transferEnrollment(tx, owner, old.id, { batchId: six }))).rejects.toThrow("No longer in this batch");
  });

  it("leaving before the start date cancels it: off the roster, in the past list, and the batch can take them again", async () => {
    const [s, b] = await Promise.all([student("Tara Nair"), batch("Later")]);
    const e = await withTenant(T, (tx) => enroll(tx, owner, { studentId: s, batchId: b, startDate: addDays(today, 5) }));
    await withTenant(T, (tx) => leaveEnrollment(tx, owner, e.id));
    expect(await one(e.id)).toMatchObject({ status: "left", endDate: addDays(today, 4) });
    expect(await withTenant(T, (tx) => rosterOf(tx, b, today))).toEqual([]);
    expect((await withTenant(T, (tx) => studentBatches(tx, owner, s))).current).toEqual([]);
    await withTenant(T, (tx) => enroll(tx, owner, { studentId: s, batchId: b, startDate: addDays(today, 5) }));
  });

  it("moving on the joining day leaves the old batch with no days at all", async () => {
    const [s, wrong, right] = await Promise.all([student("Kabir Sheikh"), batch("Wrong"), batch("Right")]);
    const e = await withTenant(T, (tx) => enroll(tx, owner, { studentId: s, batchId: wrong }));
    await withTenant(T, (tx) => transferEnrollment(tx, owner, e.id, { batchId: right }));
    expect(await withTenant(T, (tx) => rosterOf(tx, wrong, today))).toEqual([]);
    expect((await withTenant(T, (tx) => studentBatches(tx, owner, s))).past).toEqual([expect.objectContaining({ batchName: "Wrong", nextBatchName: "Right" })]);
  });

  it("leave keeps them through the last day, then they're gone; the profile keeps the whole story", async () => {
    const [s, a, b] = await Promise.all([student("Sara Khan"), batch("Leaving A"), batch("Leaving B")]);
    const first = await withTenant(T, (tx) => enroll(tx, owner, { studentId: s, batchId: a, startDate: addDays(today, -20) }));
    const second = await withTenant(T, (tx) => transferEnrollment(tx, owner, first.id, { batchId: b, date: addDays(today, -10) }));
    const last = addDays(today, 7);
    await withTenant(T, (tx) => leaveEnrollment(tx, owner, second.id, { date: last }));
    expect(await one(second.id)).toMatchObject({ status: "left", endDate: last });
    expect((await withTenant(T, (tx) => rosterOf(tx, b, last))).map((r) => r.id)).toEqual([second.id]);
    expect(await withTenant(T, (tx) => rosterOf(tx, b, addDays(last, 1)))).toEqual([]);
    const view = await withTenant(T, (tx) => studentBatches(tx, owner, s));
    expect(view.current.map((e) => e.batchName)).toEqual(["Leaving B"]);
    expect(view.past.map((e) => [e.batchName, e.nextBatchName])).toEqual([["Leaving A", "Leaving B"]]);
    await expect(withTenant(T, (tx) => leaveEnrollment(tx, owner, second.id))).rejects.toThrow("No longer in this batch");
  });
});

describe("the student's own status carries to their batches", () => {
  it("paused pauses them, active resumes them, left ends them all that day", async () => {
    const [s, a, b] = await Promise.all([student("Vihaan More"), batch("Follow A"), batch("Follow B")]);
    const ea = await withTenant(T, (tx) => enroll(tx, owner, { studentId: s, batchId: a }));
    const eb = await withTenant(T, (tx) => enroll(tx, owner, { studentId: s, batchId: b, startDate: addDays(today, 5) }));
    await withTenant(T, (tx) => setStudentStatus(tx, owner, s, { status: "paused" }));
    expect([(await one(ea.id))?.status, (await one(eb.id))?.status]).toEqual(["paused", "paused"]);
    await withTenant(T, (tx) => setStudentStatus(tx, owner, s, { status: "active" }));
    expect([(await one(ea.id))?.status, (await one(eb.id))?.pausedOn]).toEqual(["active", null]);
    await withTenant(T, (tx) => setStudentStatus(tx, owner, s, { status: "left", reason: "moved_away" }));
    expect(await one(ea.id)).toMatchObject({ status: "left", endDate: today });
    expect(await one(eb.id)).toMatchObject({ status: "left", endDate: addDays(today, 4) }); // never started
    const [audit] = await withTenant(T, (tx) =>
      tx.select({ after: auditLog.after }).from(auditLog).where(and(eq(auditLog.entityId, s), eq(auditLog.action, "student.status.set"))).orderBy(auditLog.id).offset(2),
    );
    expect((audit?.after as { enrollmentIds: string[] }).enrollmentIds.sort()).toEqual([ea.id, eb.id].sort());
  });
});
