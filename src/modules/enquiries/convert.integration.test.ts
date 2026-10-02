import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { sql as runtimeSql } from "@/lib/db/client";
import { addDays } from "@/lib/dates";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { classRoster, saveAttendance } from "@/modules/attendance/service";
import { addProgram, createBatch } from "@/modules/batches/service";
import { enrollments } from "@/modules/enrollments/schema";
import { localToUtc } from "@/modules/sessions/occurrences";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { sessions } from "@/modules/sessions/schema";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { guardiansOfStudent } from "@/modules/students/repo";
import { students } from "@/modules/students/schema";
import { createStudent } from "@/modules/students/service";
import { tenantToday } from "@/modules/tenancy/repo";
import { testAcademy } from "@/lib/db/isolation/academy";
import { convertEnquiry, suggestedBatch } from "./convert";
import { activitiesOf, getEnquiry, trialsOf } from "./repo";
import { createEnquiry, markLost } from "./service";
import { bookTrial } from "./trials";

// docs/03 §4 acceptance: enquiry → trial booked → trial attended → converted,
// joined_on = the conversion date; docs/06 Prompt 18: one step, no re-typing.

const stamp = Math.random().toString(36).slice(2, 8);
const CONSENT = { dataProcessing: true, whatsapp: true };
let T = "";
let owner: ScopedCtx;
let desk: ScopedCtx;
let teacher: ScopedCtx;
let program = "";
let batch = "";
let today = "";
let n = 0;

const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const enquiry = (name: string, phone = `98711${String(10_000 + ++n)}`) => withTenant(T, (tx) => createEnquiry(tx, desk, { name, phone, programId: program }));
const convert = (ctx: ScopedCtx, id: string, input: object) => withTenant(T, (tx) => convertEnquiry(tx, ctx, id, { batchId: batch, consents: CONSENT, ...input }));

beforeAll(async () => {
  const t = await testAcademy({ name: `Convert ${stamp}`, slug: `convert-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `convert-owner-${stamp}@example.test` } });
  T = t.tenant.id;
  owner = await ctxFor(t.owner.id);
  const roles = Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r.id]));
  const hire = async (name: string, role: string) => ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `${name}-${stamp}@example.test`, fullName: name, roleId: roles[role] ?? "" }))).id);
  desk = await hire("desk", "Front Desk");
  teacher = await hire("teacher", "Teacher");
  today = await withTenant(T, tenantToday);
  program = (await withTenant(T, (tx) => addProgram(tx, owner, { name: "Karate" }))).id;
  const everyDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "06:00", endTime: "07:00" }));
  batch = (await withTenant(T, (tx) => createBatch(tx, owner, { name: "Early", programId: program, coachId: teacher.staffId, slots: everyDay, startDate: today }))).id;
  await withTenant(T, (tx) => reconcileSessions(tx, { now: localToUtc(today, "00:00", "Asia/Kolkata"), batchIds: [batch] }));
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("converting an enquiry", () => {
  it("enquiry → trial booked → trial attended → converted: student, family, guardian and enrollment in one step, joined today", async () => {
    const e = await enquiry("Aarav Deshmukh", "98711 00001");
    const [session] = await withTenant(T, (tx) => tx.select().from(sessions).where(and(eq(sessions.batchId, batch), eq(sessions.sessionDate, today))));
    await withTenant(T, (tx) => bookTrial(tx, desk, e.id, { sessionId: session?.id ?? "" }));
    const [trial] = await withTenant(T, (tx) => trialsOf(tx, e.id));
    await withTenant(T, (tx) => saveAttendance(tx, teacher, session?.id ?? "", { marks: [{ studentId: trial?.id ?? "", status: "present" }] }));
    expect((await withTenant(T, (tx) => getEnquiry(tx, [], e.id)))?.status).toBe("trial_done");
    expect(await withTenant(T, (tx) => suggestedBatch(tx, e.id, null))).toBe(batch);
    const [later] = await withTenant(T, (tx) => tx.select().from(sessions).where(and(eq(sessions.batchId, batch), eq(sessions.sessionDate, addDays(today, 2)))));
    await withTenant(T, (tx) => bookTrial(tx, desk, e.id, { sessionId: later?.id ?? "" })); // not needed once they join

    const done = await convert(desk, e.id, { guardian: { fullName: "Rakesh Deshmukh", relation: "father" } });
    const [student] = await withTenant(T, (tx) => tx.select().from(students).where(eq(students.id, done.studentId)));
    expect(student).toMatchObject({ fullName: "Aarav Deshmukh", joinedOn: today, status: "active" });
    const [guardian] = await withTenant(T, (tx) => guardiansOfStudent(tx, done.studentId));
    expect(guardian).toMatchObject({ fullName: "Rakesh Deshmukh", phone: "+919871100001", relation: "father", whatsappOptin: true });
    const [enrolled] = await withTenant(T, (tx) => tx.select().from(enrollments).where(eq(enrollments.id, done.enrollmentId)));
    expect(enrolled).toMatchObject({ studentId: done.studentId, batchId: batch, startDate: today });

    const after = await withTenant(T, (tx) => getEnquiry(tx, [], e.id));
    expect(after).toMatchObject({ status: "won", convertedStudentId: done.studentId, nextFollowUp: null });
    expect(after?.wonAt).toBeInstanceOf(Date);
    expect((await withTenant(T, (tx) => activitiesOf(tx, e.id)))[0]).toMatchObject({ toStatus: "won", note: "Joined Early" });
    expect((await withTenant(T, (tx) => trialsOf(tx, e.id))).map((t) => [t.mark, Boolean(t.cancelledAt)])).toEqual([
      [null, true],
      ["present", false],
    ]);
    // Joined today, so today's class lists them once, as a student.
    expect((await withTenant(T, (tx) => classRoster(tx, owner, session?.id ?? ""))).entries.filter((x) => x.name === "Aarav Deshmukh").map((x) => x.trial)).toEqual([false]);
    await expect(convert(desk, e.id, { guardian: { fullName: "Again", relation: "father" } })).rejects.toThrow("Already joined");
  });

  it("a phone already on a family asks first, then joins that family", async () => {
    const existing = await withTenant(T, (tx) => createStudent(tx, owner, { fullName: "Riya Sharma", guardian: { fullName: "Sunita Sharma", phone: "98711 00002", relation: "mother" }, consents: { dataProcessing: true } }));
    const e = await enquiry("Kabir Sharma", "98711 00002");
    await expect(convert(desk, e.id, { guardian: { fullName: "Sunita Sharma", relation: "mother" } })).rejects.toMatchObject({ status: 409, details: { householdId: existing.household.id } });
    const done = await convert(desk, e.id, { guardian: { fullName: "Sunita Sharma", relation: "mother" }, householdId: existing.household.id });
    const [kabir] = await withTenant(T, (tx) => tx.select().from(students).where(eq(students.id, done.studentId)));
    expect(kabir?.householdId).toBe(existing.household.id);
  });

  it("an adult is their own contact", async () => {
    const e = await enquiry("Meher Kaur", "98711 00003");
    const done = await convert(desk, e.id, { adult: true, dateOfBirth: "1998-05-05" });
    expect((await withTenant(T, (tx) => guardiansOfStudent(tx, done.studentId)))[0]).toMatchObject({ relation: "self", phone: "+919871100003" });
  });

  it("needs consent, the parent's name, an open enquiry and the right permissions", async () => {
    const e = await enquiry("Zoya Shaikh");
    await expect(convert(desk, e.id, { guardian: { fullName: "Sana Shaikh", relation: "mother" }, consents: { dataProcessing: false } })).rejects.toThrow("Data-processing consent is required");
    await expect(convert(desk, e.id, {})).rejects.toThrow("Add the parent's name");
    await expect(convert(desk, e.id, { adult: true })).rejects.toThrow("Add the date of birth for an adult");
    await expect(convert(teacher, e.id, { guardian: { fullName: "Sana Shaikh", relation: "mother" } })).rejects.toMatchObject({ status: 403 });
    await withTenant(T, (tx) => markLost(tx, desk, e.id, { reason: "fees" }));
    await expect(convert(desk, e.id, { guardian: { fullName: "Sana Shaikh", relation: "mother" } })).rejects.toThrow("Reopen it first");
  });
});
