import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { testAcademy } from "@/lib/db/isolation/academy";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { type Mark, attendance } from "@/modules/attendance/schema";
import { classRoster, saveAttendance } from "@/modules/attendance/service";
import { createProgram, insertBatch } from "@/modules/batches/repo";
import { insertEnrollment } from "@/modules/enrollments/repo";
import { cancelPayment, recordPayment, refundPayment } from "@/modules/payments/service";
import { sessions } from "@/modules/sessions/schema";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { createStudent } from "@/modules/students/service";
import { extendPack, packBalance } from "./packs";
import { invoices, sessionPacks } from "./schema";
import { createPlan, studentPlanDetail, studentPlanList } from "./service";

// Finance spec, addendum 2026-10-21: prepaid session packs.
const stamp = Math.random().toString(36).slice(2, 8);
const at = (day: string) => new Date(`${day}T06:00:00Z`); // 11:30 in India

let T = "";
let main = "";
let batch = "";
let packPlan = "";
let monthly = "";
let owner: ScopedCtx;
let desk: ScopedCtx;
let kids = 0;

const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};

// A child on the pack plan; returns the child and the enrollment.
async function enrolled(planId = packPlan): Promise<{ kid: string; enrollment: string }> {
  const n = ++kids;
  const c = await withTenant(T, (tx) => createStudent(tx, owner, { fullName: `Pack child ${n}`, guardian: { fullName: `Pack mother ${n}`, phone: `98765 ${51_000 + n}`, relation: "mother" }, consents: { dataProcessing: true } }));
  const e = await withTenant(T, (tx) => insertEnrollment(tx, { tenantId: T, studentId: c.student.id, batchId: batch, startDate: "2026-10-01", feePlanId: planId }));
  return { kid: c.student.id, enrollment: e.id };
}

const sell = (kid: string, enrollmentId: string, day: string, amountPaise = "300000") =>
  withTenant(T, (tx) => recordPayment(tx, desk, { requestId: uuidv7(), memberId: kid, branchId: main, amountPaise, pack: { enrollmentId } }, { now: at(day) }));

const packsOf = (enrollmentId: string) => withTenant(T, (tx) => tx.select().from(sessionPacks).where(eq(sessionPacks.enrollmentId, enrollmentId)).orderBy(sessionPacks.validFrom));

async function mark(kid: string, day: string, status: Mark): Promise<void> {
  await withTenant(T, async (tx) => {
    // One batch for everyone: a day's session is made once and shared.
    const [held] = await tx.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.batchId, batch), eq(sessions.sessionDate, day)));
    const id = held?.id ?? uuidv7();
    if (!held) await tx.insert(sessions).values({ id, tenantId: T, branchId: main, batchId: batch, startsAt: at(day), endsAt: new Date(at(day).getTime() + 3_600_000), sessionDate: day });
    await tx.insert(attendance).values({ id: uuidv7(), tenantId: T, sessionId: id, studentId: kid, status });
  });
}

const balance = async (enrollmentId: string, day: string) => (await withTenant(T, (tx) => packBalance(tx, [enrollmentId], day))).get(enrollmentId);

beforeAll(async () => {
  const t = await testAcademy({ name: `Packs ${stamp}`, slug: `packs-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `packs-${stamp}@example.test` } });
  T = t.tenant.id;
  main = t.branch.id;
  owner = await ctxFor(t.owner.id);
  const roleId = (await withTenant(T, listRoles)).find((r) => r.name === "Front Desk")?.id ?? "";
  desk = await ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `desk-${stamp}@example.test`, fullName: "Desk", roleId }))).id);
  const program = await withTenant(T, (tx) => createProgram(tx, { tenantId: T, name: "Personal training", activityKey: "karate" }));
  batch = (await withTenant(T, (tx) => insertBatch(tx, { tenantId: T, branchId: main, programId: program.id, name: "PT with Ravi", startDate: "2026-10-01" }))).id;
  packPlan = (await withTenant(T, (tx) => createPlan(tx, owner, { name: "PT 3 sessions", kind: "package", amountPaise: "300000", sessions: 3, validDays: 30 }))).id;
  monthly = (await withTenant(T, (tx) => createPlan(tx, owner, { name: "PT monthly", kind: "recurring", billingCycle: "monthly", amountPaise: "300000" }))).id;
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("the pack plan", () => {
  it("needs sessions and days valid, and keeps them", async () => {
    const make = (extra: object) => withTenant(T, (tx) => createPlan(tx, owner, { name: `Pack ${uuidv7()}`, kind: "package", amountPaise: "100000", ...extra }));
    await expect(make({ validDays: 30 })).rejects.toMatchObject({ status: 400, message: "Enter the sessions" });
    await expect(make({ sessions: 5 })).rejects.toMatchObject({ status: 400, message: "Enter the days valid" });
    const plan = await make({ sessions: 5, validDays: 60 });
    expect([plan.billingCycle, plan.metadata]).toEqual(["one_time", { sessions: 5, valid_days: 60 }]);
  });
});

describe("selling a pack at the desk", () => {
  it("issues and pays its invoice in one step, and the pack starts today", async () => {
    const { kid, enrollment } = await enrolled();
    await sell(kid, enrollment, "2026-10-21");
    const [pack] = await packsOf(enrollment);
    expect(pack).toMatchObject({ studentId: kid, sessions: 3, validFrom: "2026-10-21", validUntil: "2026-11-19", createdBy: desk.staffId });
    const [inv] = await withTenant(T, (tx) => tx.select().from(invoices).where(eq(invoices.id, pack?.invoiceId ?? "")));
    expect([inv?.status, inv?.totalPaise, inv?.paidPaise]).toEqual(["paid", 300_000n, 300_000n]);
  });

  it("is paid in full, and only for an enrollment of this student on a pack plan", async () => {
    const { kid, enrollment } = await enrolled();
    await expect(sell(kid, enrollment, "2026-10-21", "200000")).rejects.toMatchObject({ status: 400, message: "A session pack is paid in full" });
    const other = await enrolled();
    await expect(sell(kid, other.enrollment, "2026-10-21")).rejects.toMatchObject({ status: 400, message: "Pick one of this student's programs" });
    const onMonthly = await enrolled(monthly);
    await expect(sell(onMonthly.kid, onMonthly.enrollment, "2026-10-21")).rejects.toMatchObject({ status: 400, message: "This program isn't on a session pack" });
    expect(await packsOf(enrollment)).toEqual([]);
  });
});

describe("sessions left", () => {
  it("counts only Present and Late inside the window, oldest pack first", async () => {
    const { kid, enrollment } = await enrolled();
    await mark(kid, "2026-10-20", "present"); // before the pack
    await sell(kid, enrollment, "2026-10-21");
    await mark(kid, "2026-10-22", "present");
    await mark(kid, "2026-10-23", "late");
    await mark(kid, "2026-10-24", "absent");
    await mark(kid, "2026-10-25", "excused");
    expect(await balance(enrollment, "2026-10-25")).toEqual({ left: 1, until: "2026-11-19" });
    await sell(kid, enrollment, "2026-10-26"); // until 2026-11-24
    await mark(kid, "2026-10-27", "present"); // the first pack's last one
    await mark(kid, "2026-10-28", "present"); // the second pack
    expect(await balance(enrollment, "2026-10-28")).toEqual({ left: 2, until: "2026-11-24" });
  });

  it("unused sessions lapse on expiry", async () => {
    const { kid, enrollment } = await enrolled();
    await sell(kid, enrollment, "2026-10-21");
    await mark(kid, "2026-10-22", "present");
    expect(await balance(enrollment, "2026-11-19")).toEqual({ left: 2, until: "2026-11-19" });
    expect(await balance(enrollment, "2026-11-20")).toEqual({ left: 0, until: null });
    const none = await enrolled();
    expect(await balance(none.enrollment, "2026-10-21")).toBeUndefined();
  });
});

describe("a pack no longer paid for", () => {
  it("has no sessions once its payment is cancelled", async () => {
    const { kid, enrollment } = await enrolled();
    const p = await sell(kid, enrollment, "2026-10-21");
    await withTenant(T, (tx) => cancelPayment(tx, desk, p.id, { reason: "Wrong entry" }, { now: at("2026-10-21") }));
    expect(await balance(enrollment, "2026-10-22")).toBeUndefined();
  });

  it("has no sessions once its payment is refunded", async () => {
    const { kid, enrollment } = await enrolled();
    const p = await sell(kid, enrollment, "2026-10-21");
    await withTenant(T, (tx) => refundPayment(tx, owner, p.id, { amountPaise: "300000", reason: "Left the academy" }, { now: at("2026-10-22") }));
    expect(await balance(enrollment, "2026-10-22")).toBeUndefined();
  });
});

describe("extending a pack", () => {
  it("needs invoices:manage, a later date and a reason, and is audited", async () => {
    const { kid, enrollment } = await enrolled();
    await sell(kid, enrollment, "2026-10-21");
    const [pack] = await packsOf(enrollment);
    const id = pack?.id ?? "";
    expect((await withTenant(T, (tx) => studentPlanDetail(tx, owner, enrollment))).pack).toEqual({ id, validUntil: "2026-11-19" });
    const extend = (as: ScopedCtx, input: { until: string; reason: string }) => withTenant(T, (tx) => extendPack(tx, as, id, input));
    await expect(extend(desk, { until: "2026-12-01", reason: "Was ill" })).rejects.toMatchObject({ status: 403 });
    await expect(extend(owner, { until: "2026-11-10", reason: "Was ill" })).rejects.toMatchObject({ status: 400, message: "Pick a later date" });
    await expect(extend(owner, { until: "2026-12-01", reason: " " })).rejects.toThrow();
    expect(await extend(owner, { until: "2026-12-01", reason: "Was ill" })).toMatchObject({ validUntil: "2026-12-01", extendedReason: "Was ill" });
    expect(await balance(enrollment, "2026-11-25")).toEqual({ left: 3, until: "2026-12-01" });
    const audits = await withTenant(T, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, "session_pack.extend"))));
    expect(audits).toHaveLength(1);
  });
});

describe("marking against a pack", () => {
  let classes = 0;
  async function classOn(day: string): Promise<string> {
    const id = uuidv7();
    const starts = new Date(at(day).getTime() + ++classes * 60_000); // each test gets its own class
    await withTenant(T, (tx) => tx.insert(sessions).values({ id, tenantId: T, branchId: main, batchId: batch, startsAt: starts, endsAt: new Date(starts.getTime() + 3_600_000), sessionDate: day }));
    return id;
  }
  const save = (id: string, kid: string, status: Mark, day: string) => withTenant(T, (tx) => saveAttendance(tx, owner, id, { marks: [{ studentId: kid, status }] }, { now: new Date(at(day).getTime() + 3_600_000) }));
  const NONE = { status: 400, message: expect.stringMatching(/^No sessions left for Pack child \d+ — sell a new pack$/) };

  it("refuses Present and Late with none left, allows Absent, and the last session can be marked", async () => {
    const { kid, enrollment } = await enrolled();
    const none = await classOn("2026-10-21");
    await expect(save(none, kid, "present", "2026-10-21")).rejects.toMatchObject(NONE);
    await save(none, kid, "absent", "2026-10-21");
    await sell(kid, enrollment, "2026-10-21");
    for (const d of ["2026-10-22", "2026-10-23", "2026-10-24"]) await save(await classOn(d), kid, "present", d);
    expect((await balance(enrollment, "2026-10-24"))?.left).toBe(0);
    const extra = await classOn("2026-10-25");
    await expect(save(extra, kid, "late", "2026-10-25")).rejects.toMatchObject(NONE);
    await save(extra, kid, "absent", "2026-10-25");
    await sell(kid, enrollment, "2026-10-25");
    await save(extra, kid, "late", "2026-10-25");
    expect((await balance(enrollment, "2026-10-25"))?.left).toBe(2);
  });

  it("refuses the whole save and names only the student with none left", async () => {
    const empty = await enrolled();
    const fine = await enrolled();
    await sell(fine.kid, fine.enrollment, "2026-10-21");
    const id = await classOn("2026-10-22");
    const both = withTenant(T, (tx) => saveAttendance(tx, owner, id, { marks: [{ studentId: fine.kid, status: "present" }, { studentId: empty.kid, status: "present" }] }, { now: new Date(at("2026-10-22").getTime() + 3_600_000) }));
    const name = `Pack child ${kids - 1}`;
    await expect(both).rejects.toMatchObject({ status: 400, message: `No sessions left for ${name} — sell a new pack` });
    const rows = await withTenant(T, (tx) => tx.select().from(attendance).where(eq(attendance.sessionId, id)));
    expect(rows).toEqual([]);
  });

  it("applies when a mark is amended, but not to a mark that already counts", async () => {
    const { kid, enrollment } = await enrolled();
    await sell(kid, enrollment, "2026-10-21");
    const days = ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
    const ids = [];
    for (const d of days) ids.push(await classOn(d));
    await save(ids[3] ?? "", kid, "absent", days[3] ?? "");
    for (const [i, d] of days.slice(0, 3).entries()) await save(ids[i] ?? "", kid, "present", d);
    await expect(save(ids[3] ?? "", kid, "present", days[3] ?? "")).rejects.toMatchObject(NONE);
    await save(ids[0] ?? "", kid, "late", days[0] ?? ""); // already used
  });

  it("does not count a cancelled class", async () => {
    const { kid, enrollment } = await enrolled();
    await sell(kid, enrollment, "2026-10-21");
    const id = await classOn("2026-10-22");
    await save(id, kid, "present", "2026-10-22");
    await withTenant(T, (tx) => tx.update(sessions).set({ status: "cancelled", cancelReason: "Rain" }).where(eq(sessions.id, id)));
    expect((await balance(enrollment, "2026-10-22"))?.left).toBe(3);
  });

  it("shows sessions left on the roster, the student plans and the card, low at 2 or fewer", async () => {
    const { kid, enrollment } = await enrolled();
    await sell(kid, enrollment, "2026-10-21");
    const d1 = "2026-10-22";
    await save(await classOn(d1), kid, "present", d1);
    const id = await classOn("2026-10-23");
    const entry = async () => (await withTenant(T, (tx) => classRoster(tx, owner, id, { now: at("2026-10-23") }))).entries.find((e) => e.studentId === kid);
    expect(await entry()).toMatchObject({ sessionsLeft: 2, sessionsLow: true });
    const list = await withTenant(T, (tx) => studentPlanList(tx, owner, { tab: "active", q: `Pack child ${kids}`, page: 1 }, { now: at("2026-10-23") }));
    const row = list.rows.find((r) => r.enrollmentId === enrollment);
    expect(row?.packText).toBe("Sessions low · 2 of 3 left · until 19 Nov");
  });
});
