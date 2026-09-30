import { and, asc, eq, lt } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { parseCsv, toCsv } from "@/lib/csv";
import { sql as runtimeSql } from "@/lib/db/client";
import { addDays } from "@/lib/dates";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { saveAttendance } from "@/modules/attendance/service";
import { addProgram, createBatch } from "@/modules/batches/service";
import { enroll } from "@/modules/enrollments/service";
import { insertInvoice, updateInvoice } from "@/modules/fees/repo";
import { allocateNumber } from "@/modules/numbering/repo";
import { cancelPayment, collectionSheet, recordPayment } from "@/modules/payments/service";
import { localToUtc } from "@/modules/sessions/occurrences";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { sessions } from "@/modules/sessions/schema";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { createHousehold } from "@/modules/students/repo";
import { createStudent, setStudentStatus } from "@/modules/students/service";
import { createBranch, tenantToday } from "@/modules/tenancy/repo";
import { testAcademy } from "@/lib/db/isolation/academy";
import { attendanceRows, collectionRows, enquiryRows } from "./csv";
import { admissionsReport, atRisk, attendanceReport, collectionBuckets, collectionRegister, outstandingDues } from "./service";

// docs/03 §11: the collection register (a day's total equals its sheet), dues
// aged by days past the due date, attendance, admissions and dropouts; the
// at-risk list (all agreed 2026-09-25).

const stamp = Math.random().toString(36).slice(2, 8);
let T = "";
let owner: ScopedCtx;
let desk: ScopedCtx;
let branch = "";
let other = "";
let today = "";

const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
// An issued invoice for a family, owing `rupees`, due `late` days ago.
const owe = (household: string, rupees: number, late: number, at = branch) =>
  withTenant(T, async (tx) => {
    const total = BigInt(rupees) * 100n;
    const due = addDays(today, -late);
    const inv = await insertInvoice(tx, { tenantId: T, branchId: at, householdId: household, issueDate: addDays(due, -7), dueDate: due, subtotalPaise: total, totalPaise: total });
    return updateInvoice(tx, inv.id, { number: await allocateNumber(tx, T, "invoice", "2026-27"), fy: "2026-27", status: "issued", issuedAt: new Date() });
  });
const family = (name: string) => withTenant(T, (tx) => createHousehold(tx, { tenantId: T, name }));
const pay = (householdId: string, rupees: number, method: "cash" | "upi" = "cash", at = branch) =>
  withTenant(T, (tx) => recordPayment(tx, owner, { requestId: uuidv7(), householdId, branchId: at, amountPaise: String(rupees * 100), method }));

beforeAll(async () => {
  const t = await testAcademy({ name: `Reports ${stamp}`, slug: `reports-${stamp}`, owner: { name: "Owner", email: `reports-owner-${stamp}@example.test` } });
  T = t.tenant.id;
  branch = t.branch.id;
  owner = await ctxFor(t.owner.id);
  other = (await withTenant(T, (tx) => createBranch(tx, { tenantId: T, name: "Second" }))).id;
  const roles = Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r.id]));
  desk = await ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `desk-${stamp}@example.test`, fullName: "Desk", roleIds: [roles["Front Desk"] ?? ""] }))).id);
  today = await withTenant(T, tenantToday);
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("collection register", () => {
  it("a day's total equals that day's collection sheet exactly; cancelled receipts are listed, not counted", async () => {
    const sharma = await family("Sharma family");
    await pay(sharma.id, 800);
    await pay(sharma.id, 450, "upi");
    const wrong = await pay(sharma.id, 99);
    await withTenant(T, (tx) => cancelPayment(tx, owner, wrong.id, { reason: "Typed wrong" }));
    await pay((await family("Other branch family")).id, 300, "cash", other);

    const r = await withTenant(T, (tx) => collectionRegister(tx, owner, { from: today, to: today }));
    const sheet = await withTenant(T, (tx) => collectionSheet(tx, owner, { branchId: branch }));
    const mine = await withTenant(T, (tx) => collectionRegister(tx, { ...owner, branchIds: [branch] }, { from: today, to: today }));
    expect(mine.total).toEqual({ key: "total", count: 2, totalPaise: sheet.total.totalPaise });
    expect(mine.rows).toHaveLength(3); // the cancelled one is listed
    expect(r.total.totalPaise).toBe(155_000n); // both branches
    expect(Object.fromEntries(mine.byMethod.map((t) => [t.key, t.totalPaise]))).toEqual({ cash: 80_000n, upi: 45_000n });

    const csv = parseCsv(toCsv(collectionRows(mine), { formulaSafe: true }));
    expect(csv.find((row) => row[0] === "Total")?.[5]).toBe("1250.00");
    expect(csv.some((row) => row[6]?.startsWith("Cancelled: Typed wrong"))).toBe(true);
  });

  it("needs reports:view", async () => {
    await expect(withTenant(T, (tx) => collectionRegister(tx, desk, { from: today, to: today }))).rejects.toMatchObject({ status: 403 });
  });
});

describe("outstanding dues", () => {
  it("aged by days past the due date: not due, 0–30, 31–60, over 60", async () => {
    const patil = await family("Patil family");
    for (const [rupees, late] of [
      [100, -1],
      [200, 0],
      [300, 30],
      [400, 31],
      [500, 60],
      [600, 61],
    ] as const)
      await owe(patil.id, rupees, late);
    const r = await withTenant(T, (tx) => outstandingDues(tx, owner));
    expect(r.families.find((f) => f.name === "Patil family")).toMatchObject({ invoices: 6, notDue: 10_000n, days0to30: 50_000n, days31to60: 90_000n, over60: 60_000n });
  });
});

describe("admissions and dropouts", () => {
  it("who joined and who left in the dates, with why", async () => {
    const make = (fullName: string, phone: string) => withTenant(T, (tx) => createStudent(tx, owner, { fullName, guardian: { fullName: `Parent of ${fullName}`, phone, relation: "mother" }, consents: { dataProcessing: true } }));
    await make("Riya Joshi", "98733 00001");
    const leaving = await make("Kabir Rao", "98733 00002");
    await withTenant(T, (tx) => setStudentStatus(tx, owner, leaving.student.id, { status: "left", reason: "moved_away" }));
    const r = await withTenant(T, (tx) => admissionsReport(tx, owner, { from: today, to: today }));
    expect(r.joined.map((s) => s.fullName).sort()).toEqual(["Kabir Rao", "Riya Joshi"]);
    expect(r.left).toMatchObject([{ fullName: "Kabir Rao", leftReason: "moved_away", on: today }]);
    expect((await withTenant(T, (tx) => admissionsReport(tx, owner, { from: addDays(today, -9), to: addDays(today, -1) }))).joined).toHaveLength(0);
    await expect(withTenant(T, (tx) => admissionsReport(tx, owner, { from: today, to: addDays(today, -1) }))).rejects.toThrow("comes after");
  });
});

describe("the register's columns", () => {
  it("one per day, empty days included; one per month past 62 days", () => {
    const byDay = [{ key: "2026-09-03", count: 2, totalPaise: 50_000n }];
    const days = collectionBuckets({ from: "2026-09-01", to: "2026-09-05", byDay });
    expect(days.unit).toBe("day");
    expect(days.buckets.map((b) => b.totalPaise)).toEqual([0n, 0n, 50_000n, 0n, 0n]);
    expect(collectionBuckets({ from: "2026-07-15", to: "2026-09-14", byDay }).unit).toBe("day"); // 62 days
    const months = collectionBuckets({ from: "2026-07-15", to: "2026-09-15", byDay });
    expect(months.buckets.map((b) => [b.from, b.to, b.count])).toEqual([
      ["2026-07-15", "2026-07-31", 0],
      ["2026-08-01", "2026-08-31", 0],
      ["2026-09-01", "2026-09-15", 2],
    ]);
  });
});

describe("attendance summary and the at-risk list", () => {
  type Mark = "present" | "late" | "absent" | "excused";
  // Eight past classes; a missing mark is an unmarked class.
  const MARKS: Record<string, Mark[]> = {
    "Asha Kulkarni": ["present", "present", "present", "absent", "absent"], // 60%: not at risk
    "Bina Mane": ["present", "present", "absent", "absent", "absent"], // 40%
    "Chetan More": ["present", "late", "present", "absent", "absent"], // late counts as there
    "Dev Naik": ["present", "present", "present", "absent", "absent", "excused", "excused", "excused"], // excused don't count
    "Esha Pawar": ["absent", "absent", "absent", "absent", "present"], // 20%, then paused
  };
  const student: Record<string, { id: string; household: string }> = {};
  let n = 0;

  beforeAll(async () => {
    const start = addDays(today, -10);
    const program = (await withTenant(T, (tx) => addProgram(tx, owner, { name: "Karate" }))).id;
    const everyDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "07:00", endTime: "08:00" }));
    const batch = (await withTenant(T, (tx) => createBatch(tx, owner, { name: "Daily", programId: program, branchId: branch, slots: everyDay, startDate: start }))).id;
    await withTenant(T, (tx) => reconcileSessions(tx, { now: localToUtc(start, "00:00", "Asia/Kolkata"), batchIds: [batch] }));
    for (const name of Object.keys(MARKS)) {
      const s = await withTenant(T, (tx) => createStudent(tx, owner, { fullName: name, branchId: branch, joinedOn: addDays(today, -20), guardian: { fullName: `Parent of ${name}`, phone: `98744${10_000 + ++n}`, relation: "mother" }, consents: { dataProcessing: true } }));
      await withTenant(T, (tx) => enroll(tx, owner, { studentId: s.student.id, batchId: batch, startDate: start }));
      student[name] = { id: s.student.id, household: s.household.id };
    }
    const past = await withTenant(T, (tx) => tx.select().from(sessions).where(and(eq(sessions.batchId, batch), lt(sessions.sessionDate, today))).orderBy(asc(sessions.sessionDate)));
    for (const [i, c] of past.slice(0, 8).entries()) {
      const marks = Object.entries(MARKS).flatMap(([name, m]) => (m[i] ? [{ studentId: student[name]?.id ?? "", status: m[i] }] : []));
      await withTenant(T, (tx) => saveAttendance(tx, owner, c.id, { marks }, { now: new Date(c.startsAt.getTime() + 3_600_000) }));
    }
    await withTenant(T, (tx) => setStudentStatus(tx, owner, student["Esha Pawar"]?.id ?? "", { status: "paused" }));
  });

  it("by batch and by student: (present + late) / (present + late + absent)", async () => {
    const r = await withTenant(T, (tx) => attendanceReport(tx, owner, { from: addDays(today, -10), to: today }));
    expect(r.batches).toMatchObject([{ batchName: "Daily", classes: 8, present: 11, late: 1, absent: 13, excused: 3, percent: 48 }]);
    const pct = Object.fromEntries(r.students.map((s) => [s.name, s.percent]));
    expect(pct).toEqual({ "Asha Kulkarni": 60, "Bina Mane": 40, "Chetan More": 60, "Dev Naik": 60, "Esha Pawar": 20 });
    expect(parseCsv(toCsv(attendanceRows(r))).find((row) => row[0] === "Daily")).toEqual(["Daily", "8", "11", "1", "13", "3", "48"]);
    expect((await withTenant(T, (tx) => attendanceReport(tx, { ...owner, branchIds: [other] }, { from: addDays(today, -10), to: today }))).students).toEqual([]);
  });

  it("at risk: under 60% (60 isn't), or two overdue invoices (one isn't; paying clears it); active students only", async () => {
    await owe(student["Bina Mane"]?.household ?? "", 500, 5);
    await owe(student["Bina Mane"]?.household ?? "", 700, 40);
    await owe(student["Asha Kulkarni"]?.household ?? "", 500, 3);
    await owe(student["Asha Kulkarni"]?.household ?? "", 500, -5); // not due yet
    await owe(student["Chetan More"]?.household ?? "", 300, 35);
    await owe(student["Chetan More"]?.household ?? "", 300, 4);
    await owe(student["Esha Pawar"]?.household ?? "", 300, 10);
    await owe(student["Esha Pawar"]?.household ?? "", 300, 20);

    const r = await withTenant(T, (tx) => atRisk(tx, owner));
    expect(r.attendance?.map((s) => [s.name, s.percent])).toEqual([["Bina Mane", 40]]);
    expect(r.unpaid?.map((s) => [s.name, s.overdue, s.owedPaise])).toEqual([
      ["Bina Mane", 2, 120_000n],
      ["Chetan More", 2, 60_000n],
    ]);

    await pay(student["Chetan More"]?.household ?? "", 300); // the older one, in full
    expect((await withTenant(T, (tx) => atRisk(tx, owner))).unpaid?.map((s) => s.name)).toEqual(["Bina Mane"]);
    // The front desk sees fees, not attendance.
    const seen = await withTenant(T, (tx) => atRisk(tx, desk));
    expect([seen.attendance, seen.unpaid?.map((s) => s.name)]).toEqual([null, ["Bina Mane"]]);
    expect((await withTenant(T, (tx) => atRisk(tx, { ...owner, branchIds: [other] }))).unpaid).toEqual([]);
  });
});

describe("enquiry funnel CSV", () => {
  it("stages as a share of those received", () => {
    const rows = enquiryRows({ from: "2026-09-01", to: "2026-09-25", funnel: { received: 4, contacted: 3, trialBooked: 2, trialDone: 1, won: 1, lost: 1 }, sources: [{ source: "walk_in", received: 4, won: 1 }], lost: [{ reason: "fees", count: 1 }] });
    expect(rows.find((r) => r[0] === "Contacted")).toEqual(["Contacted", "3", "75"]);
    expect(rows.find((r) => r[0] === "Walk-in")).toEqual(["Walk-in", "4", "1", "25"]);
  });
});
