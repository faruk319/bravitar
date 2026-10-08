import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { addHoliday } from "@/modules/batches/service";
import { closeRulesFrom, createProgram, insertBatch, insertRules } from "@/modules/batches/repo";
import { enrollments } from "@/modules/enrollments/schema";
import { enroll, pauseEnrollment } from "@/modules/enrollments/service";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { setSessionStatus } from "@/modules/sessions/repo";
import { sessions } from "@/modules/sessions/schema";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { createStudent } from "@/modules/students/service";
import { testAcademy } from "@/lib/db/isolation/academy";
import { attendance, type Mark } from "./schema";
import { attendanceCalendar, attendanceTrend, classRoster, monthGrid, saveAttendance, studentAttendance, todaysClasses } from "./service";

const stamp = Math.random().toString(36).slice(2, 8);
const MWF = [1, 3, 5].map((weekday) => ({ weekday, startTime: "18:00", endTime: "19:00" }));
const at = (s: string) => new Date(s);
let T = "";
let owner: ScopedCtx;
let teacherA: ScopedCtx;
let teacherB: ScopedCtx;
let manager: ScopedCtx;
let program = "";
let branch = "";
let phone = 0;

const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const student = async (name: string) =>
  (await withTenant(T, (tx) => createStudent(tx, owner, { fullName: name, guardian: { fullName: `Parent of ${name}`, phone: `+9197${String(10_000_000 + ++phone)}`, relation: "mother" }, consents: { dataProcessing: true } }))).student.id;
let batchNo = 0;
// Batch straight through the repo, with classes generated from 1 Oct 2026.
const batch = async (coachId: string | null, capacity?: number) => {
  const id = await withTenant(T, async (tx) => {
    const b = await insertBatch(tx, { tenantId: T, branchId: branch, programId: program, name: `Batch ${++batchNo}`, startDate: "2026-10-01", coachId, capacity });
    await insertRules(tx, T, b.id, MWF, "2026-10-01");
    return b.id;
  });
  await withTenant(T, (tx) => reconcileSessions(tx, { now: at("2026-09-30T18:30:00Z"), batchIds: [id] }));
  return id;
};
const join = (studentId: string, batchId: string) => withTenant(T, (tx) => enroll(tx, owner, { studentId, batchId, startDate: "2026-10-01" }));
const classOn = async (batchId: string, date: string) =>
  (await withTenant(T, (tx) => tx.select().from(sessions).where(and(eq(sessions.batchId, batchId), eq(sessions.sessionDate, date)))))[0]?.id ?? "";
const save = (ctx: ScopedCtx, sessionId: string, marks: { studentId: string; status: Mark }[], now: string) =>
  withTenant(T, (tx) => saveAttendance(tx, ctx, sessionId, { marks }, { now: at(now) }));
const rows = (sessionId: string) => withTenant(T, (tx) => tx.select().from(attendance).where(eq(attendance.sessionId, sessionId)));

beforeAll(async () => {
  const t = await testAcademy({ name: `Attendance ${stamp}`, slug: `att-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `att-owner-${stamp}@example.test` } });
  T = t.tenant.id;
  branch = t.branch.id;
  owner = await ctxFor(t.owner.id);
  program = (await withTenant(T, (tx) => createProgram(tx, { tenantId: T, name: "Karate", activityKey: "karate" }))).id;
  const roles = Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r.id]));
  const staff = async (name: string, role: string) =>
    ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `${name}-${stamp}@example.test`, fullName: name, roleId: roles[role] ?? "" }))).id);
  [teacherA, teacherB, manager] = [await staff("ta", "Teacher"), await staff("tb", "Teacher"), await staff("mgr", "Manager")];
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("marking a class", () => {
  let A = "";
  let B = "";
  const kids: string[] = [];

  beforeAll(async () => {
    [A, B] = [await batch(teacherA.staffId), await batch(teacherB.staffId)];
    for (const name of ["Aarav", "Zoya", "Ishaan", "Meher"]) kids.push(await student(`${name} ${stamp}`));
    for (const k of kids) await join(k, A);
    await join(kids[0] ?? "", B);
  });

  it("Today shows a teacher only their classes, the owner all of them, with counts", async () => {
    const mine = await withTenant(T, (tx) => todaysClasses(tx, teacherA, { now: at("2026-10-05T06:00:00Z") }));
    expect(mine.date).toBe("2026-10-05");
    expect(mine.classes.map((c) => [c.session.batchId, c.students, c.marked])).toEqual([[A, 4, 0]]);
    const all = await withTenant(T, (tx) => todaysClasses(tx, owner, { now: at("2026-10-05T06:00:00Z") }));
    expect(all.classes.map((c) => c.session.batchId).sort()).toEqual([A, B].sort());
  });

  it("a save writes one row per student, again changes nothing, and the class is held; the audit lists changes", async () => {
    const id = await classOn(A, "2026-10-05");
    const marks = [
      { studentId: kids[0] ?? "", status: "present" as const },
      { studentId: kids[1] ?? "", status: "absent" as const },
    ];
    expect(await save(teacherA, id, marks, "2026-10-05T13:00:00Z")).toMatchObject({ changed: 2 });
    expect(await save(teacherA, id, marks, "2026-10-05T13:01:00Z")).toMatchObject({ changed: 0 });
    expect(await save(teacherA, id, [{ studentId: kids[1] ?? "", status: "late" }], "2026-10-05T13:02:00Z")).toMatchObject({ changed: 1 });
    const saved = await rows(id);
    expect(saved.map((r) => [r.studentId, r.status]).sort()).toEqual([[kids[0], "present"], [kids[1], "late"]].sort());
    const [s] = await withTenant(T, (tx) => tx.select().from(sessions).where(eq(sessions.id, id)));
    expect(s?.status).toBe("held");
    const audits = await withTenant(T, (tx) => tx.select({ after: auditLog.after }).from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, "attendance.save"))).orderBy(auditLog.id));
    expect(audits.map((a) => (a.after as { changes: unknown[] }).changes.length)).toEqual([2, 1]);
    expect((audits[1]?.after as { changes: unknown[] }).changes).toEqual([{ studentId: kids[1], from: "absent", to: "late" }]);
  });

  it("two phones saving the same class at once give one row per student", async () => {
    const id = await classOn(A, "2026-10-07");
    const now = "2026-10-07T13:00:00Z";
    await Promise.all([save(teacherA, id, [{ studentId: kids[2] ?? "", status: "present" }], now), save(owner, id, [{ studentId: kids[2] ?? "", status: "absent" }], now)]);
    expect((await rows(id)).length).toBe(1);
  });

  it("unmarked students have no row; paused ones sit last, flagged, and can't be marked", async () => {
    const [e] = await withTenant(T, (tx) => tx.select().from(enrollments).where(eq(enrollments.studentId, kids[3] ?? "")));
    await withTenant(T, (tx) => pauseEnrollment(tx, owner, e?.id ?? ""));
    const id = await classOn(A, "2026-10-09");
    const view = await withTenant(T, (tx) => classRoster(tx, teacherA, id, { now: at("2026-10-09T13:00:00Z") }));
    expect(view.entries.map((x) => [x.studentId, x.mark, x.paused])).toEqual([
      [kids[0], null, false], // Aarav
      [kids[2], null, false], // Ishaan
      [kids[1], null, false], // Zoya
      [kids[3], null, true], // Meher, paused
    ]);
    expect(view.canMark).toBe(true);
    await expect(save(teacherA, id, [{ studentId: kids[3] ?? "", status: "present" }], "2026-10-09T13:00:00Z")).rejects.toThrow("is paused");
    expect(await rows(id)).toEqual([]);
  });

  it("refuses a later date, a cancelled class, a stranger and another coach's class; today before the start is fine", async () => {
    const oct12 = await classOn(A, "2026-10-12");
    const one = [{ studentId: kids[0] ?? "", status: "present" as const }];
    await expect(save(teacherA, oct12, one, "2026-10-11T12:00:00Z")).rejects.toThrow("Mark it on the day");
    expect(await save(teacherA, oct12, one, "2026-10-12T02:00:00Z")).toMatchObject({ changed: 1 }); // 7:30 AM, class at 6 PM
    const oct14 = await classOn(A, "2026-10-14");
    await withTenant(T, (tx) => setSessionStatus(tx, [oct14], "cancelled", "Holiday"));
    await expect(save(teacherA, oct14, one, "2026-10-14T13:00:00Z")).rejects.toThrow("This class was cancelled (Holiday)");
    const stranger = await student(`Stranger ${stamp}`);
    await expect(save(teacherA, oct12, [{ studentId: stranger, status: "present" }], "2026-10-12T13:00:00Z")).rejects.toThrow("isn't on this class's roster");
    await expect(save(teacherB, oct12, one, "2026-10-12T13:00:00Z")).rejects.toMatchObject({ status: 404 });
  });

  it("marks lock 48 hours after class for teachers; attendance:amend can still change them", async () => {
    const id = await classOn(A, "2026-10-05");
    const later = "2026-10-07T13:00:00Z"; // 48.5 h after the 12:30Z start
    await expect(save(teacherA, id, [{ studentId: kids[0] ?? "", status: "absent" }], later)).rejects.toMatchObject({ status: 403 });
    expect((await withTenant(T, (tx) => classRoster(tx, teacherA, id, { now: at(later) }))).lock).toBe("locked");
    expect(await save(manager, id, [{ studentId: kids[0] ?? "", status: "absent" }], later)).toMatchObject({ changed: 1 });
  });

  it("a marked class survives a later timing change", async () => {
    const id = await classOn(B, "2026-10-16");
    await save(teacherB, id, [{ studentId: kids[0] ?? "", status: "present" }], "2026-10-16T05:00:00Z"); // marked early that morning
    await withTenant(T, async (tx) => {
      await closeRulesFrom(tx, B, "2026-10-16");
      await insertRules(tx, T, B, MWF.map((s) => ({ ...s, startTime: "19:00", endTime: "20:00" })), "2026-10-16");
    });
    await withTenant(T, (tx) => reconcileSessions(tx, { now: at("2026-10-16T06:00:00Z"), batchIds: [B] }));
    const day = await withTenant(T, (tx) => tx.select().from(sessions).where(and(eq(sessions.batchId, B), eq(sessions.sessionDate, "2026-10-16"))));
    expect(day.map((s) => [s.id, s.status])).toEqual([[id, "held"]]);
  });
});

describe("offline sync", () => {
  it("30 marks replayed twice land exactly once, stored as offline_sync", async () => {
    const E = await batch(null);
    const kids: string[] = [];
    for (let i = 0; i < 30; i++) kids.push(await student(`Sync ${String(i).padStart(2, "0")} ${stamp}`));
    for (const k of kids) await join(k, E);
    const id = await classOn(E, "2026-10-05");
    const marks = kids.map((k) => ({ studentId: k, status: "present" as const }));
    const replay = () => withTenant(T, (tx) => saveAttendance(tx, owner, id, { marks, source: "offline_sync" }, { now: at("2026-10-05T14:00:00Z") }));
    expect((await replay()).changed).toBe(30);
    expect((await replay()).changed).toBe(0);
    const saved = await rows(id);
    expect(saved.length).toBe(30);
    expect(new Set(saved.map((r) => r.source))).toEqual(new Set(["offline_sync"]));
  });

  it("replacing another staff member's mark is reported with their name; your own is not", async () => {
    const F = await batch(teacherA.staffId);
    const kid = await student(`Conflict ${stamp}`);
    await join(kid, F);
    const id = await classOn(F, "2026-10-05");
    const mark = (ctx: ScopedCtx, status: Mark) => withTenant(T, (tx) => saveAttendance(tx, ctx, id, { marks: [{ studentId: kid, status }] }, { now: at("2026-10-05T14:00:00Z") }));
    expect((await mark(owner, "present")).conflicts).toEqual([]);
    expect((await mark(teacherA, "absent")).conflicts).toEqual([{ studentId: kid, name: `Conflict ${stamp}`, from: "present", to: "absent", by: "Owner" }]);
    expect((await mark(teacherA, "late")).conflicts).toEqual([]); // their own mark
  });
});

describe("reading attendance back", () => {
  it("the monthly register for 40 students is right and quick", async () => {
    const C = await batch(null);
    const kids: string[] = [];
    for (let i = 0; i < 40; i++) kids.push(await student(`Grid ${String(i).padStart(2, "0")} ${stamp}`));
    for (const k of kids) await join(k, C);
    for (const date of ["2026-10-02", "2026-10-05", "2026-10-07"]) {
      const id = await classOn(C, date);
      await save(owner, id, kids.map((k, i) => ({ studentId: k, status: i % 10 === 0 ? "absent" : "present" })), `${date}T13:00:00Z`);
    }
    const started = performance.now();
    const grid = await withTenant(T, (tx) => monthGrid(tx, owner, C, "2026-10"));
    const ms = performance.now() - started;
    expect(grid.students.length).toBe(40);
    expect(grid.classes.map((c) => c.date)).toEqual(["2026-10-02", "2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12", "2026-10-14", "2026-10-16", "2026-10-19", "2026-10-21", "2026-10-23", "2026-10-26", "2026-10-28", "2026-10-30"]);
    expect(Object.keys(grid.marks).length).toBe(120);
    expect(Object.values(grid.marks).filter((m) => m === "absent").length).toBe(12);
    expect(ms).toBeLessThan(300);
  });

  it("a student's last 30 days: counts, % and the most recent first", async () => {
    const D = await batch(null);
    const s = await student(`Summary ${stamp}`);
    await join(s, D);
    const marks: [string, Mark][] = [
      ["2026-10-02", "present"],
      ["2026-10-05", "absent"],
      ["2026-10-07", "late"],
    ];
    for (const [date, status] of marks) await save(owner, await classOn(D, date), [{ studentId: s, status }], `${date}T13:00:00Z`);
    const r = await withTenant(T, (tx) => studentAttendance(tx, owner, s, { now: at("2026-10-10T12:00:00Z") }));
    expect(r.counts).toEqual({ present: 1, absent: 1, late: 1, excused: 0, unmarked: 1 }); // 9 Oct not marked
    expect(r.percent).toBe(67);
    expect(r.recent.map((c) => [c.date, c.mark])).toEqual([["2026-10-09", null], ["2026-10-07", "late"], ["2026-10-05", "absent"], ["2026-10-02", "present"]]);
    const all = await withTenant(T, (tx) => tx.select().from(attendance).where(inArray(attendance.studentId, [s])));
    expect(all.length).toBe(3);
  });
});

describe("today's class card", () => {
  const today = () => withTenant(T, (tx) => todaysClasses(tx, owner, { now: at("2026-10-05T06:00:00Z") }));

  it("carries the batch capacity and the effective coach, null when capacity is unset", async () => {
    const [capped, open] = [await batch(teacherA.staffId, 15), await batch(null)];
    await join(await student(`Cap ${stamp}`), capped);
    const cards = (await today()).classes;
    const c = cards.find((x) => x.session.batchId === capped);
    expect(c).toMatchObject({ capacity: 15, students: 1 });
    expect(c?.coachName).toBeTypeOf("string");
    expect(cards.find((x) => x.session.batchId === open)).toMatchObject({ capacity: null, coachName: null });
  });

  it("a substitute on the session takes the class over the batch's coach", async () => {
    const id = await batch(teacherA.staffId, 10);
    const session = await classOn(id, "2026-10-05");
    const before = (await today()).classes.find((x) => x.session.id === session)?.coachName;
    await withTenant(T, (tx) => tx.update(sessions).set({ coachId: teacherB.staffId }).where(eq(sessions.id, session)));
    const after = (await today()).classes.find((x) => x.session.id === session)?.coachName;
    expect(before).toBeTypeOf("string");
    expect(after).toBeTypeOf("string");
    expect(after).not.toBe(before);
  });
});

describe("a student's month and trend", () => {
  const now = at("2026-10-20T12:00:00Z");
  let s = "";
  const cal = (ctx: ScopedCtx, month: string) => withTenant(T, (tx) => attendanceCalendar(tx, ctx, s, month, { now }));
  const state = (c: Awaited<ReturnType<typeof cal>>, date: string) => c.cells.find((x) => x.date === date)?.state;

  beforeAll(async () => {
    const D = await batch(null);
    s = await student(`Month ${stamp}`);
    await join(s, D);
    await save(owner, await classOn(D, "2026-10-05"), [{ studentId: s, status: "absent" }], "2026-10-05T13:00:00Z");
    await save(owner, await classOn(D, "2026-10-07"), [{ studentId: s, status: "late" }], "2026-10-07T13:00:00Z");
  });

  it("marks land on their days; a class nobody marked is Not marked, never Absent", async () => {
    const c = await cal(owner, "2026-10");
    expect(state(c, "2026-10-05")).toBe("absent");
    expect(state(c, "2026-10-07")).toBe("late");
    expect(state(c, "2026-10-09")).toBe("unmarked");
    expect(c.tally).toMatchObject({ absent: 1, late: 1, present: 0 });
  });

  it("a holiday on a class day reads as a holiday, not an absence", async () => {
    expect(state(await cal(owner, "2026-10"), "2026-10-12")).toBe("unmarked"); // a Monday class, before the holiday
    await withTenant(T, (tx) => addHoliday(tx, owner, { date: "2026-10-12", name: "Test Holiday" }, { now: at("2026-10-01T00:00:00Z") }));
    const c = await cal(owner, "2026-10");
    expect(state(c, "2026-10-12")).toBe("holiday");
    expect(c.cells.find((x) => x.date === "2026-10-12")?.holiday).toBe("Test Holiday");
    expect(c.tally.absent).toBe(1); // still only the 5 Oct absence
  });

  it("a month with no classes is all No class and its trend row has no classes and no percentage", async () => {
    const aug = await cal(owner, "2026-08");
    expect(aug.cells.every((x) => x.state === "none")).toBe(true);
    expect(aug.tally).toEqual({ present: 0, late: 0, absent: 0, excused: 0, unmarked: 0 });
    const trend = await withTenant(T, (tx) => attendanceTrend(tx, owner, s, { now }));
    expect(trend.map((m) => m.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(trend.find((m) => m.month === "2026-08")).toMatchObject({ classes: 0, pct: null });
    // Positive control: October has classes and a real rate (1 late of 2 marked).
    expect(trend.find((m) => m.month === "2026-10")).toMatchObject({ pct: 50 });
    expect(trend.find((m) => m.month === "2026-10")?.classes).toBeGreaterThan(2);
  });

  it("needs attendance:read; a teacher without it gets nothing, the owner gets the data", async () => {
    await expect(cal(teacherA, "2026-10")).rejects.toMatchObject({ status: 403 });
    await expect(withTenant(T, (tx) => attendanceTrend(tx, teacherA, s, { now }))).rejects.toMatchObject({ status: 403 });
    await expect(withTenant(T, (tx) => studentAttendance(tx, teacherA, s, { now }))).rejects.toMatchObject({ status: 403 });
    expect((await cal(owner, "2026-10")).cells.length).toBe(31);
  });

  it("rejects a malformed month", async () => {
    await expect(cal(owner, "2026-13")).rejects.toMatchObject({ status: 400 });
  });
});
