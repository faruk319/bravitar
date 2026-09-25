import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { sql as runtimeSql } from "@/lib/db/client";
import { addDays } from "@/lib/dates";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { saveAttendance } from "@/modules/attendance/service";
import { addProgram, createBatch } from "@/modules/batches/service";
import { createEnquiry, markLost } from "@/modules/enquiries/service";
import { bookTrial } from "@/modules/enquiries/trials";
import { enroll } from "@/modules/enrollments/service";
import { insertInvoice, updateInvoice } from "@/modules/fees/repo";
import { allocateNumber } from "@/modules/numbering/repo";
import { recordPayment } from "@/modules/payments/service";
import { ensurePlatformPlans } from "@/modules/platform/repo";
import { localToUtc } from "@/modules/sessions/occurrences";
import { reconcileSessions } from "@/modules/sessions/reconcile";
import { sessions } from "@/modules/sessions/schema";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { createHousehold } from "@/modules/students/repo";
import { createStudent } from "@/modules/students/service";
import { createBranch, tenantToday } from "@/modules/tenancy/repo";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
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
  await withPlatformAdmin({ action: "test.setup", actorType: "system" }, ensurePlatformPlans);
  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Dash ${stamp}`, slug: `dash-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `dash-owner-${stamp}@example.test` } });
  T = t.tenant.id;
  branch = t.branch.id;
  owner = await ctxFor(t.owner.id);
  other = (await withTenant(T, (tx) => createBranch(tx, { tenantId: T, name: "Other" }))).id;
  const roles = Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r.id]));
  desk = await ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `desk-${stamp}@example.test`, fullName: "Desk", roleIds: [roles["Front Desk"] ?? ""] }))).id);
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
    expect(Object.keys(d.money ?? {}).sort()).toEqual(["admissions", "owed"]); // fees, not the day's cash
    expect(d.atRisk).toEqual({ attendance: null, unpaid: 1 });
    const elsewhere = await withTenant(T, (tx) => dashboardData(tx, { ...owner, branchIds: [other] }, { now: noon }));
    expect([elsewhere.today?.held, elsewhere.money?.collectedToday?.count, elsewhere.money?.owed?.invoices, elsewhere.atRisk]).toEqual([0, 0, 0, { attendance: 0, unpaid: 0 }]);
  });
});
