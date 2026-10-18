import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@/lib/ids";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { testAcademy } from "@/lib/db/isolation/academy";
import { withTenant } from "@/lib/db/with-tenant";
import { addProgram, createBatch } from "@/modules/batches/service";
import { enrollments } from "@/modules/enrollments/schema";
import { enroll } from "@/modules/enrollments/service";
import { generateInvoices } from "@/modules/fees/invoicing";
import { insertInvoice } from "@/modules/fees/repo";
import { createDiscount, giveDiscount } from "@/modules/fees/service";
import { invoices } from "@/modules/fees/schema";
import { createPlan, issueInvoices, nextDue } from "@/modules/fees/service";
import { recordPayment } from "@/modules/payments/service";
import { listRoles } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { staffBranchIds } from "@/modules/staff/repo";
import { addFamilyMember } from "./family";
import { studentProfile } from "./profile";
import { removeFamilyLink, updateGuardian, updateStudent } from "./repo";
import { createStudent, type StudentCtx } from "./service";

const stamp = Math.random().toString(36).slice(2, 8);
let T = "";
let branch = "";
let owner: StudentCtx;
let teacher: StudentCtx;
let accountant: StudentCtx;
let batchId = "";
let phones = 0;
const phone = () => `+919${String(300_000_000 + ++phones).padStart(9, "0")}`;
const consents = { dataProcessing: true };

const ctxFor = async (staffId: string): Promise<StudentCtx> =>
  withTenant(T, async (tx) => ({ ...(await loadAccessContext(tx, staffId)), branchIds: await staffBranchIds(tx, staffId) }));

const kid = (fullName: string, relation: "father" | "mother" = "father") =>
  withTenant(T, (tx) => createStudent(tx, owner, { fullName, dateOfBirth: "2015-01-01", guardian: { fullName: `${fullName} Parent`, phone: phone(), relation }, consents }));
const profile = (ctx: StudentCtx, id: string) => withTenant(T, (tx) => studentProfile(tx, ctx, id));

beforeAll(async () => {
  const a = await testAcademy({ name: `Profile ${stamp}`, slug: `prf-${stamp}`, verticalPreset: "karate", owner: { name: "Coach Owner", email: `prf-${stamp}@example.test` } });
  T = a.tenant.id;
  branch = a.branch.id;
  owner = await ctxFor(a.owner.id);
  const roles = await withTenant(T, (tx) => listRoles(tx));
  const staff = (name: string, role: string) =>
    withTenant(T, async (tx) => createStaffMember(tx, owner, { email: `${name}-${stamp}@example.test`, fullName: name, roleId: roles.find((r) => r.name === role)?.id ?? "" }));
  teacher = await ctxFor((await staff("Teach", "Teacher")).id);
  accountant = await ctxFor((await staff("Acct", "Accountant")).id);
  const program = await withTenant(T, (tx) => addProgram(tx, owner, { name: "Karate" }));
  batchId = (await withTenant(T, (tx) => createBatch(tx, owner, { name: "Karate A", programId: program.id, coachId: a.owner.id, slots: [{ weekday: 1, startTime: "17:00", endTime: "18:00" }] }))).id;
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end();
});

describe("blocks follow permissions", () => {
  it("a viewer without invoices:read gets no fee data in the payload", async () => {
    const s = await kid("Tab Kid");
    await withTenant(T, (tx) => enroll(tx, owner, { studentId: s.student.id, batchId }));
    const p = await profile(teacher, s.student.id);
    expect("nextDue" in p).toBe(false);
    expect("fees" in p).toBe(false);
    expect("batches" in p).toBe(false);
    expect("attendance" in p).toBe(false);
    await expect(withTenant(T, (tx) => nextDue(tx, teacher, s.student.id))).rejects.toMatchObject({ status: 403 });
    // Positive control: the same student, seen by the owner, has both.
    const full = await profile(owner, s.student.id);
    expect(full.batches?.current).toHaveLength(1);
    expect(full.attendance?.trend).toHaveLength(6);
    expect(full).toHaveProperty("nextDue");
    expect(full).toHaveProperty("fees");
    expect(full.fees?.discounts).toEqual([]);
  });

  it("an accountant sees fees but not batches", async () => {
    const p = await profile(accountant, (await kid("Acct Kid")).student.id);
    expect(p).toHaveProperty("nextDue");
    expect("batches" in p).toBe(false);
  });

  it("the fees block carries the student's discounts, and only for a viewer with invoices:read", async () => {
    const s = await kid("Disc Kid");
    const d = await withTenant(T, (tx) => createDiscount(tx, owner, { name: "Sibling 10%", kind: "percent", value: 10 }));
    await withTenant(T, (tx) => giveDiscount(tx, owner, s.student.id, { discountId: d.id, reason: "Second child" }));
    expect((await profile(owner, s.student.id)).fees?.discounts.map((g) => [g.name, g.reason])).toEqual([["Sibling 10%", "Second child"]]);
    expect("fees" in (await profile(teacher, s.student.id))).toBe(false);
  });
});

describe("overview data", () => {
  it("lists every guardian with relation and manager, the student's own address, the coach, and the next due date", async () => {
    const a = await kid("Two Guardians");
    await withTenant(T, async (tx) => {
      await addFamilyMember(tx, owner, a.student.id, { fullName: "Second Parent", phone: phone(), relation: "mother" });
      await updateGuardian(tx, a.guardian.id, { email: "dad@example.test" });
      await updateStudent(tx, a.student.id, { address: "12 Lake Road" });
    });
    await withTenant(T, (tx) => enroll(tx, owner, { studentId: a.student.id, batchId }));
    for (const [n, due] of [["I-1", "2026-11-20"], ["I-2", "2026-11-05"]] as const)
      await withTenant(T, (tx) => insertInvoice(tx, { tenantId: T, branchId: branch, studentId: a.student.id, number: n, fy: "2026-27", issuedAt: new Date("2026-10-01T05:00:00Z"), issueDate: "2026-10-01", dueDate: due, subtotalPaise: 50_000n, totalPaise: 50_000n, paidPaise: 0n, status: "issued" }));
    const p = await profile(owner, a.student.id);
    expect(p.guardians.map((g) => [g.relation, g.isManager])).toEqual([["father", true], ["mother", false]]);
    expect(p.guardians[0]?.email).toBe("dad@example.test");
    expect(p.student.address).toBe("12 Lake Road");
    expect(p.batches?.current[0]).toMatchObject({ batchName: "Karate A", programName: "Karate", coachName: "Coach Owner" });
    expect(p.nextDue).toBe("2026-11-05");
  });

  it("a student with no guardian at all resolves every block", async () => {
    const a = await kid("Adult Alone");
    // Positive control: one guardian before the link is removed.
    expect((await profile(owner, a.student.id)).guardians).toHaveLength(1);
    await withTenant(T, (tx) => removeFamilyLink(tx, a.student.id, a.guardian.id, new Date()));
    const p = await profile(owner, a.student.id);
    expect(p.guardians).toEqual([]);
    expect(p.siblings).toEqual([]);
    expect(p.batches).toEqual({ current: [], past: [] });
    expect(p.nextDue).toBeNull();
    expect(p.student.fullName).toBe("Adult Alone");
  });

  it("a removed guardian leaves the card but the student keeps their own history", async () => {
    const a = await kid("Kept History");
    const mum = await withTenant(T, (tx) => addFamilyMember(tx, owner, a.student.id, { fullName: "Mum Gone", phone: phone(), relation: "mother" }));
    await withTenant(T, (tx) => enroll(tx, owner, { studentId: a.student.id, batchId }));
    await withTenant(T, (tx) => insertInvoice(tx, { tenantId: T, branchId: branch, studentId: a.student.id, number: "H-1", fy: "2026-27", issuedAt: new Date("2026-10-01T05:00:00Z"), issueDate: "2026-10-01", dueDate: "2026-11-01", subtotalPaise: 50_000n, totalPaise: 50_000n, paidPaise: 0n, status: "issued" }));
    expect((await profile(owner, a.student.id)).guardians.map((g) => g.id)).toContain(mum.id);
    await withTenant(T, (tx) => removeFamilyLink(tx, a.student.id, mum.id, new Date()));
    const p = await profile(owner, a.student.id);
    expect(p.guardians.map((g) => g.id)).toEqual([a.guardian.id]);
    expect(p.batches?.current).toHaveLength(1);
    expect(p.nextDue).toBe("2026-11-01");
  });
});

describe("the fees card is per payer", () => {
  const month = new Date().toISOString().slice(0, 7);
  const now = new Date(`${month}-01T04:00:00Z`); // the billing day: the invoices fall in this month
  const plan = (name: string, amountPaise: string) => withTenant(T, (tx) => createPlan(tx, owner, { name, kind: "recurring", billingCycle: "monthly", amountPaise }));
  const batchOn = async (name: string, planId: string) => {
    const program = await withTenant(T, (tx) => addProgram(tx, owner, { name: `${name} program` }));
    return (await withTenant(T, (tx) => createBatch(tx, owner, { name, programId: program.id, slots: [{ weekday: 2, startTime: "17:00", endTime: "18:00" }], startDate: `${month}-01`, defaultFeePlanId: planId }))).id;
  };

  it("two enrollments on two payers show two invoices, each under its own bill-to name, with no combined bill", async () => {
    const s = await kid("Split Fees");
    const aunt = await withTenant(T, (tx) => addFamilyMember(tx, owner, s.student.id, { fullName: "Aunt Fees", phone: phone(), relation: "other" }));
    const [karate, dance] = [await batchOn("Fee Karate", (await plan("Fee Karate Plan", "80000")).id), await batchOn("Fee Dance", (await plan("Fee Dance Plan", "100000")).id)];
    const [ek, ed] = [await withTenant(T, (tx) => enroll(tx, owner, { studentId: s.student.id, batchId: karate, startDate: `${month}-01` })), await withTenant(T, (tx) => enroll(tx, owner, { studentId: s.student.id, batchId: dance, startDate: `${month}-01` }))];
    await withTenant(T, async (tx) => {
      await tx.update(enrollments).set({ payerGuardianId: s.guardian.id, payerMemberId: null }).where(eq(enrollments.id, ek.id));
      await tx.update(enrollments).set({ payerGuardianId: aunt.id, payerMemberId: null }).where(eq(enrollments.id, ed.id));
    });
    // Before generating there is nothing to show: the card is empty, not absent.
    expect((await profile(owner, s.student.id)).fees?.invoices).toEqual([]);
    expect(await withTenant(T, (tx) => generateInvoices(tx, { actorType: "system", tenantId: T }, { now, enrollmentIds: [ek.id, ed.id] }))).toMatchObject({ invoices: 2 });
    // Drafts are not bills yet.
    expect((await profile(owner, s.student.id)).fees?.invoices).toEqual([]);
    const all = (await withTenant(T, (tx) => tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.studentId, s.student.id)))).map((r) => r.id);
    await withTenant(T, (tx) => issueInvoices(tx, owner, all, { now }));
    const p = await profile(owner, s.student.id);
    const rows = (p.fees?.invoices ?? []).map((i) => [i.billToName, i.totalPaise]);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([["Split Fees Parent", 80000n], ["Aunt Fees", 100000n]]));
    // A merged bill would be a single 180000 row.
    expect(p.fees?.invoices.some((i) => i.totalPaise === 180000n)).toBe(false);

    // Payment history: the aunt pays her invoice only; the receipt is attributed to it.
    const auntInvoice = p.fees?.invoices.find((i) => i.billToName === "Aunt Fees");
    await withTenant(T, (tx) => recordPayment(tx, owner, { requestId: uuidv7(), memberId: s.student.id, branchId: branch, amountPaise: "100000", payerGuardianId: aunt.id, allocations: [{ invoiceId: auntInvoice?.id ?? "", amountPaise: "100000" }] }, { now }));
    const after = await profile(owner, s.student.id);
    expect(after.fees?.receipts.map((r) => [r.invoiceId, r.net])).toEqual([[auntInvoice?.id, 100000n]]);
    expect(after.fees?.invoices.map((i) => [i.billToName, i.status]).sort()).toEqual([["Aunt Fees", "paid"], ["Split Fees Parent", "issued"]]);
  });
});
