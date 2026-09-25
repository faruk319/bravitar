import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { parseCsv, toCsv } from "@/lib/csv";
import { sql as runtimeSql } from "@/lib/db/client";
import { addDays } from "@/lib/dates";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { insertInvoice, updateInvoice } from "@/modules/fees/repo";
import { allocateNumber } from "@/modules/numbering/repo";
import { cancelPayment, collectionSheet, recordPayment } from "@/modules/payments/service";
import { ensurePlatformPlans } from "@/modules/platform/repo";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { createHousehold } from "@/modules/students/repo";
import { createStudent, setStudentStatus } from "@/modules/students/service";
import { createBranch, tenantToday } from "@/modules/tenancy/repo";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { collectionRows } from "./csv";
import { admissionsReport, collectionRegister, outstandingDues } from "./service";

// docs/03 §11: the collection register (a day's total equals its sheet), dues
// aged by days past the due date (agreed 2026-09-25), admissions and dropouts.

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
  await withPlatformAdmin({ action: "test.setup", actorType: "system" }, ensurePlatformPlans);
  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Reports ${stamp}`, slug: `reports-${stamp}`, owner: { name: "Owner", email: `reports-owner-${stamp}@example.test` } });
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
