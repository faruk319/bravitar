import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { sql as runtimeSql } from "@/lib/db/client";
import { addDays } from "@/lib/dates";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { saveAttendance } from "@/modules/attendance/service";
import { batches } from "@/modules/batches/schema";
import { addProgram, createBatch } from "@/modules/batches/service";
import { createEnquiry, markLost } from "@/modules/enquiries/service";
import { bookTrial } from "@/modules/enquiries/trials";
import { enroll } from "@/modules/enrollments/service";
import { addMonths } from "@/modules/fees/billing";
import { insertInvoice, updateInvoice } from "@/modules/fees/repo";
import { allocateNumber } from "@/modules/numbering/repo";
import { recordPayment } from "@/modules/payments/service";
import { localToUtc } from "@/modules/sessions/occurrences";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { setSessionStatus } from "@/modules/sessions/repo";
import { sessions } from "@/modules/sessions/schema";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { students } from "@/modules/students/schema";
import { createHousehold } from "@/modules/students/repo";
import { createStudent } from "@/modules/students/service";
import { createBranch, tenantToday } from "@/modules/tenancy/repo";
import { testAcademy } from "@/lib/db/isolation/academy";
import { dashboardData } from "./service";

// docs/06 Prompt 19: Today, Money, At risk and Pipeline, each number from
// known data, and only for those who may see the list behind it.

const stamp = Math.random().toString(36).slice(2, 8);
const TZ = "Asia/Kolkata";
let T = "";
let owner: ScopedCtx;
let desk: ScopedCtx;
let branch = "";
let other = "";
let today = "";
let noon = new Date();
let n = 0;

const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const child = (fullName: string) => withTenant(T, (tx) => createStudent(tx, owner, { fullName, branchId: branch, guardian: { fullName: `Parent of ${fullName}`, phone: `98755${10_000 + ++n}`, relation: "mother" }, consents: { dataProcessing: true } }));
// An issued invoice owing `rupees`, due `late` days ago.
const owe = (householdId: string, rupees: number, late: number) =>
  withTenant(T, async (tx) => {
    const total = BigInt(rupees) * 100n;
    const due = addDays(today, -late);
    const inv = await insertInvoice(tx, { tenantId: T, branchId: branch, householdId, issueDate: addDays(due, -7), dueDate: due, subtotalPaise: total, totalPaise: total });
    return updateInvoice(tx, inv.id, { number: await allocateNumber(tx, T, "invoice", "2026-27"), fy: "2026-27", status: "issued", issuedAt: new Date() });
  });
const pay = (householdId: string, rupees: number, method: "cash" | "upi", on?: string) =>
  withTenant(T, (tx) => recordPayment(tx, owner, { requestId: uuidv7(), householdId, branchId: branch, amountPaise: String(rupees * 100), method }, on ? { now: localToUtc(on, "11:00", TZ) } : {}));

beforeAll(async () => {
  const t = await testAcademy({ name: `Dash ${stamp}`, slug: `dash-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `dash-owner-${stamp}@example.test` } });
  T = t.tenant.id;
  branch = t.branch.id;
  owner = await ctxFor(t.owner.id);
  other = (await withTenant(T, (tx) => createBranch(tx, { tenantId: T, name: "Other" }))).id;
  const roles = Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r.id]));
  desk = await ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `desk-${stamp}@example.test`, fullName: "Desk", roleId: roles["Front Desk"] ?? "" }))).id);
  today = await withTenant(T, tenantToday);
  noon = localToUtc(today, "12:00", TZ);

  // Today: 6:00 marked, 8:00 started and not marked, 20:00 still to come.
  const program = (await withTenant(T, (tx) => addProgram(tx, owner, { name: "Karate" }))).id;
  const at = (name: string, start: string, end: string) =>
    withTenant(T, (tx) => createBatch(tx, owner, { name, programId: program, branchId: branch, slots: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: start, endTime: end })), startDate: addDays(today, -7) }));
  const [early, morning, evening] = [await at("Early", "06:00", "07:00"), await at("Morning", "08:00", "09:00"), await at("Evening", "20:00", "21:00")];
  await withTenant(T, (tx) => reconcileSessions(tx, { now: localToUtc(today, "00:00", TZ), batchIds: [early.id, morning.id, evening.id] }));
  const classOn = async (batchId: string, day: string) => (await withTenant(T, (tx) => tx.select().from(sessions).where(and(eq(sessions.batchId, batchId), eq(sessions.sessionDate, day)))))[0]?.id ?? "";
  const kids = [await child("Asha"), await child("Bina"), await child("Chetan")];
  for (const k of kids) await withTenant(T, (tx) => enroll(tx, owner, { studentId: k.student.id, batchId: early.id, startDate: today }));
  const marks = (["present", "late", "absent"] as const).map((status, i) => ({ studentId: kids[i]?.student.id ?? "", status }));
  await withTenant(T, async (tx) => saveAttendance(tx, owner, await classOn(early.id, today), { marks }, { now: noon }));

  // Money: two receipts today, one three days ago; Kiran's family two invoices overdue, another not yet due.
  const sharma = await withTenant(T, (tx) => createHousehold(tx, { tenantId: T, name: "Sharma family" }));
  await pay(sharma.id, 200, "cash", addDays(today, -3));
  await pay(sharma.id, 500, "cash");
  await pay(sharma.id, 300, "upi");
  const kiran = await child("Kiran");
  await owe(kiran.household.id, 400, 10);
  await owe(kiran.household.id, 600, 40);
  await owe((await withTenant(T, (tx) => createHousehold(tx, { tenantId: T, name: "Mehta family" }))).id, 1000, -5);

  // Pipeline: one due today, one with a trial tomorrow, one lost.
  const enquiry = (ctx: ScopedCtx, name: string, extra: object = {}) => withTenant(T, (tx) => createEnquiry(tx, ctx, { name, phone: `98766${10_000 + ++n}`, programId: program, ...extra }));
  await enquiry(owner, "Advait", { nextFollowUp: today });
  const trial = await enquiry(desk, "Sia");
  await withTenant(T, async (tx) => bookTrial(tx, desk, trial.id, { sessionId: await classOn(evening.id, addDays(today, 1)) }));
  const lost = await enquiry(desk, "Arjun");
  await withTenant(T, (tx) => markLost(tx, desk, lost.id, { reason: "timing" }));
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("the dashboard", () => {
  it("Today, Money, At risk and Pipeline from known data", async () => {
    const d = await withTenant(T, (tx) => dashboardData(tx, owner, { now: noon }));
    expect(d.today).toMatchObject({ held: 3, marked: 1, notMarked: 1, present: { here: 2, marked: 3 } });
    expect(d.money).toMatchObject({ collectedToday: { count: 2, total: 80_000n }, owed: { invoices: 3, owedPaise: 200_000n, overdueFamilies: 1 }, admissions: 4 });
    const earlier = addDays(today, -3) >= `${today.slice(0, 7)}-01`;
    expect(d.money?.thisMonth).toEqual(earlier ? { count: 3, total: 100_000n } : { count: 2, total: 80_000n });
    expect(d.money?.last30?.byDay.map((x) => [x.key, x.totalPaise])).toEqual([
      [addDays(today, -3), 20_000n],
      [today, 80_000n],
    ]);
    expect(d.atRisk).toEqual({ attendance: 1, unpaid: 1 }); // Chetan was absent; Kiran's family owes two
    expect(d.pipeline).toMatchObject({ followUps: 1, month: { received: 3, trialBooked: 1, won: 0, lost: 1 } });
    expect(d.pipeline?.mine.map((e) => e.name)).toEqual(["Advait"]);
  });

  it("each number only for those who may see its list, in their branches", async () => {
    const d = await withTenant(T, (tx) => dashboardData(tx, desk, { now: noon }));
    expect(d.today).toBeUndefined(); // no sessions:read
    expect(Object.keys(d.money ?? {}).sort()).toEqual(["admissions", "dueTomorrow", "overduePaise", "owed"]); // fees, not the day's cash
    expect(d.atRisk).toEqual({ attendance: null, unpaid: 1 });
    const elsewhere = await withTenant(T, (tx) => dashboardData(tx, { ...owner, branchIds: [other] }, { now: noon }));
    expect([elsewhere.today?.held, elsewhere.money?.collectedToday?.count, elsewhere.money?.owed?.invoices, elsewhere.atRisk]).toEqual([0, 0, 0, { attendance: 0, unpaid: 0 }]);
  });

  it("counts the roll, splits today's attendance and flags near-full batches", async () => {
    const batchIds = (await withTenant(T, (tx) => tx.select({ id: batches.id, name: batches.name }).from(batches))).reduce<Record<string, string>>((m, b) => ({ ...m, [b.name]: b.id }), {});
    const setCapacity = (name: string, capacity: number | null) => withTenant(T, (tx) => tx.update(batches).set({ capacity }).where(eq(batches.id, batchIds[name] ?? "")));
    // Early holds 3 of 3 and Evening 0 of 10; Morning declares none.
    await setCapacity("Early", 3);
    await setCapacity("Evening", 10);
    try {
      const d = await withTenant(T, (tx) => dashboardData(tx, owner, { now: noon }));
      expect(d.roll).toEqual({ active: 4, joinedThisMonth: 4, waitingForBatch: 1 }); // Kiran is in no batch
      expect(d.today?.attendance).toEqual({ present: 2, absent: 1, notMarked: 0 }); // Asha and Bina here, Chetan absent
      expect(d.today?.nearCapacity).toBe(1);
      expect(d.money?.overduePaise).toBe(100_000n); // Kiran's 400 + 600
      expect(d.money?.dueTomorrow).toBe(0); // Mehta's invoice is due in five days
    } finally {
      for (const name of ["Early", "Morning", "Evening"]) await setCapacity(name, null);
    }
    const none = await withTenant(T, (tx) => dashboardData(tx, owner, { now: noon }));
    expect(none.today?.nearCapacity).toBe(0); // no capacity declared, none counted

    // Kiran joins Morning, whose class has no marks yet: one on the roster, unmarked.
    const kiran = (await withTenant(T, (tx) => tx.select({ id: students.id }).from(students).where(eq(students.fullName, "Kiran"))))[0]?.id ?? "";
    await withTenant(T, (tx) => enroll(tx, owner, { studentId: kiran, batchId: batchIds["Morning"] ?? "", startDate: today }));
    const after = await withTenant(T, (tx) => dashboardData(tx, owner, { now: noon }));
    expect(after.today?.attendance).toEqual({ present: 2, absent: 1, notMarked: 1 });
    expect(after.roll?.waitingForBatch).toBe(0);
  });

  it("a cancelled class contributes nothing to attendance", async () => {
    const todays = (name: string) => withTenant(T, async (tx) => (await tx.select({ id: sessions.id }).from(sessions).innerJoin(batches, eq(batches.id, sessions.batchId)).where(and(eq(batches.name, name), eq(sessions.sessionDate, today))))[0]?.id ?? "");
    const [morning, early] = [await todays("Morning"), await todays("Early")];
    const cancel = (ids: string[], status: "cancelled" | "scheduled") => withTenant(T, (tx) => setSessionStatus(tx, ids, status, status === "cancelled" ? "test" : null));
    try {
      await cancel([morning], "cancelled"); // Kiran's unmarked class
      expect((await withTenant(T, (tx) => dashboardData(tx, owner, { now: noon }))).today?.attendance).toEqual({ present: 2, absent: 1, notMarked: 0 });
      await cancel([early], "cancelled"); // cancelled after its marks were taken
      const d = await withTenant(T, (tx) => dashboardData(tx, owner, { now: noon }));
      expect(d.today?.attendance).toEqual({ present: 0, absent: 0, notMarked: 0 });
      expect(d.today?.present).toEqual({ here: 0, marked: 0 });
    } finally {
      await cancel([morning, early], "scheduled");
    }
  });

  it("gives a Teacher the roll and the day, but no money, attendance counts or pipeline", async () => {
    const roles = Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r.id]));
    const teacher = await ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `teacher-${stamp}@example.test`, fullName: "Teacher", roleId: roles["Teacher"] ?? "" }))).id);
    const d = await withTenant(T, (tx) => dashboardData(tx, teacher, { now: noon }));
    expect(d.today).toBeDefined();
    expect(d.today?.attendance).toBeUndefined();
    expect(d.today?.present).toBeUndefined();
    expect(d.roll?.active).toBe(4);
    expect([d.money, d.atRisk, d.pipeline]).toEqual([undefined, undefined, undefined]);
  });

  it("builds eight months of history, the trend and the overdue split", async () => {
    const t = await testAcademy({ name: `Hist ${stamp}`, slug: `hist-${stamp}`, verticalPreset: "general", owner: { name: "Owner", email: `hist-${stamp}@example.test` } });
    try {
      const ctx = await (async () => {
        const [base, branchIds] = await withTenant(t.tenant.id, async (tx) => [await loadAccessContext(tx, t.owner.id), await staffBranchIds(tx, t.owner.id)] as const);
        return { ...base, branchIds };
      })();
      const day = await withTenant(t.tenant.id, tenantToday);
      const start = `${day.slice(0, 7)}-01`;
      const house = (await withTenant(t.tenant.id, (tx) => createHousehold(tx, { tenantId: t.tenant.id, name: "Rao family" }))).id;
      const receive = (rupees: number, on: string) =>
        withTenant(t.tenant.id, (tx) => recordPayment(tx, ctx, { requestId: uuidv7(), householdId: house, branchId: t.branch.id, amountPaise: String(rupees * 100), method: "cash" }, { now: localToUtc(on, "11:00", TZ) }));
      const inMonth = (back: number) => `${addMonths(start, -back).slice(0, 7)}-10`;
      await receive(900, inMonth(8)); // before the window
      await receive(100, inMonth(7)); // first month in the window
      await receive(300, inMonth(1));
      await receive(100, inMonth(1));
      await receive(600, day);
      const bill = (rupees: number, due: string) =>
        withTenant(t.tenant.id, async (tx) => {
          const total = BigInt(rupees) * 100n;
          const inv = await insertInvoice(tx, { tenantId: t.tenant.id, branchId: t.branch.id, householdId: house, issueDate: addDays(due, -7), dueDate: due, subtotalPaise: total, totalPaise: total });
          return updateInvoice(tx, inv.id, { number: await allocateNumber(tx, t.tenant.id, "invoice", "2026-27"), fy: "2026-27", status: "issued", issuedAt: new Date() });
        });
      await bill(250, addDays(day, -2));
      await bill(700, addDays(day, 1));

      const d = await withTenant(t.tenant.id, (tx) => dashboardData(tx, ctx, { now: localToUtc(day, "12:00", TZ) }));
      expect(d.money?.byMonth).toEqual([
        { month: addMonths(start, -7).slice(0, 7), count: 1, totalPaise: 10_000n },
        { month: addMonths(start, -1).slice(0, 7), count: 2, totalPaise: 40_000n },
        { month: start.slice(0, 7), count: 1, totalPaise: 60_000n },
      ]);
      expect(d.money?.trendPct).toBe(50); // 600 against last month's 400
      expect(d.money?.overduePaise).toBe(25_000n);
      expect(d.money?.dueTomorrow).toBe(1);
    } finally {
      await deleteTenantsCompletely([t.tenant.id]);
    }
  });
});

describe("an academy with nothing in it", () => {
  it("returns zeros and a null trend, never NaN", async () => {
    const t = await testAcademy({ name: `Empty ${stamp}`, slug: `empty-${stamp}`, verticalPreset: "general", owner: { name: "Owner", email: `empty-${stamp}@example.test` } });
    try {
      const [base, branchIds] = await withTenant(t.tenant.id, async (tx) => [await loadAccessContext(tx, t.owner.id), await staffBranchIds(tx, t.owner.id)] as const);
      const d = await withTenant(t.tenant.id, (tx) => dashboardData(tx, { ...base, branchIds }));
      expect(d.roll).toEqual({ active: 0, joinedThisMonth: 0, waitingForBatch: 0 });
      expect(d.today).toMatchObject({ attendance: { present: 0, absent: 0, notMarked: 0 }, nearCapacity: 0 });
      expect(d.money).toMatchObject({ byMonth: [], trendPct: null, overduePaise: 0n, dueTomorrow: 0 });
    } finally {
      await deleteTenantsCompletely([t.tenant.id]);
    }
  });
});
