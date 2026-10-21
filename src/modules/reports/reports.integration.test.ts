import { and, asc, eq, lt } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import type { ScopedCtx } from "@/lib/auth/route";
import { parseCsv, toCsv } from "@/lib/csv";
import { sql as runtimeSql } from "@/lib/db/client";
import { addDays } from "@/lib/dates";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import type { Tx } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { saveAttendance } from "@/modules/attendance/service";
import { login, setPassword } from "@/modules/auth/service";
import { addProgram, createBatch } from "@/modules/batches/service";
import { enroll } from "@/modules/enrollments/service";
import { insertInvoice, insertLines, updateInvoice } from "@/modules/fees/repo";
import { allocateNumber } from "@/modules/numbering/repo";
import { cancelPayment, collectionList, collectionSheet, recordPayment } from "@/modules/payments/service";
import { localToUtc } from "@/modules/sessions/occurrences";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { sessions } from "@/modules/sessions/schema";
import { createGuardian, guardiansOfMembers, upsertFamilyLink } from "@/modules/students/repo";
import { guardians } from "@/modules/students/schema";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { addRole, createStaffMember, loadAccessContext, setRolePermissions } from "@/modules/staff/service";
import { billableFamily } from "@/lib/db/isolation/family";
import { createStudent, setStudentStatus } from "@/modules/students/service";
import { createBranch, tenantToday } from "@/modules/tenancy/repo";
import { testAcademy } from "@/lib/db/isolation/academy";
import { attendanceRows, collectionRows, enquiryRows } from "./csv";
import { csvRoute } from "./routes";
import { admissionsReport, atRisk, attendanceReport, collectionBuckets, collectionRegister, financeOverview, outstandingDues, revenueReport } from "./service";

// The branch switcher's cookie, which a route reads outside a request: none is set.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

// docs/03 §11: the collection register (a day's total equals its sheet), dues
// aged by days past the due date, attendance, admissions and dropouts; the
// at-risk list (all agreed 2026-09-25).

// The guardian ids of a member, lead first.
const guardiansOf = async (tx: Tx, studentId: string): Promise<string[]> => (await guardiansOfMembers(tx, [studentId])).map((g) => g.id);
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
const owe = (studentId: string, rupees: number, late: number, at = branch) =>
  withTenant(T, async (tx) => {
    const total = BigInt(rupees) * 100n;
    const due = addDays(today, -late);
    const [payer] = await guardiansOf(tx, studentId);
    const [who] = payer ? await tx.select({ name: guardians.fullName }).from(guardians).where(eq(guardians.id, payer)) : [];
    const inv = await insertInvoice(tx, { tenantId: T, branchId: at, studentId, payerGuardianId: payer ?? null, billToName: who?.name ?? null, issueDate: addDays(due, -7), dueDate: due, subtotalPaise: total, totalPaise: total });
    return updateInvoice(tx, inv.id, { number: await allocateNumber(tx, T, "invoice", "2026-27"), fy: "2026-27", status: "issued", issuedAt: new Date() });
  });
const family = (name: string) => withTenant(T, (tx) => billableFamily(tx, owner, name));
const pay = (memberId: string, rupees: number, method: "cash" | "upi" = "cash", at = branch) =>
  withTenant(T, async (tx) => recordPayment(tx, owner, { requestId: uuidv7(), memberId, branchId: at, amountPaise: String(rupees * 100), method }));

beforeAll(async () => {
  const t = await testAcademy({ name: `Reports ${stamp}`, slug: `reports-${stamp}`, owner: { name: "Owner", email: `reports-owner-${stamp}@example.test` } });
  T = t.tenant.id;
  branch = t.branch.id;
  owner = await ctxFor(t.owner.id);
  other = (await withTenant(T, (tx) => createBranch(tx, { tenantId: T, name: "Second" }))).id;
  const roles = Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r.id]));
  desk = await ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `desk-${stamp}@example.test`, fullName: "Desk", roleId: roles["Front Desk"] ?? "" }))).id);
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
    await pay(sharma.studentId, 800);
    await pay(sharma.studentId, 450, "upi");
    const wrong = await pay(sharma.studentId, 99);
    await withTenant(T, (tx) => cancelPayment(tx, owner, wrong.id, { reason: "Typed wrong" }));
    await pay((await family("Other branch family")).studentId, 300, "cash", other);

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
      await owe(patil.studentId, rupees, late);
    const r = await withTenant(T, (tx) => outstandingDues(tx, owner));
    expect(r.payers.find((f) => f.name === "Patil family")).toMatchObject({ invoices: 6, notDue: 10_000n, days0to30: 50_000n, days31to60: 90_000n, over60: 60_000n });
  });

  it("one member with two payers is two rows, each its own payer's dues", async () => {
    const kulkarni = await family("Kulkarni mother");
    const father = await withTenant(T, async (tx) => {
      const g = await createGuardian(tx, { tenantId: T, fullName: "Kulkarni father", phone: "98733 70001" });
      await upsertFamilyLink(tx, { tenantId: T, studentId: kulkarni.studentId, guardianId: g.id, relation: "father" });
      return g;
    });
    const billTo = (payerGuardianId: string, name: string, rupees: number, late: number) =>
      withTenant(T, async (tx) => {
        const total = BigInt(rupees) * 100n;
        const due = addDays(today, -late);
        const inv = await insertInvoice(tx, { tenantId: T, branchId: branch, studentId: kulkarni.studentId, payerGuardianId, billToName: name, issueDate: addDays(due, -7), dueDate: due, subtotalPaise: total, totalPaise: total });
        return updateInvoice(tx, inv.id, { number: await allocateNumber(tx, T, "invoice", "2026-27"), fy: "2026-27", status: "issued", issuedAt: new Date() });
      });
    await billTo(kulkarni.guardianId, "Kulkarni mother", 100, 10);
    await billTo(kulkarni.guardianId, "Kulkarni mother", 200, 10);
    await billTo(father.id, "Kulkarni father", 700, 70);
    const rows = (await withTenant(T, (tx) => outstandingDues(tx, owner))).payers.filter((p) => p.name.startsWith("Kulkarni"));
    expect(rows).toHaveLength(2);
    expect(rows.find((p) => p.name === "Kulkarni mother")).toMatchObject({ payerKey: `guardian:${kulkarni.guardianId}`, invoices: 2, days0to30: 30_000n, over60: 0n });
    expect(rows.find((p) => p.name === "Kulkarni father")).toMatchObject({ payerKey: `guardian:${father.id}`, invoices: 1, days0to30: 0n, over60: 70_000n });
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
  const student: Record<string, { id: string }> = {};
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
      student[name] = { id: s.student.id };
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
    await owe(student["Bina Mane"]?.id ?? "", 500, 5);
    await owe(student["Bina Mane"]?.id ?? "", 700, 40);
    await owe(student["Asha Kulkarni"]?.id ?? "", 500, 3);
    await owe(student["Asha Kulkarni"]?.id ?? "", 500, -5); // not due yet
    await owe(student["Chetan More"]?.id ?? "", 300, 35);
    await owe(student["Chetan More"]?.id ?? "", 300, 4);
    await owe(student["Esha Pawar"]?.id ?? "", 300, 10);
    await owe(student["Esha Pawar"]?.id ?? "", 300, 20);

    const r = await withTenant(T, (tx) => atRisk(tx, owner));
    expect(r.attendance?.map((s) => [s.name, s.percent])).toEqual([["Bina Mane", 40]]);
    expect(r.unpaid?.map((s) => [s.name, s.overdue, s.owedPaise])).toEqual([
      ["Bina Mane", 2, 120_000n],
      ["Chetan More", 2, 60_000n],
    ]);

    await pay(student["Chetan More"]?.id ?? "", 300); // the older one, in full
    expect((await withTenant(T, (tx) => atRisk(tx, owner))).unpaid?.map((s) => s.name)).toEqual(["Bina Mane"]);
    // The front desk sees fees, not attendance.
    const seen = await withTenant(T, (tx) => atRisk(tx, desk));
    expect([seen.attendance, seen.unpaid?.map((s) => s.name)]).toEqual([null, ["Bina Mane"]]);
    expect((await withTenant(T, (tx) => atRisk(tx, { ...owner, branchIds: [other] }))).unpaid).toEqual([]);
  });

  it("at risk counts overdue invoices per payer: two payers of one member with one each aren't flagged", async () => {
    const gita = await withTenant(T, (tx) => createStudent(tx, owner, { fullName: "Gita Rane", branchId: branch, joinedOn: addDays(today, -20), guardian: { fullName: "Mother Rane", phone: "98744 20001", relation: "mother" }, consents: { dataProcessing: true } }));
    const [mother] = await withTenant(T, (tx) => guardiansOf(tx, gita.student.id));
    const father = await withTenant(T, (tx) => createGuardian(tx, { tenantId: T, fullName: "Father Rane", phone: "98744 20002" }));
    await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: gita.student.id, guardianId: father.id, relation: "father" }));
    const oweBy = (payerGuardianId: string | undefined, late: number) =>
      withTenant(T, async (tx) => {
        const due = addDays(today, -late);
        const inv = await insertInvoice(tx, { tenantId: T, branchId: branch, studentId: gita.student.id, payerGuardianId: payerGuardianId ?? null, billToName: "Rane", issueDate: addDays(due, -7), dueDate: due, subtotalPaise: 40_000n, totalPaise: 40_000n });
        return updateInvoice(tx, inv.id, { number: await allocateNumber(tx, T, "invoice", "2026-27"), fy: "2026-27", status: "issued", issuedAt: new Date() });
      });
    await oweBy(mother, 5);
    await oweBy(father.id, 6);
    const names = async () => (await withTenant(T, (tx) => atRisk(tx, owner))).unpaid?.map((s) => [s.name, s.overdue]);
    expect(await names()).not.toContainEqual(["Gita Rane", expect.anything()]);
    expect((await names())?.length).toBeGreaterThan(0); // the list isn't empty, so the line above says something
    await oweBy(father.id, 7);
    expect(await names()).toContainEqual(["Gita Rane", 2]); // the father now has two
  });
});

describe("enquiry funnel CSV", () => {
  it("stages as a share of those received", () => {
    const rows = enquiryRows({ from: "2026-09-01", to: "2026-09-25", funnel: { received: 4, contacted: 3, trialBooked: 2, trialDone: 1, won: 1, lost: 1 }, sources: [{ source: "walk_in", received: 4, won: 1 }], lost: [{ reason: "fees", count: 1 }] });
    expect(rows.find((r) => r[0] === "Contacted")).toEqual(["Contacted", "3", "75"]);
    expect(rows.find((r) => r[0] === "Walk-in")).toEqual(["Walk-in", "4", "1", "25"]);
  });
});

describe("CSV downloads", () => {
  const PASSWORD = "Correct-Horse-9";
  const cookie: Record<string, string> = {};
  const csvAs = (as: string, path: string) => csvRoute(new Request(`http://reports-${stamp}.localhost:3000${path}`, { headers: { cookie: cookie[as] ?? "" } }));
  const table = async (path: string) => parseCsv(await (await csvAs("owner", path)).text());

  beforeAll(async () => {
    // A role that may read reports but not download them.
    const viewer = await withTenant(T, async (tx) => {
      const role = await addRole(tx, owner, { name: "Report viewer" });
      await setRolePermissions(tx, owner, role.id, ["reports:view"]);
      return role;
    });
    const member = await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `viewer-${stamp}@example.test`, fullName: "Viewer", roleId: viewer.id }));
    for (const [key, staffId, email] of [["owner", owner.staffId, `reports-owner-${stamp}@example.test`], ["viewer", member.id, `viewer-${stamp}@example.test`]] as const) {
      await withTenant(T, (tx) => setPassword(tx, owner, staffId, PASSWORD));
      cookie[key] = `${SESSION_COOKIE}=${(await login({ slug: `reports-${stamp}`, email, password: PASSWORD })).token}`;
    }
  });

  it("the collections CSV holds exactly the filtered rows", async () => {
    const kid = (await family("CSV family")).studentId;
    await pay(kid, 300, "upi");
    await pay(kid, 200, "cash");
    const count = async (q: { method?: "upi" }) => (await withTenant(T, (tx) => collectionList(tx, owner, { period: "today", sort: "newest", page: 1, ...q }))).matched;
    const [upi, everything] = [await count({ method: "upi" }), await count({})];
    expect(upi).toBeGreaterThan(0);
    expect(everything).toBeGreaterThan(upi);
    const rows = await table("/api/reports/collections?period=today&method=upi");
    expect(rows.length).toBe(1 + upi); // the header, then a row each
    expect(rows[0]?.slice(0, 3)).toEqual(["Recorded on", "Receipt", "Students"]);
    expect(rows.slice(1).every((r) => r[9] === "UPI")).toBe(true);
    expect((await table("/api/reports/collections?period=today")).length).toBe(1 + everything);
  });

  it("every CSV needs reports:export, not just reports:view", async () => {
    for (const name of ["collections", "collection", "dues", "admissions", "attendance", "at-risk", "enquiries"]) {
      expect((await csvAs("owner", `/api/reports/${name}`)).status, name).toBe(200);
      expect((await csvAs("viewer", `/api/reports/${name}`)).status, name).toBe(403);
    }
  });
});

// Task 16: its own academy on a fixed day, so the other tests' money stays out.
describe("finance overview", () => {
  const NOW = new Date("2026-09-24T06:30:00Z"); // noon in Kolkata
  let T2 = "";
  let boss: ScopedCtx;
  let front: ScopedCtx;
  let main = "";
  let second = "";
  const overview = (as: ScopedCtx = boss, now = NOW) => withTenant(T2, (tx) => financeOverview(tx, as, { now }));
  const ctxIn = async (staffId: string): Promise<ScopedCtx> => {
    const [base, branchIds] = await withTenant(T2, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
    return { ...base, branchIds };
  };
  const issue = (tx: Tx, studentId: string, payer: string, totalPaise: bigint, dueDate: string) =>
    insertInvoice(tx, { tenantId: T2, branchId: main, studentId, payerGuardianId: payer, billToName: "Payer", issueDate: "2026-09-24", dueDate, subtotalPaise: totalPaise, totalPaise }).then(async (inv) =>
      updateInvoice(tx, inv.id, { number: await allocateNumber(tx, T2, "invoice", "2026-27"), fy: "2026-27", status: "issued", issuedAt: NOW }),
    );
  const payIn = (memberId: string, paise: bigint, at: string, allocations?: { invoiceId: string; amountPaise: string }[]) =>
    withTenant(T2, (tx) => recordPayment(tx, boss, { requestId: uuidv7(), memberId, branchId: at, amountPaise: String(paise), method: "cash", ...(allocations ? { allocations } : {}) }, { now: NOW }));

  beforeAll(async () => {
    const t = await testAcademy({ name: `Overview ${stamp}`, slug: `overview-${stamp}`, owner: { name: "Owner", email: `overview-owner-${stamp}@example.test` } });
    T2 = t.tenant.id;
    main = t.branch.id;
    boss = await ctxIn(t.owner.id);
    second = (await withTenant(T2, (tx) => createBranch(tx, { tenantId: T2, name: "Second" }))).id;
    const roles = Object.fromEntries((await withTenant(T2, listRoles)).map((r) => [r.name, r.id]));
    front = await ctxIn((await withTenant(T2, (tx) => createStaffMember(tx, boss, { email: `overview-desk-${stamp}@example.test`, fullName: "Desk", roleId: roles["Front Desk"] ?? "" }))).id);
    await withTenant(T2, async (tx) => {
      const f = await billableFamily(tx, boss, "Due family");
      await issue(tx, f.studentId, f.guardianId, 100_000n, "2026-09-30"); // today + 6
      await issue(tx, f.studentId, f.guardianId, 200_000n, "2026-10-01"); // today + 7
    });
  });

  it("program rows plus advance equal the collection total to the paisa", async () => {
    // one invoice for kid: ₹333.33 Karate line + ₹666.67 Dance line; pay ₹500.01 on it, then ₹200 more as advance
    const made = await withTenant(T2, (tx) => createStudent(tx, boss, { fullName: "Kid Two", branchId: main, guardian: { fullName: "Parent Two", phone: "98755 10001", relation: "mother" }, consents: { dataProcessing: true } }));
    const enrollIn = async (program: string) => {
      const p = (await withTenant(T2, (tx) => addProgram(tx, boss, { name: program }))).id;
      const b = (await withTenant(T2, (tx) => createBatch(tx, boss, { name: `${program} batch`, programId: p, branchId: main, slots: [{ weekday: 1, startTime: "07:00", endTime: "08:00" }], startDate: "2026-09-01" }))).id;
      return (await withTenant(T2, (tx) => enroll(tx, boss, { studentId: made.student.id, batchId: b, startDate: "2026-09-01" }))).id;
    };
    const [karate, dance] = [await enrollIn("Karate"), await enrollIn("Dance")];
    const inv = await withTenant(T2, async (tx) => {
      const i = await issue(tx, made.student.id, made.guardian.id, 100_000n, "2026-10-15");
      const line = (enrollmentId: string, amountPaise: bigint) => ({ tenantId: T2, invoiceId: i.id, enrollmentId, studentId: made.student.id, kind: "tuition" as const, description: "Fee", unitPaise: amountPaise, amountPaise });
      await insertLines(tx, [line(karate, 33_333n), line(dance, 66_667n)]);
      return i;
    });
    await payIn(made.student.id, 50_001n, main, [{ invoiceId: inv.id, amountPaise: "50001" }]);
    await payIn(made.student.id, 20_000n, main, []);
    const r = await withTenant(T2, (tx) => revenueReport(tx, boss, { from: "2026-09-24", to: "2026-09-24" }));
    expect(r.rows.reduce((n, x) => n + x.collectedPaise, 0n) + r.advancePaise).toBe(r.collectedPaise);
    expect(r.collectedPaise).toBe(70_001n);
    expect(r.advancePaise).toBe(20_000n);
    expect(r.rows.reduce((n, x) => n + x.outstandingPaise, 0n)).toBe(49_999n);
    expect(r.rows.find((x) => x.programName === "Karate")?.billedPaise).toBe(33_333n);
  });

  it("due in 7 days counts today through today + 6", async () => {
    // ₹1,000 due 2026-09-30 (today + 6) and ₹2,000 due 2026-10-01 (today + 7)
    expect((await overview()).owed).toMatchObject({ dueSoonCount: 1, dueSoonPaise: 100_000n, partPaidCount: 1 });
  });

  it("a viewer limited to one branch sees only that branch's totals", async () => {
    // ₹700 collected today in the second branch only
    await withTenant(T2, (tx) => billableFamily(tx, boss, "Second family")).then((f) => payIn(f.studentId, 70_000n, second));
    const all = await overview();
    const mainOnly = await overview({ ...boss, branchIds: [main] });
    expect((all.collected?.today.total ?? 0n) - (mainOnly.collected?.today.total ?? 0n)).toBe(70_000n);
  });

  it("today's collection equals the day sheets added up", async () => {
    const sheets = await Promise.all([main, second].map((b) => withTenant(T2, (tx) => collectionSheet(tx, boss, { branchId: b }, { now: NOW }))));
    expect((await overview()).collected?.today.total).toBe(sheets.reduce((n, s) => n + s.total.totalPaise, 0n));
    expect((await overview()).collected?.today.total).toBe(140_001n);
  });

  it("no trend chip when yesterday had nothing", async () => {
    expect((await overview()).collected?.yesterday.total).toBe(0n);
  });

  it("a viewer without payments:read gets no collection block", async () => {
    const o = await overview(front);
    expect(o.collected).toBeUndefined();
    expect(o.owed).toBeDefined();
  });

  it("fee status of this month's invoices by amount", async () => {
    expect((await overview()).mix).toEqual({ paid: 0n, part_paid: 100_000n, due: 300_000n, overdue: 0n });
  });
});
