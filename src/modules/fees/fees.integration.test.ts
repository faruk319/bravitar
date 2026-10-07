import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { auditLog } from "@/lib/db/audit";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { addDays, todayIn } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { financialYear } from "@/lib/money/fy";
import { roundHalfUp, sum } from "@/lib/money/paise";
import { addProgram, createBatch, editBatch } from "@/modules/batches/service";
import { enrollments } from "@/modules/enrollments/schema";
import { enroll, leaveEnrollment, pauseEnrollment, setEnrollmentPlan, transferEnrollment } from "@/modules/enrollments/service";
import { allocateNumber } from "@/modules/numbering/repo";
import { familyAccount, recordPayment } from "@/modules/payments/service";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { createHousehold } from "@/modules/students/repo";
import { addFamilyMember } from "@/modules/students/family";
import { removeFamilyLink, updateGuardian } from "@/modules/students/repo";
import { createStudent, setStudentStatus } from "@/modules/students/service";
import { createBranch } from "@/modules/tenancy/repo";
import { testAcademy } from "@/lib/db/isolation/academy";
import { addMonths } from "./billing";
import { generateInvoices, resolvePayers } from "./invoicing";
import type { Enrollment } from "@/modules/enrollments/schema";
import { runInvoicesGenerate } from "./job";
import { insertInvoice, linesOf, owedSummary, updateInvoice } from "./repo";
import { type Invoice, invoices } from "./schema";
import { createDiscount, createPlan, endDiscount, generateNow, giveDiscount, installmentsDue, invoiceDetail, invoiceList, issueInvoices, type PlanInput, saveFeeSettings, setPlanActive, studentFees, voidInvoice } from "./service";

const stamp = Math.random().toString(36).slice(2, 8);
const today = todayIn("Asia/Kolkata");
const M0 = `${today.slice(0, 7)}-01`; // this month's billing day, already past
const M1 = addMonths(M0, 1); // next month's, still ahead
const M2 = addMonths(M0, 2);
const at = (day: string) => new Date(`${day}T04:00:00Z`); // 09:30 in India
const monthEndOf = (day: string) => addDays(addMonths(`${day.slice(0, 7)}-01`, 1), -1);
let T = "";
let owner: ScopedCtx;
let desk: ScopedCtx;
let teacher: ScopedCtx;
let phone = 0;
const plan: Record<string, string> = {};
const program: Record<string, string> = {};
const batch: Record<string, string> = {};
const H: Record<string, { ids: string[]; householdId: string; enrollments: string[] }> = {};

const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const family = async (...names: string[]) => {
  const guardianPhone = `+9197${String(10_000_000 + ++phone)}`;
  const ids: string[] = [];
  let householdId = "";
  for (const fullName of names) {
    const r = await withTenant(T, (tx) =>
      createStudent(tx, owner, { fullName, guardian: { fullName: `Parent ${names[0]}`, phone: guardianPhone, relation: "mother" }, consents: { dataProcessing: true }, ...(householdId ? { householdId } : {}) }),
    );
    householdId = r.household.id;
    ids.push(r.student.id);
  }
  return { ids, householdId };
};
const join = async (studentId: string, batchName: string, startDate: string) => (await withTenant(T, (tx) => enroll(tx, owner, { studentId, batchId: batch[batchName] ?? "", startDate }))).id;
const gen = (day: string, enrollmentIds: string[]) => withTenant(T, (tx) => generateInvoices(tx, { actorType: "system", tenantId: T }, { now: at(day), enrollmentIds }));
const invoicesOf = (householdId: string): Promise<Invoice[]> =>
  withTenant(T, (tx) => tx.select().from(invoices).where(eq(invoices.householdId, householdId)).orderBy(asc(invoices.issueDate), asc(invoices.createdAt), asc(invoices.dueDate)));
const linesOn = (invoiceId: string) => withTenant(T, (tx) => linesOf(tx, [invoiceId]));
const summary = async (invoiceId: string) => (await linesOn(invoiceId)).map((l) => [l.studentName, l.kind, l.description, l.unitPaise, l.discountPaise, l.taxPaise]);
const actions = async (id: string) => (await withTenant(T, (tx) => tx.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, id)))).map((r) => r.a).sort();

beforeAll(async () => {
  const t = await testAcademy({ name: `Fees ${stamp}`, slug: `fees-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `fees-owner-${stamp}@example.test` } });
  T = t.tenant.id;
  owner = await ctxFor(t.owner.id);
  const roles = Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r.id]));
  const hire = async (name: string, role: string) => ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `${name}-${stamp}@example.test`, fullName: name, roleId: roles[role] ?? "" }))).id);
  desk = await hire("desk", "Front Desk");
  teacher = await hire("teacher", "Teacher");

  const addP = async (name: string) => (await withTenant(T, (tx) => addProgram(tx, owner, { name }))).id;
  const [karate, dance, class9, swim] = [await addP("Karate"), await addP("Dance"), await addP("Class 9"), await addP("Swimming")];
  program.karate = karate;
  const plans: Record<string, PlanInput> = {
    karate: { name: "Karate Monthly", kind: "recurring", billingCycle: "monthly", amountPaise: "80000", admissionFeePaise: "50000" },
    advanced: { name: "Karate Advanced", kind: "recurring", billingCycle: "monthly", amountPaise: "120000" },
    dance: { name: "Dance Monthly", kind: "recurring", billingCycle: "monthly", amountPaise: "100000", admissionFeePaise: "30000" },
    fitness: { name: "Fitness Monthly", kind: "recurring", billingCycle: "monthly", amountPaise: "100000", taxRateBp: 1800 },
    term: {
      name: "Class 9 Term",
      kind: "term",
      admissionFeePaise: "100000",
      installments: [
        { label: "1st installment", amountPaise: "700000", dueOffsetDays: 0 },
        { label: "2nd installment", amountPaise: "600000", dueOffsetDays: 120 },
        { label: "3rd installment", amountPaise: "500000", dueOffsetDays: 240 },
      ],
    },
    swim: { name: "Swim 10 sessions", kind: "package", amountPaise: "300000" },
  };
  for (const [k, p] of Object.entries(plans)) plan[k] = (await withTenant(T, (tx) => createPlan(tx, owner, p))).id;
  const batches: [string, string, string][] = [
    ["Karate A", karate, "karate"],
    ["Karate B", karate, "karate"],
    ["Karate Adv", karate, "advanced"],
    ["Dance A", dance, "dance"],
    ["Fitness", karate, "fitness"],
    ["Class 9 A", class9, "term"],
    ["Class 9 B", class9, "term"],
    ["Swim", swim, "swim"],
  ];
  for (const [name, programId, p] of batches) {
    batch[name] = (await withTenant(T, (tx) => createBatch(tx, owner, { name, programId, slots: [{ weekday: 1, startTime: "17:00", endTime: "18:00" }], startDate: addMonths(M0, -2), defaultFeePlanId: plan[p] ?? null }))).id;
  }
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("fee plans", () => {
  it("a term fee is the sum of its installments, stored in the docs/04 format; names are unique; bad input is refused", async () => {
    const term = await withTenant(T, (tx) => createPlan(tx, owner, { name: "Class 10 Term", kind: "term", installments: [{ label: "Once", amountPaise: "1500000", dueOffsetDays: 0 }] }));
    expect(term).toMatchObject({ kind: "term", billingCycle: "one_time", amountPaise: 1500000n, metadata: { installments: [{ label: "Once", amount_paise: 1500000, due_offset_days: 0 }] } });
    const bad = (p: PlanInput) => withTenant(T, (tx) => createPlan(tx, owner, p));
    await expect(bad({ name: "Karate Monthly", kind: "recurring", billingCycle: "monthly", amountPaise: "1" })).rejects.toThrow('A plan called "Karate Monthly" already exists');
    await expect(bad({ name: "T", kind: "term", installments: [{ label: "a", amountPaise: "1", dueOffsetDays: 30 }, { label: "b", amountPaise: "1", dueOffsetDays: 30 }] })).rejects.toThrow("fall due after the one before");
    await expect(bad({ name: "R", kind: "recurring", billingCycle: "monthly", amountPaise: "0" })).rejects.toThrow("Enter the fee");
    await expect(withTenant(T, (tx) => createPlan(tx, desk, { name: "X", kind: "one_time", amountPaise: "100" }))).rejects.toMatchObject({ status: 403 });
  });
});

describe("generating invoices", () => {
  it("two children in different programs: an invoice each, the sibling discount with its reason; totals reconcile", async () => {
    const f = await family("Riya", "Kabir");
    const [riya = "", kabir = ""] = f.ids;
    const sibling = await withTenant(T, (tx) => createDiscount(tx, owner, { name: "Sibling 10%", kind: "percent", value: 10 }));
    const given = await withTenant(T, (tx) => giveDiscount(tx, owner, kabir, { discountId: sibling.id, reason: "Second child", validFrom: M0 }));
    // Joined on this month's billing day, so next month is a plain cycle (admission rode on the first).
    const enrollments = [await join(riya, "Karate A", M0), await join(kabir, "Dance A", M0)];
    H.siblings = { ...f, enrollments };

    expect(await gen(M1, enrollments)).toEqual({ invoices: 2, lines: 2, skipped: [] });
    const all = await invoicesOf(f.householdId);
    expect(all.map((i) => i.studentId).sort()).toEqual([riya, kabir].sort());
    const [forRiya, forKabir] = [riya, kabir].map((id) => all.find((i) => i.studentId === id));
    for (const inv of [forRiya, forKabir]) expect(inv).toMatchObject({ status: "draft", number: null, fy: null, issueDate: M1, dueDate: addDays(M1, 7), periodStart: M1, periodEnd: monthEndOf(M1) });
    expect(forRiya).toMatchObject({ subtotalPaise: 80000n, discountPaise: 0n, taxPaise: 0n, totalPaise: 80000n });
    expect(forKabir).toMatchObject({ subtotalPaise: 100000n, discountPaise: 10000n, taxPaise: 0n, totalPaise: 90000n });
    expect((await linesOn(forRiya?.id ?? "")).map((l) => [l.studentName, l.description, l.unitPaise, l.discountPaise, l.discountNote, l.amountPaise])).toEqual([["Riya", "Karate Monthly", 80000n, 0n, null, 80000n]]);
    expect((await linesOn(forKabir?.id ?? "")).map((l) => [l.studentName, l.description, l.unitPaise, l.discountPaise, l.discountNote, l.amountPaise])).toEqual([
      ["Kabir", "Dance Monthly", 100000n, 10000n, "Sibling 10% — Second child", 90000n],
    ]);
    expect(sum(all.map((i) => i.totalPaise))).toBe(170000n); // what one family invoice used to total
    expect(await actions(given.id)).toEqual(["discount.give"]);
  });

  it("running again, or the nightly job, bills nothing twice", async () => {
    const { householdId, enrollments } = H.siblings ?? { householdId: "", enrollments: [] };
    expect(await gen(M1, enrollments)).toEqual({ invoices: 0, lines: 0, skipped: [] });
    expect(await runInvoicesGenerate({ now: at(M1), tenantIds: [T] })).toEqual({ tenants: 1, ok: 1, failed: [] });
    const all = await invoicesOf(householdId);
    expect(all).toHaveLength(2);
    for (const i of all) expect(await linesOn(i.id)).toHaveLength(1);
  });

  it("void and redo: the draft is voided without a number and drafted again", async () => {
    const { householdId, enrollments } = H.siblings ?? { householdId: "", enrollments: [] };
    const old = (await invoicesOf(householdId)).find((i) => i.totalPaise === 90000n);
    await withTenant(T, (tx) => voidInvoice(tx, owner, old?.id ?? "", { reason: "Redo after fee check", rebill: true }, { now: at(M1) }));
    const all = await invoicesOf(householdId);
    const voided = all.find((i) => i.id === old?.id);
    const fresh = all.find((i) => i.status === "draft" && i.studentId === old?.studentId);
    expect(all).toHaveLength(3);
    expect(voided).toMatchObject({ status: "void", number: null, voidReason: "Redo after fee check" });
    expect(fresh).toMatchObject({ status: "draft", totalPaise: 90000n });
    expect((await linesOn(voided?.id ?? "")).map((l) => l.billingKey)).toEqual([null]);
    expect(await gen(M1, enrollments)).toEqual({ invoices: 0, lines: 0, skipped: [] });
  });

  it("issuing numbers drafts oldest first, inside the transaction; Front Desk can look but not issue", async () => {
    const { householdId } = H.siblings ?? { householdId: "" };
    const first = (await invoicesOf(householdId)).find((i) => i.status === "draft");
    const g = await family("Gauri");
    const e = await join(g.ids[0] ?? "", "Karate B", M0);
    H.gauri = { ...g, enrollments: [e] };
    await gen(M1, [e]);
    const [second] = await invoicesOf(g.householdId);

    expect((await withTenant(T, (tx) => invoiceList(tx, desk, "draft"))).invoices.map((i) => i.id)).toEqual(expect.arrayContaining([first?.id, second?.id]));
    await expect(withTenant(T, (tx) => issueInvoices(tx, desk, "all"))).rejects.toMatchObject({ status: 403 });

    const day = addDays(M1, 1);
    const fy = financialYear(day);
    const issued = await withTenant(T, (tx) => issueInvoices(tx, owner, [second?.id ?? "", first?.id ?? ""], { now: at(day) }));
    expect(issued.map((i) => [i.id, i.number, i.status, i.issueDate, i.dueDate])).toEqual([
      [first?.id, `INV/${fy}/0001`, "issued", day, addDays(M1, 7)],
      [second?.id, `INV/${fy}/0002`, "issued", day, addDays(M1, 7)],
    ]);
    expect(await actions(first?.id ?? "")).toEqual(["invoice.issue"]);
  });

  it("a voided invoice keeps its number, is never owed again, and its charges stay billed", async () => {
    const { householdId, enrollments } = H.gauri ?? { householdId: "", enrollments: [] };
    const [inv] = await invoicesOf(householdId);
    await expect(withTenant(T, (tx) => voidInvoice(tx, owner, inv?.id ?? "", { reason: "" }))).rejects.toThrow();
    await withTenant(T, (tx) => voidInvoice(tx, owner, inv?.id ?? "", { reason: "Paid in cash before the app" }));
    const late = { now: at(addDays(M1, 40)) };
    const view = async (v: "unpaid" | "overdue" | "void") => (await withTenant(T, (tx) => invoiceList(tx, owner, v, late))).invoices.map((i) => i.id);
    expect(await view("unpaid")).not.toContain(inv?.id);
    expect(await view("overdue")).not.toContain(inv?.id);
    expect(await view("void")).toContain(inv?.id);
    expect((await invoicesOf(householdId))[0]).toMatchObject({ status: "void", number: inv?.number });
    expect(await gen(M1, enrollments)).toEqual({ invoices: 0, lines: 0, skipped: [] });
    await expect(withTenant(T, (tx) => voidInvoice(tx, owner, inv?.id ?? "", { reason: "Again" }))).rejects.toThrow("Already void");

    const siblings = (await invoicesOf(H.siblings?.householdId ?? "")).find((i) => i.status === "issued");
    expect(await view("overdue")).toContain(siblings?.id); // due date passed: overdue, worked out on read
  });

  it("mid-cycle joiners pay the full cycle by default, or by days; admission comes once per program, on the first invoice", async () => {
    const joinDay = addDays(M1, 15);
    const [anya, dev] = [await family("Anya"), await family("Dev")];
    const ea = await join(anya.ids[0] ?? "", "Karate A", joinDay);
    await gen(joinDay, [ea]);
    const [fullInv] = await invoicesOf(anya.householdId);
    expect(await summary(fullInv?.id ?? "")).toEqual([
      ["Anya", "tuition", "Karate Monthly", 80000n, 0n, 0n],
      ["Anya", "admission", "Admission · Karate", 50000n, 0n, 0n],
    ]);
    expect(fullInv).toMatchObject({ issueDate: joinDay, periodStart: joinDay, periodEnd: monthEndOf(M1), totalPaise: 130000n });

    await withTenant(T, (tx) => saveFeeSettings(tx, owner, { proration: "daily" }));
    const ed = await join(dev.ids[0] ?? "", "Karate A", joinDay);
    await gen(joinDay, [ed]);
    const [byDays] = await invoicesOf(dev.householdId);
    const monthDays = Number((Date.parse(addMonths(M1, 1)) - Date.parse(M1)) / 86_400_000);
    expect(await summary(byDays?.id ?? "")).toEqual([
      ["Dev", "tuition", "Karate Monthly (part)", roundHalfUp(80000n * BigInt(monthDays - 15), BigInt(monthDays)), 0n, 0n],
      ["Dev", "admission", "Admission · Karate", 50000n, 0n, 0n],
    ]);
    await withTenant(T, (tx) => saveFeeSettings(tx, owner, { proration: "full" }));

    // A second karate batch: no admission. A first dance batch: dance admission.
    const eb = await join(anya.ids[0] ?? "", "Karate B", M2);
    const ec = await join(anya.ids[0] ?? "", "Dance A", M2);
    expect(await gen(M2, [ea, eb, ec])).toEqual({ invoices: 1, lines: 4, skipped: [] });
    const next = (await invoicesOf(anya.householdId)).find((i) => i.issueDate === M2);
    expect((await summary(next?.id ?? "")).map((l) => l[2]).sort()).toEqual(["Admission · Dance", "Dance Monthly", "Karate Monthly", "Karate Monthly"]);
  });

  it("GST lines only when the academy has a GSTIN", async () => {
    const f = await family("Gita");
    const e = await join(f.ids[0] ?? "", "Fitness", M1);
    await gen(M1, [e]);
    await expect(withTenant(T, (tx) => saveFeeSettings(tx, owner, { gstin: "27ABCDE1234" }))).rejects.toThrow("15 characters");
    await withTenant(T, (tx) => saveFeeSettings(tx, owner, { gstin: "27abcde1234f1z5" }));
    await gen(M2, [e]);
    await withTenant(T, (tx) => saveFeeSettings(tx, owner, { gstin: null }));
    const [before, after] = await invoicesOf(f.householdId);
    expect(before).toMatchObject({ taxPaise: 0n, totalPaise: 100000n });
    expect(after).toMatchObject({ taxPaise: 18000n, totalPaise: 118000n });
    const detail = await withTenant(T, (tx) => invoiceDetail(tx, owner, after?.id ?? ""));
    expect(detail.lines[0]).toMatchObject({ taxPaise: 18000n, amountPaise: 100000n });
  });

  it("a term plan: one invoice per installment due by offset, admission on the first; moving to a batch on the same plan bills nothing new", async () => {
    const f = await family("Meera");
    const e = await join(f.ids[0] ?? "", "Class 9 A", M1);
    expect(await gen(M1, [e])).toEqual({ invoices: 3, lines: 4, skipped: [] });
    const all = await invoicesOf(f.householdId);
    expect(all.map((i) => [i.studentId, i.dueDate, i.totalPaise])).toEqual([
      [f.ids[0], M1, 800000n],
      [f.ids[0], addDays(M1, 120), 600000n],
      [f.ids[0], addDays(M1, 240), 500000n],
    ]);
    expect((await summary(all[0]?.id ?? "")).map((l) => l[2])).toEqual(["1st installment · Class 9 Term", "Admission · Class 9"]);

    const moved = await withTenant(T, (tx) => transferEnrollment(tx, owner, e, { batchId: batch["Class 9 B"] ?? "", date: addDays(M1, 10) }));
    expect(await gen(addDays(M1, 10), [e, moved.id])).toEqual({ invoices: 0, lines: 0, skipped: [] });
    expect(await invoicesOf(f.householdId)).toHaveLength(3);
  });

  it("paused students and package plans (V2) get nothing", async () => {
    const [p, s] = [await family("Ishaan"), await family("Tara")];
    const ep = await join(p.ids[0] ?? "", "Karate A", M0);
    await withTenant(T, (tx) => pauseEnrollment(tx, owner, ep));
    const es = await join(s.ids[0] ?? "", "Swim", M1);
    expect(await gen(M1, [ep, es])).toEqual({ invoices: 0, lines: 0, skipped: [] });
  });
});

describe("leaving and moving", () => {
  it("leaving one of a member's two batches voids their invoice and drafts it again without that line; a sibling's invoice is untouched", async () => {
    const f = await family("Zoya", "Zaid");
    const [zoyaKarate, zoyaDance, zaid] = [await join(f.ids[0] ?? "", "Karate A", addMonths(M0, -1)), await join(f.ids[0] ?? "", "Dance A", addMonths(M0, -1)), await join(f.ids[1] ?? "", "Karate A", addMonths(M0, -1))];
    expect(await gen(M0, [zoyaKarate, zoyaDance, zaid])).toEqual({ invoices: 2, lines: 3, skipped: [] });
    const zoyasId = (await invoicesOf(f.householdId)).find((i) => i.studentId === f.ids[0])?.id ?? "";
    const zaids = (await invoicesOf(f.householdId)).find((i) => i.studentId === f.ids[1]);
    const [inv] = await withTenant(T, async (tx) => issueInvoices(tx, owner, [zoyasId], { now: at(M0) }));

    await withTenant(T, (tx) => leaveEnrollment(tx, owner, zoyaKarate, { date: addDays(M0, -1) }));
    const all = await invoicesOf(f.householdId);
    const voided = all.find((i) => i.id === inv?.id);
    const redraft = all.find((i) => i.status === "draft" && i.studentId === f.ids[0]);
    expect(all).toHaveLength(3);
    expect(voided).toMatchObject({ status: "void", number: inv?.number });
    expect(voided?.voidReason).toMatch(/^Zoya left Karate A, last day /);
    expect(redraft).toMatchObject({ status: "draft", totalPaise: 100000n });
    expect((await summary(redraft?.id ?? "")).map((l) => [l[0], l[2]])).toEqual([["Zoya", "Dance Monthly"]]);
    expect(all.find((i) => i.id === zaids?.id)).toMatchObject({ status: "draft", totalPaise: 80000n });
  });

  it("leaving voids a paid invoice all the same: its money becomes the family's advance and pays the redraft when that is issued", async () => {
    const f = await family("Meera");
    const [karate, dance] = [await join(f.ids[0] ?? "", "Karate A", addMonths(M0, -1)), await join(f.ids[0] ?? "", "Dance A", addMonths(M0, -1))];
    expect(await gen(M0, [karate, dance])).toEqual({ invoices: 1, lines: 2, skipped: [] });
    const [inv] = await withTenant(T, async (tx) => issueInvoices(tx, owner, [(await invoicesOf(f.householdId))[0]?.id ?? ""], { now: at(M0) }));
    const branchId = inv?.branchId ?? "";
    await withTenant(T, (tx) => recordPayment(tx, owner, { requestId: uuidv7(), householdId: f.householdId, branchId, amountPaise: "180000" }));
    expect((await invoicesOf(f.householdId))[0]).toMatchObject({ status: "paid", paidPaise: 180000n });
    const advance = async () => (await withTenant(T, (tx) => familyAccount(tx, owner, f.householdId, branchId))).advancePaise;

    await withTenant(T, (tx) => leaveEnrollment(tx, owner, karate, { date: addDays(M0, -1) }));
    const [voided, redraft] = await invoicesOf(f.householdId);
    expect(voided).toMatchObject({ id: inv?.id, status: "void", paidPaise: 0n, number: inv?.number });
    expect(redraft).toMatchObject({ status: "draft", totalPaise: 100000n });
    expect((await summary(redraft?.id ?? "")).map((l) => l[0])).toEqual(["Meera"]);
    expect(await advance()).toBe(180000n);
    expect(await actions(inv?.id ?? "")).toEqual(expect.arrayContaining(["invoice.void", "payment.release"]));

    await withTenant(T, (tx) => issueInvoices(tx, owner, [redraft?.id ?? ""]));
    expect((await invoicesOf(f.householdId))[1]).toMatchObject({ id: redraft?.id, status: "paid", paidPaise: 100000n });
    expect(await advance()).toBe(80000n);
  });

  it("a term student who leaves after paying installment 1 keeps 2 and 3 issued and unchanged; the leave screen lists both as voidable", async () => {
    const f = await family("Tanvi");
    const student = f.ids[0] ?? "";
    const e = await join(student, "Class 9 A", M0);
    await gen(M0, [e]);
    await withTenant(T, async (tx) => issueInvoices(tx, owner, (await invoicesOf(f.householdId)).map((i) => i.id), { now: at(M0) }));
    const [first, second, third] = await invoicesOf(f.householdId);
    // Installment 1 paid in full.
    const full = String(first?.totalPaise ?? 0n);
    await withTenant(T, (tx) =>
      recordPayment(tx, owner, { requestId: uuidv7(), householdId: f.householdId, branchId: first?.branchId ?? "", amountPaise: full, allocations: [{ invoiceId: first?.id ?? "", amountPaise: full }] }),
    );
    const snapshot = async () => Promise.all([second, third].map(async (i) => ({ invoice: (await withTenant(T, (tx) => tx.select().from(invoices).where(eq(invoices.id, i?.id ?? ""))))[0], lines: await linesOn(i?.id ?? "") })));
    const before = await snapshot();

    await withTenant(T, (tx) => setStudentStatus(tx, owner, student, { status: "left", reason: "completed" }));

    expect(await snapshot()).toEqual(before);
    expect(before.map((b) => b.invoice?.status)).toEqual(["issued", "issued"]);
    expect((await invoicesOf(f.householdId)).map((i) => i.status)).toEqual(["paid", "issued", "issued"]);
    expect((await withTenant(T, (tx) => invoiceList(tx, owner, "unpaid"))).invoices.map((i) => i.id)).toEqual(expect.arrayContaining([second?.id, third?.id]));
    const due = await withTenant(T, (tx) => installmentsDue(tx, owner, student));
    expect(due.map((d) => [d.invoiceId, d.description, d.voidable])).toEqual([
      [second?.id, "2nd installment · Class 9 Term", true],
      [third?.id, "3rd installment · Class 9 Term", true],
    ]);
  });

  it("a student marked as left loses their invoices for later cycles", async () => {
    const f = await family("Omar");
    const e = await join(f.ids[0] ?? "", "Karate A", M0);
    await gen(M1, [e]);
    await withTenant(T, (tx) => setStudentStatus(tx, owner, f.ids[0] ?? "", { status: "left", reason: "moved_away" }));
    expect((await invoicesOf(f.householdId)).map((i) => i.status)).toEqual(["void"]);
  });

  it("a batch move mid-cycle doesn't double-bill: the old cycle stands, the new plan starts next cycle", async () => {
    const f = await family("Kiara");
    const e = await join(f.ids[0] ?? "", "Karate A", addMonths(M0, -1));
    await gen(M0, [e]);
    const moved = await withTenant(T, (tx) => transferEnrollment(tx, owner, e, { batchId: batch["Karate Adv"] ?? "", date: addDays(M0, 10) }));
    expect(await gen(addDays(M0, 10), [e, moved.id])).toEqual({ invoices: 0, lines: 0, skipped: [] });
    await gen(M1, [e, moved.id]);
    const all = await invoicesOf(f.householdId);
    expect(await Promise.all(all.map(async (i) => [i.status, i.issueDate, (await summary(i.id)).map((l) => [l[2], l[3]])]))).toEqual([
      ["draft", M0, [["Karate Monthly", 80000n]]],
      ["draft", M1, [["Karate Advanced", 120000n]]],
    ]);
  });
});

describe("who can do what", () => {
  it("Teacher sees no fees; Front Desk reads but can't issue, void, discount or generate", async () => {
    const { ids } = await family("Nia");
    await expect(withTenant(T, (tx) => invoiceList(tx, teacher, "unpaid"))).rejects.toMatchObject({ status: 403 });
    await expect(withTenant(T, (tx) => studentFees(tx, desk, ids[0] ?? ""))).resolves.toMatchObject({ invoices: [] });
    const d = await withTenant(T, (tx) => createDiscount(tx, owner, { name: "Staff child", kind: "amount", value: 20000 }));
    await expect(withTenant(T, (tx) => giveDiscount(tx, desk, ids[0] ?? "", { discountId: d.id, reason: "Coach's son" }))).rejects.toMatchObject({ status: 403 });
    await expect(withTenant(T, (tx) => generateNow(tx, desk))).rejects.toMatchObject({ status: 403 });
    const [any] = await withTenant(T, (tx) => tx.select().from(invoices).where(inArray(invoices.status, ["issued"])).limit(1));
    await expect(withTenant(T, (tx) => voidInvoice(tx, desk, any?.id ?? "", { reason: "Nope" }))).rejects.toMatchObject({ status: 403 });
  });

  it("the student's fees show each discount with its reason; ending one stops it from today", async () => {
    const kabir = H.siblings?.ids[1] ?? "";
    const fees = await withTenant(T, (tx) => studentFees(tx, owner, kabir));
    expect(fees.discounts.map((d) => [d.name, d.reason, d.approvedByName, d.validTo])).toEqual([["Sibling 10%", "Second child", "Owner", null]]);
    expect(fees.invoices.length).toBeGreaterThan(0);
    const id = fees.discounts[0]?.id ?? "";
    await withTenant(T, (tx) => endDiscount(tx, owner, id));
    expect((await withTenant(T, (tx) => studentFees(tx, owner, kabir))).discounts[0]?.validTo).toBe(addDays(today, -1));
    await expect(withTenant(T, (tx) => endDiscount(tx, owner, id))).rejects.toThrow("Already ended");
  });
});

describe("a student's plan", () => {
  const planOf = async (id: string) => (await withTenant(T, (tx) => tx.select({ p: enrollments.feePlanId }).from(enrollments).where(eq(enrollments.id, id))))[0]?.p ?? null;

  it("comes from the batch, can be changed per student, and a batch's plan can go to students already in it", async () => {
    const [p, q] = [await family("Pia"), await family("Qadir")];
    const open = (await withTenant(T, (tx) => createBatch(tx, owner, { name: "Open Mat", programId: program.karate ?? "", slots: [{ weekday: 2, startTime: "07:00", endTime: "08:00" }], startDate: addMonths(M0, -2) }))).id;
    batch["Open Mat"] = open;
    const [ep, eq2] = [await join(p.ids[0] ?? "", "Open Mat", M0), await join(q.ids[0] ?? "", "Open Mat", M0)];
    expect(await planOf(ep)).toBeNull();

    await withTenant(T, (tx) => setEnrollmentPlan(tx, owner, eq2, { feePlanId: plan.dance ?? null }));
    await expect(withTenant(T, (tx) => setEnrollmentPlan(tx, teacher, ep, { feePlanId: plan.karate ?? null }))).rejects.toMatchObject({ status: 403 });
    await withTenant(T, (tx) => editBatch(tx, owner, open, { defaultFeePlanId: plan.karate ?? null, applyPlanToCurrent: true }));
    expect([await planOf(ep), await planOf(eq2)]).toEqual([plan.karate, plan.dance]); // only the one without a plan

    await withTenant(T, (tx) => setPlanActive(tx, owner, plan.advanced ?? "", false));
    await expect(withTenant(T, (tx) => setEnrollmentPlan(tx, owner, ep, { feePlanId: plan.advanced ?? null }))).rejects.toThrow("Fee plan not found");
    expect(await planOf(await join(q.ids[0] ?? "", "Karate Adv", M1))).toBeNull(); // an archived batch plan isn't handed out
  });
});

describe("the owed summary", () => {
  let branch = "";
  let empty = "";
  let families = 0;

  // An issued invoice for a family of its own, due on `due`, with `paid` rupees already on it.
  const bill = (branchId: string, rupees: number, due: string, paid = 0) =>
    withTenant(T, async (tx) => {
      const household = await createHousehold(tx, { tenantId: T, name: `Dues family ${++families}` });
      const total = BigInt(rupees) * 100n;
      const inv = await insertInvoice(tx, { tenantId: T, branchId, householdId: household.id, issueDate: addDays(due, -7), dueDate: due, subtotalPaise: total, totalPaise: total });
      const fy = financialYear(today);
      return updateInvoice(tx, inv.id, { number: await allocateNumber(tx, T, "invoice", fy), fy, status: paid ? "part_paid" : "issued", paidPaise: BigInt(paid) * 100n, issuedAt: new Date() });
    });

  beforeAll(async () => {
    // Fresh branches, so nothing else in the academy leaks into these figures.
    branch = (await withTenant(T, (tx) => createBranch(tx, { tenantId: T, name: "Dues branch" }))).id;
    empty = (await withTenant(T, (tx) => createBranch(tx, { tenantId: T, name: "Empty branch" }))).id;
    await bill(branch, 1000, addDays(today, -3), 250); // overdue, with ₹750 still owed
    await bill(branch, 300, today); // due today is not overdue yet
    await bill(branch, 100, today); // two of them, so counting today as tomorrow would show
    await bill(branch, 500, addDays(today, 1)); // the one due tomorrow
    await bill(branch, 2000, addDays(today, 2));
  });

  it("totals what is owed and what is overdue, and counts the invoices due tomorrow", async () => {
    expect(await withTenant(T, (tx) => owedSummary(tx, [branch], today))).toEqual({
      invoices: 5,
      owedPaise: 365_000n, // 750 + 300 + 100 + 500 + 2,000 rupees
      overdueFamilies: 1,
      overduePaise: 75_000n, // only the overdue invoice, and only what is left on it
      dueTomorrow: 1,
    });
  });

  it("is all zeroes for a branch with nothing owed", async () => {
    expect(await withTenant(T, (tx) => owedSummary(tx, [empty], today))).toEqual({ invoices: 0, owedPaise: 0n, overdueFamilies: 0, overduePaise: 0n, dueTomorrow: 0 });
  });
});

describe("an invoice carries its payer and the name it was issued with", () => {
  const phoneNo = () => `+9197${String(20_000_000 + ++phone)}`;
  const one = (fullName: string, guardianName: string) =>
    withTenant(T, (tx) => createStudent(tx, owner, { fullName, guardian: { fullName: guardianName, phone: phoneNo(), relation: "mother" }, consents: { dataProcessing: true } }));
  const setPayer = (enrollmentId: string, guardianId: string) => withTenant(T, (tx) => tx.update(enrollments).set({ payerGuardianId: guardianId, payerMemberId: null }).where(eq(enrollments.id, enrollmentId)));
  const issue = (id: string, day: string) => withTenant(T, (tx) => issueInvoices(tx, owner, [id], { now: at(day) }));
  const listed = async (id: string) => (await withTenant(T, (tx) => invoiceList(tx, owner, "unpaid", { now: at(M1) }))).invoices.find((i) => i.id === id);

  it("the enrollment's payer lands on the invoice, with household_id still written, and its name is the bill-to", async () => {
    const s = await one("Payer Kid", "Mother Payer");
    const aunt = await withTenant(T, (tx) => addFamilyMember(tx, owner, s.student.id, { fullName: "Aunt Payer", phone: phoneNo(), relation: "other" }));
    const e = await join(s.student.id, "Karate A", M0);
    await setPayer(e, aunt.id);
    await gen(M1, [e]);
    const [inv] = await invoicesOf(s.household.id);
    // Would be Mother Payer (the manager fallback) if the enrollment's payer were ignored.
    expect(inv).toMatchObject({ payerGuardianId: aunt.id, payerMemberId: null, billToName: "Aunt Payer", householdId: s.household.id });
  });

  it("an enrollment with no payer is billed to the member's manager guardian", async () => {
    const s = await one("Fallback Kid", "Mother Fallback");
    const e = await join(s.student.id, "Karate A", M0);
    expect(await gen(M1, [e])).toMatchObject({ invoices: 1, skipped: [] });
    expect((await invoicesOf(s.household.id))[0]).toMatchObject({ payerGuardianId: s.guardian.id, billToName: "Mother Fallback" });
  });

  it("a member with no guardian at all (a gym) is billed with themselves as payer", async () => {
    const adult = await one("Gym Adult", "Soon Gone");
    const fine = await one("Fine Kid", "Mother Fine");
    const [ea, ef] = [await join(adult.student.id, "Karate A", M0), await join(fine.student.id, "Karate A", M0)];
    await withTenant(T, (tx) => removeFamilyLink(tx, adult.student.id, adult.guardian.id, new Date()));
    // Fails if the member were skipped (invoices 1, skipped 1) or billed to the removed guardian.
    expect(await gen(M1, [ea, ef])).toEqual({ invoices: 2, lines: 2, skipped: [] });
    expect((await invoicesOf(adult.household.id))[0]).toMatchObject({ payerGuardianId: null, payerMemberId: adult.student.id, billToName: "Gym Adult" });
    expect((await invoicesOf(fine.household.id))[0]?.billToName).toBe("Mother Fine");
  });

  it("a member whose two batches have different payers gets two invoices, one per payer, each with its own lines and bill-to name", async () => {
    const s = await one("Split Kid", "Mother Split");
    const aunt = await withTenant(T, (tx) => addFamilyMember(tx, owner, s.student.id, { fullName: "Aunt Split", phone: phoneNo(), relation: "other" }));
    const [karate, dance] = [await join(s.student.id, "Karate A", M0), await join(s.student.id, "Dance A", M0)];
    await setPayer(karate, s.guardian.id);
    await setPayer(dance, aunt.id);
    // One invoice (lines 2) would mean a payer was silently dropped.
    expect(await gen(M1, [karate, dance])).toEqual({ invoices: 2, lines: 2, skipped: [] });
    const all = await invoicesOf(s.household.id);
    const [byMother, byAunt] = [all.find((i) => i.payerGuardianId === s.guardian.id), all.find((i) => i.payerGuardianId === aunt.id)];
    expect(all).toHaveLength(2);
    expect(byMother).toMatchObject({ studentId: s.student.id, billToName: "Mother Split", totalPaise: 80000n });
    expect(byAunt).toMatchObject({ studentId: s.student.id, billToName: "Aunt Split", totalPaise: 100000n });
    expect((await linesOn(byMother?.id ?? "")).map((l) => [l.enrollmentId, l.description])).toEqual([[karate, "Karate Monthly"]]);
    expect((await linesOn(byAunt?.id ?? "")).map((l) => [l.enrollmentId, l.description])).toEqual([[dance, "Dance Monthly"]]);
    expect(await gen(M1, [karate, dance])).toEqual({ invoices: 0, lines: 0, skipped: [] });
  });

  it("three siblings with the same payer get an invoice each, never one combined, in one run or across runs", async () => {
    const a = await one("Sib One", "Mother Sibs");
    const b = await withTenant(T, (tx) => createStudent(tx, owner, { fullName: "Sib Two", guardian: { fullName: "Mother Sibs", phone: a.guardian.phone, relation: "mother" }, householdId: a.household.id, consents: { dataProcessing: true } }));
    expect(b.guardian.id).toBe(a.guardian.id);
    const c = await withTenant(T, (tx) => createStudent(tx, owner, { fullName: "Sib Three", guardian: { fullName: "Mother Sibs", phone: a.guardian.phone, relation: "mother" }, householdId: a.household.id, consents: { dataProcessing: true } }));
    const [ea, eb, ec] = [await join(a.student.id, "Karate A", M0), await join(b.student.id, "Karate A", M0), await join(c.student.id, "Karate A", M0)];
    for (const e of [ea, eb, ec]) await setPayer(e, a.guardian.id);
    expect(await gen(M1, [ea])).toEqual({ invoices: 1, lines: 1, skipped: [] });
    // Fails as invoices 1, lines 2 if siblings in one run shared a group, or as lines 1 if a later run appended to the first sibling's draft.
    expect(await gen(M1, [eb, ec])).toEqual({ invoices: 2, lines: 2, skipped: [] });
    const all = await invoicesOf(a.household.id);
    expect(all.map((i) => [i.studentId, i.payerGuardianId, i.billToName, i.totalPaise]).sort()).toEqual(
      [
        [a.student.id, a.guardian.id, "Mother Sibs", 80000n],
        [b.student.id, a.guardian.id, "Mother Sibs", 80000n],
        [c.student.id, a.guardian.id, "Mother Sibs", 80000n],
      ].sort(),
    );
  });

  it("an enrollment with both payer columns set is skipped on its own; the others still get a payer", () => {
    const bad = { id: "e1", studentId: "s1", payerGuardianId: "g", payerMemberId: "m" } as Enrollment;
    const ok = { id: "e2", studentId: "s2", payerGuardianId: null, payerMemberId: null } as Enrollment;
    const r = resolvePayers([bad, ok], new Map([["s2", "g2"]]));
    // Fails if the throw escaped (nobody resolved) or the bad row were billed to one side.
    expect(r.corrupt).toEqual([bad]);
    expect([...r.payers]).toEqual([["e2", { kind: "guardian", guardianId: "g2" }]]);
  });

  it("issuing freezes the bill-to name: a rename before issue is picked up, a rename after is not", async () => {
    const s = await one("Frozen Kid", "Mother Before");
    const e = await join(s.student.id, "Karate A", M0);
    await gen(M1, [e]);
    const [draft] = await invoicesOf(s.household.id);
    expect(draft?.billToName).toBe("Mother Before");
    await withTenant(T, (tx) => updateGuardian(tx, s.guardian.id, { fullName: "Mother Issue" }));
    const [issued] = await issue(draft?.id ?? "", M1);
    expect(issued?.billToName).toBe("Mother Issue");
    await withTenant(T, (tx) => updateGuardian(tx, s.guardian.id, { fullName: "Mother Later" }));
    // A live read would show Mother Later (or the household's name).
    expect((await listed(issued?.id ?? ""))?.householdName).toBe("Mother Issue");
    expect((await withTenant(T, (tx) => invoiceDetail(tx, owner, issued?.id ?? "", { now: at(M1) }))).householdName).toBe("Mother Issue");
  });

  it("a guardian left with no members, even a deleted one, leaves their invoices readable under the name they were issued with", async () => {
    const s = await one("Gone Kid", "Mother Gone");
    const e = await join(s.student.id, "Karate A", M0);
    await gen(M1, [e]);
    const [inv] = await issue((await invoicesOf(s.household.id))[0]?.id ?? "", M1);
    await withTenant(T, (tx) => removeFamilyLink(tx, s.student.id, s.guardian.id, new Date()));
    await withTenant(T, (tx) => updateGuardian(tx, s.guardian.id, { fullName: "Renamed Away", deletedAt: new Date() }));
    expect((await listed(inv?.id ?? ""))?.householdName).toBe("Mother Gone");
    expect((await withTenant(T, (tx) => invoiceDetail(tx, owner, inv?.id ?? "", { now: at(M1) }))).householdName).toBe("Mother Gone");
  });

  it("a row that never got a bill-to name still shows the household's", async () => {
    const s = await one("Legacy Kid", "Mother Legacy");
    const e = await join(s.student.id, "Karate A", M0);
    await gen(M1, [e]);
    const [inv] = await issue((await invoicesOf(s.household.id))[0]?.id ?? "", M1);
    await withTenant(T, (tx) => tx.update(invoices).set({ billToName: null }).where(eq(invoices.id, inv?.id ?? "")));
    expect((await listed(inv?.id ?? ""))?.householdName).toBe(s.household.name);
  });
});
