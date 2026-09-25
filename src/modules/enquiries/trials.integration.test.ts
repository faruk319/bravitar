import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { sql as runtimeSql } from "@/lib/db/client";
import { addDays } from "@/lib/dates";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { attendance } from "@/modules/attendance/schema";
import { classRoster, saveAttendance } from "@/modules/attendance/service";
import { addProgram, createBatch } from "@/modules/batches/service";
import { ensurePlatformPlans } from "@/modules/platform/repo";
import { localToUtc } from "@/modules/sessions/occurrences";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { sessions } from "@/modules/sessions/schema";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { tenantToday } from "@/modules/tenancy/repo";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { activitiesOf, getEnquiry, trialsOf } from "./repo";
import { createEnquiry, markLost } from "./service";
import { bookTrial, cancelTrial, trialChoices } from "./trials";

// docs/03 §4 acceptance: a trial student appears on the teacher's roster and
// can be marked present without being enrolled; the enquiry follows its
// trials (agreed 2026-09-25).

const stamp = Math.random().toString(36).slice(2, 8);
let T = "";
let owner: ScopedCtx;
let teacher: ScopedCtx;
let program = "";
let batch = "";
let today = "";
let phone = 0;

const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const classOn = async (date: string) => (await withTenant(T, (tx) => tx.select().from(sessions).where(and(eq(sessions.batchId, batch), eq(sessions.sessionDate, date)))))[0]?.id ?? "";
const enquiry = (name: string) => withTenant(T, (tx) => createEnquiry(tx, owner, { name, phone: `98700${String(10_000 + ++phone)}`, programId: program }));
const status = async (id: string) => (await withTenant(T, (tx) => getEnquiry(tx, [], id)))?.status;
const mark = (sessionId: string, studentId: string, s: "present" | "absent", note?: string) =>
  withTenant(T, (tx) => saveAttendance(tx, teacher, sessionId, { marks: [{ studentId, status: s, ...(note ? { note } : {}) }] }));

beforeAll(async () => {
  await withPlatformAdmin({ action: "test.setup", actorType: "system" }, ensurePlatformPlans);
  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Trials ${stamp}`, slug: `trials-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `trials-owner-${stamp}@example.test` } });
  T = t.tenant.id;
  owner = await ctxFor(t.owner.id);
  const roles = Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r.id]));
  teacher = await ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `teacher-${stamp}@example.test`, fullName: "Ravi Coach", roleIds: [roles.Teacher ?? ""] }))).id);
  today = await withTenant(T, tenantToday);
  program = (await withTenant(T, (tx) => addProgram(tx, owner, { name: "Karate" }))).id;
  const everyDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "06:00", endTime: "07:00" }));
  batch = (await withTenant(T, (tx) => createBatch(tx, owner, { name: "Early", programId: program, coachId: teacher.staffId, slots: everyDay, startDate: today }))).id;
  await withTenant(T, (tx) => reconcileSessions(tx, { now: localToUtc(today, "00:00", "Asia/Kolkata"), batchIds: [batch] })); // today's class too
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("booking a trial", () => {
  it("goes into a real class and moves the enquiry to Trial booked; the same class twice is refused", async () => {
    const e = await enquiry("Aarav");
    const [first] = await withTenant(T, (tx) => trialChoices(tx, owner, e));
    expect(first).toMatchObject({ id: batch, name: "Early" });
    expect(first?.classes[0]?.date).toBe(today);

    const session = await classOn(today);
    await withTenant(T, (tx) => bookTrial(tx, owner, e.id, { sessionId: session }));
    const after = await withTenant(T, (tx) => getEnquiry(tx, [], e.id));
    expect(after?.status).toBe("trial_booked");
    expect([after?.contactedAt, after?.trialBookedAt].every((d) => d instanceof Date)).toBe(true);
    await expect(withTenant(T, (tx) => bookTrial(tx, owner, e.id, { sessionId: session }))).rejects.toThrow("Already booked for that class");
  });
});

describe("the trial on the roster", () => {
  it("shows on the teacher's roster, is marked without an enrollment, and the enquiry follows: present is Trial done, absent is missed", async () => {
    const e = await enquiry("Zoya");
    const session = await classOn(today);
    await withTenant(T, (tx) => bookTrial(tx, owner, e.id, { sessionId: session }));
    const roster = await withTenant(T, (tx) => classRoster(tx, teacher, session));
    const row = roster.entries.find((x) => x.name === "Zoya");
    expect(row).toMatchObject({ trial: true, mark: null, paused: false });
    const trialId = row?.studentId ?? "";

    await mark(session, trialId, "present", "Very keen");
    expect(await status(e.id)).toBe("trial_done");
    expect((await withTenant(T, (tx) => trialsOf(tx, e.id)))[0]).toMatchObject({ mark: "present", feedback: "Very keen", markedBy: teacher.staffId });
    expect(await withTenant(T, (tx) => tx.select().from(attendance).where(eq(attendance.studentId, trialId)))).toHaveLength(0);

    const again = await withTenant(T, (tx) => saveAttendance(tx, teacher, session, { marks: [{ studentId: trialId, status: "present", note: "Very keen" }] }));
    expect(again.changed).toBe(0); // a replay changes nothing

    await mark(session, trialId, "absent");
    expect(await status(e.id)).toBe("trial_booked");
    const notes = (await withTenant(T, (tx) => activitiesOf(tx, e.id))).map((a) => a.note).filter(Boolean);
    expect(notes).toEqual(expect.arrayContaining(["Came for the trial", "Missed the trial"]));
  });

  it("cancelling a booking takes it off the roster and back to Contacted; a marked one can't be cancelled", async () => {
    const e = await enquiry("Kabir");
    const tomorrow = await classOn(addDays(today, 1));
    await withTenant(T, (tx) => bookTrial(tx, owner, e.id, { sessionId: tomorrow }));
    const [trial] = await withTenant(T, (tx) => trialsOf(tx, e.id));
    await withTenant(T, (tx) => cancelTrial(tx, owner, trial?.id ?? ""));
    expect(await status(e.id)).toBe("contacted");
    expect((await withTenant(T, (tx) => classRoster(tx, owner, tomorrow))).entries.some((x) => x.name === "Kabir")).toBe(false);

    const marked = await enquiry("Riya");
    const session = await classOn(today);
    await withTenant(T, (tx) => bookTrial(tx, owner, marked.id, { sessionId: session }));
    const [t] = await withTenant(T, (tx) => trialsOf(tx, marked.id));
    await mark(session, t?.id ?? "", "present");
    await expect(withTenant(T, (tx) => cancelTrial(tx, owner, t?.id ?? ""))).rejects.toThrow("already marked");
  });

  it("a lost enquiry stays lost when its trial is marked", async () => {
    const e = await enquiry("Ishaan");
    const session = await classOn(today);
    await withTenant(T, (tx) => bookTrial(tx, owner, e.id, { sessionId: session }));
    await withTenant(T, (tx) => markLost(tx, owner, e.id, { reason: "no_reply" }));
    const [t] = await withTenant(T, (tx) => trialsOf(tx, e.id));
    await mark(session, t?.id ?? "", "present");
    expect(await status(e.id)).toBe("lost");
    await expect(withTenant(T, (tx) => bookTrial(tx, owner, e.id, { sessionId: session }))).rejects.toThrow("Reopen it first");
  });
});
