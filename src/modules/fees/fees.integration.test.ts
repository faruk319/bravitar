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
import { familyAccount, recordPayment } from "@/modules/payments/service";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { createStudent, setStudentStatus } from "@/modules/students/service";
import { testAcademy } from "@/lib/db/isolation/academy";
import { addMonths } from "./billing";
import { generateInvoices } from "./invoicing";
import { runInvoicesGenerate } from "./job";
import { linesOf } from "./repo";
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
  const hire = async (name: string, role: string) => ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `${name}-${stamp}@example.test`, fullName: name, roleIds: [roles[role] ?? ""] }))).id);
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
  it("two children in different programs: one family invoice, two lines, the sibling discount with its reason; totals reconcile", async () => {
    const f = await family("Riya", "Kabir");
    const [riya = "", kabir = ""] = f.ids;
    const sibling = await withTenant(T, (tx) => createDiscount(tx, owner, { name: "Sibling 10%", kind: "percent", value: 10 }));
    const given = await withTenant(T, (tx) => giveDiscount(tx, owner, kabir, { discountId: sibling.id, reason: "Second child", validFrom: M0 }));
    // Joined on this month's billing day, so next month is a plain cycle (admission rode on the first).
    const enrollments = [await join(riya, "Karate A", M0), await join(kabir, "Dance A", M0)];
    H.siblings = { ...f, enrollments };

    expect(await gen(M1, enrollments)).toEqual({ invoices: 1, lines: 2 });
    const [inv] = await invoicesOf(f.householdId);
    expect(inv).toMatchObject({ status: "draft", number: null, fy: null, studentId: null, issueDate: M1, dueDate: addDays(M1, 7), periodStart: M1, periodEnd: monthEndOf(M1) });
    expect(inv).toMatchObject({ subtotalPaise: 180000n, discountPaise: 10000n, taxPaise: 0n, totalPaise: 170000n });
    const lines = await linesOn(inv?.id ?? "");
    expect(lines.map((l) => [l.studentName, l.description, l.unitPaise, l.discountPaise, l.discountNote, l.amountPaise])).toEqual([
      ["Kabir", "Dance Monthly", 100000n, 10000n, "Sibling 10% — Second child", 90000n],
      ["Riya", "Karate Monthly", 80000n, 0n, null, 80000n],
    ]);
    expect(sum(lines.map((l) => l.unitPaise)) - sum(lines.map((l) => l.discountPaise)) + sum(lines.map((l) => l.taxPaise))).toBe(inv?.totalPaise);
    expect(await actions(given.id)).toEqual(["discount.give"]);
  });

  it("running again, or the nightly job, bills nothing twice", async () => {
    const { householdId, enrollments } = H.siblings ?? { householdId: "", enrollments: [] };
    expect(await gen(M1, enrollments)).toEqual({ invoices: 0, lines: 0 });
    expect(await runInvoicesGenerate({ now: at(M1), tenantIds: [T] })).toEqual({ tenants: 1, ok: 1, failed: [] });
    const all = await invoicesOf(householdId);
    expect(all).toHaveLength(1);
    expect(await linesOn(all[0]?.id ?? "")).toHaveLength(2);
  });

  it("void and redo: the draft is voided without a number and drafted again", async () => {
    const { householdId, enrollments } = H.siblings ?? { householdId: "", enrollments: [] };
    const [old] = await invoicesOf(householdId);
    await withTenant(T, (tx) => voidInvoice(tx, owner, old?.id ?? "", { reason: "Redo after fee check", rebill: true }, { now: at(M1) }));
    const [voided, fresh] = await invoicesOf(householdId);
    expect(voided).toMatchObject({ id: old?.id, status: "void", number: null, voidReason: "Redo after fee check" });
    expect(fresh).toMatchObject({ status: "draft", totalPaise: 170000n });
    expect((await linesOn(voided?.id ?? "")).map((l) => l.billingKey)).toEqual([null, null]);
    expect(await gen(M1, enrollments)).toEqual({ invoices: 0, lines: 0 });
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
    expect(await gen(M1, enrollments)).toEqual({ invoices: 0, lines: 0 });
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
    expect(await gen(M2, [ea, eb, ec])).toEqual({ invoices: 1, lines: 4 });
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
    expect(await gen(M1, [e])).toEqual({ invoices: 3, lines: 4 });
    const all = await invoicesOf(f.householdId);
    expect(all.map((i) => [i.studentId, i.dueDate, i.totalPaise])).toEqual([
      [f.ids[0], M1, 800000n],
      [f.ids[0], addDays(M1, 120), 600000n],
      [f.ids[0], addDays(M1, 240), 500000n],
    ]);
    expect((await summary(all[0]?.id ?? "")).map((l) => l[2])).toEqual(["1st installment · Class 9 Term", "Admission · Class 9"]);

    const moved = await withTenant(T, (tx) => transferEnrollment(tx, owner, e, { batchId: batch["Class 9 B"] ?? "", date: addDays(M1, 10) }));
    expect(await gen(addDays(M1, 10), [e, moved.id])).toEqual({ invoices: 0, lines: 0 });
    expect(await invoicesOf(f.householdId)).toHaveLength(3);
  });

  it("paused students and package plans (V2) get nothing", async () => {
    const [p, s] = [await family("Ishaan"), await family("Tara")];
    const ep = await join(p.ids[0] ?? "", "Karate A", M0);
    await withTenant(T, (tx) => pauseEnrollment(tx, owner, ep));
    const es = await join(s.ids[0] ?? "", "Swim", M1);
    expect(await gen(M1, [ep, es])).toEqual({ invoices: 0, lines: 0 });
  });
});

describe("leaving and moving", () => {
  it("leaving voids the family invoice and drafts it again without that child's line", async () => {
    const f = await family("Zoya", "Zaid");
    const [zoya, zaid] = [await join(f.ids[0] ?? "", "Karate A", addMonths(M0, -1)), await join(f.ids[1] ?? "", "Karate A", addMonths(M0, -1))];
    expect(await gen(M0, [zoya, zaid])).toEqual({ invoices: 1, lines: 2 });
    const [inv] = await withTenant(T, async (tx) => issueInvoices(tx, owner, [(await invoicesOf(f.householdId))[0]?.id ?? ""], { now: at(M0) }));

    await withTenant(T, (tx) => leaveEnrollment(tx, owner, zoya, { date: addDays(M0, -1) }));
    const [voided, redraft] = await invoicesOf(f.householdId);
    expect(voided).toMatchObject({ id: inv?.id, status: "void", number: inv?.number });
    expect(voided?.voidReason).toMatch(/^Zoya left Karate A, last day /);
    expect(redraft).toMatchObject({ status: "draft", totalPaise: 80000n });
    expect((await summary(redraft?.id ?? "")).map((l) => l[0])).toEqual(["Zaid"]);
  });

  it("leaving voids a paid invoice all the same: its money becomes the family's advance and pays the redraft when that is issued", async () => {
    const f = await family("Meera", "Arjun");
    const [meera, arjun] = [await join(f.ids[0] ?? "", "Karate A", addMonths(M0, -1)), await join(f.ids[1] ?? "", "Karate A", addMonths(M0, -1))];
    expect(await gen(M0, [meera, arjun])).toEqual({ invoices: 1, lines: 2 });
    const [inv] = await withTenant(T, async (tx) => issueInvoices(tx, owner, [(await invoicesOf(f.householdId))[0]?.id ?? ""], { now: at(M0) }));
    const branchId = inv?.branchId ?? "";
    await withTenant(T, (tx) => recordPayment(tx, owner, { requestId: uuidv7(), householdId: f.householdId, branchId, amountPaise: "160000" }));
    expect((await invoicesOf(f.householdId))[0]).toMatchObject({ status: "paid", paidPaise: 160000n });
    const advance = async () => (await withTenant(T, (tx) => familyAccount(tx, owner, f.householdId, branchId))).advancePaise;

    await withTenant(T, (tx) => leaveEnrollment(tx, owner, meera, { date: addDays(M0, -1) }));
    const [voided, redraft] = await invoicesOf(f.householdId);
    expect(voided).toMatchObject({ id: inv?.id, status: "void", paidPaise: 0n, number: inv?.number });
    expect(redraft).toMatchObject({ status: "draft", totalPaise: 80000n });
    expect((await summary(redraft?.id ?? "")).map((l) => l[0])).toEqual(["Arjun"]);
    expect(await advance()).toBe(160000n);
    expect(await actions(inv?.id ?? "")).toEqual(expect.arrayContaining(["invoice.void", "payment.release"]));

    await withTenant(T, (tx) => issueInvoices(tx, owner, [redraft?.id ?? ""]));
    expect((await invoicesOf(f.householdId))[1]).toMatchObject({ id: redraft?.id, status: "paid", paidPaise: 80000n });
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
    expect(await gen(addDays(M0, 10), [e, moved.id])).toEqual({ invoices: 0, lines: 0 });
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
