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
import { staffUsers } from "@/modules/staff/schema";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { createGuardian, insertStudent } from "@/modules/students/repo";
import { addFamilyMember } from "@/modules/students/family";
import { removeFamilyLink, updateGuardian } from "@/modules/students/repo";
import { createStudent, setStudentStatus } from "@/modules/students/service";
import { createBranch } from "@/modules/tenancy/repo";
import { testAcademy } from "@/lib/db/isolation/academy";
import { addMonths, DISPLAY_STATUSES, displayStatus } from "./billing";
import type { InvoiceQuery } from "./invoice-query";
import { generateInvoices, resolvePayers } from "./invoicing";
import type { Enrollment } from "@/modules/enrollments/schema";
import { runInvoicesGenerate } from "./job";
import { insertInvoice, linesOf, owedSummary, updateInvoice } from "./repo";
import { paymentAllocations } from "@/modules/payments/schema";
import { type Invoice, invoiceLines, invoices } from "./schema";
import { createDiscount, createInvoice, createPlan, createScreen, editDraft, editScreen, endDiscount, generateNow, giveDiscount, installmentsDue, invoiceDetail, invoiceList, type InvoiceList, issueInvoices, type PlanInput, saveFeeSettings, setPlanActive, studentFees, voidInvoice } from "./service";

const stamp = Math.random().toString(36).slice(2, 8);
const today = todayIn("Asia/Kolkata");
const M0 = `${today.slice(0, 7)}-01`; // this month's billing day, already past
const M1 = addMonths(M0, 1); // next month's, still ahead
const M2 = addMonths(M0, 2);
const at = (day: string) => new Date(`${day}T04:00:00Z`); // 09:30 in India
const monthEndOf = (day: string) => addDays(addMonths(`${day.slice(0, 7)}-01`, 1), -1);
const NOW = at(M1);
let T = "";
let owner: ScopedCtx;
let desk: ScopedCtx;
let teacher: ScopedCtx;
let phone = 0;
const plan: Record<string, string> = {};
const program: Record<string, string> = {};
const batch: Record<string, string> = {};
const H: Record<string, { ids: string[]; enrollments: string[] }> = {};

const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
  const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
  return { ...base, branchIds };
};
const family = async (...names: string[]) => {
  const guardianPhone = `+9197${String(10_000_000 + ++phone)}`;
  const ids: string[] = [];
  let linkGuardianId = "";
  for (const fullName of names) {
    const r = await withTenant(T, (tx) =>
      createStudent(tx, owner, { fullName, guardian: { fullName: `Parent ${names[0]}`, phone: guardianPhone, relation: "mother" }, consents: { dataProcessing: true }, ...(linkGuardianId ? { linkGuardianId } : {}) }),
    );
    linkGuardianId = r.guardian.id;
    ids.push(r.student.id);
  }
  return { ids };
};
const join = async (studentId: string, batchName: string, startDate: string) => (await withTenant(T, (tx) => enroll(tx, owner, { studentId, batchId: batch[batchName] ?? "", startDate }))).id;
const gen = (day: string, enrollmentIds: string[]) => withTenant(T, (tx) => generateInvoices(tx, { actorType: "system", tenantId: T }, { now: at(day), enrollmentIds }));
const invoicesOf = (memberIds: string[]): Promise<Invoice[]> =>
  withTenant(T, (tx) => tx.select().from(invoices).where(inArray(invoices.studentId, memberIds)).orderBy(asc(invoices.issueDate), asc(invoices.createdAt), asc(invoices.dueDate)));
const linesOn = (invoiceId: string) => withTenant(T, (tx) => linesOf(tx, [invoiceId]));
const summary = async (invoiceId: string) => (await linesOn(invoiceId)).map((l) => [l.studentName, l.kind, l.description, l.unitPaise, l.discountPaise, l.taxPaise]);
const list = (q: Partial<InvoiceQuery> = {}, as: ScopedCtx = owner, now: Date = NOW) => withTenant(T, (tx) => invoiceList(tx, as, { status: "all", sort: "newest", page: 1, ...q }, { now }));
const ids = (l: InvoiceList) => l.rows.map((r) => r.id);
// Every row of a listing, page after page.
async function everyRow(q: Partial<InvoiceQuery> = {}, as: ScopedCtx = owner, now: Date = NOW): Promise<InvoiceList["rows"]> {
  const rows: InvoiceList["rows"] = [];
  for (let page = 1; ; page++) {
    const l = await list({ ...q, page }, as, now);
    rows.push(...l.rows);
    if (page * l.pageSize >= l.matched) return rows;
  }
}
const everyId = async (q: Partial<InvoiceQuery> = {}, as: ScopedCtx = owner, now: Date = NOW) => (await everyRow(q, as, now)).map((r) => r.id);
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
  program.dance = dance;
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
    const all = await invoicesOf(f.ids);
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
    const { ids, enrollments } = H.siblings ?? { ids: [], enrollments: [] };
    expect(await gen(M1, enrollments)).toEqual({ invoices: 0, lines: 0, skipped: [] });
    expect(await runInvoicesGenerate({ now: at(M1), tenantIds: [T] })).toEqual({ tenants: 1, ok: 1, failed: [] });
    const all = await invoicesOf(ids);
    expect(all).toHaveLength(2);
    for (const i of all) expect(await linesOn(i.id)).toHaveLength(1);
  });

  it("void and redo: the draft is voided without a number and drafted again", async () => {
    const { ids, enrollments } = H.siblings ?? { ids: [], enrollments: [] };
    const old = (await invoicesOf(ids)).find((i) => i.totalPaise === 90000n);
    await withTenant(T, (tx) => voidInvoice(tx, owner, old?.id ?? "", { reason: "Redo after fee check", rebill: true }, { now: at(M1) }));
    const all = await invoicesOf(ids);
    const voided = all.find((i) => i.id === old?.id);
    const fresh = all.find((i) => i.status === "draft" && i.studentId === old?.studentId);
    expect(all).toHaveLength(3);
    expect(voided).toMatchObject({ status: "void", number: null, voidReason: "Redo after fee check" });
    expect(fresh).toMatchObject({ status: "draft", totalPaise: 90000n });
    expect((await linesOn(voided?.id ?? "")).map((l) => l.billingKey)).toEqual([null]);
    expect(await gen(M1, enrollments)).toEqual({ invoices: 0, lines: 0, skipped: [] });
  });

  it("issuing numbers drafts oldest first, inside the transaction; Front Desk can look but not issue", async () => {
    const { ids } = H.siblings ?? { ids: [] };
    const first = (await invoicesOf(ids)).find((i) => i.status === "draft");
    const g = await family("Gauri");
    const e = await join(g.ids[0] ?? "", "Karate B", M0);
    H.gauri = { ...g, enrollments: [e] };
    await gen(M1, [e]);
    const [second] = await invoicesOf(g.ids);

    expect(await everyId({ status: "draft" }, desk)).toEqual(expect.arrayContaining([first?.id, second?.id]));
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
    const { ids, enrollments } = H.gauri ?? { ids: [], enrollments: [] };
    const [inv] = await invoicesOf(ids);
    await expect(withTenant(T, (tx) => voidInvoice(tx, owner, inv?.id ?? "", { reason: "" }))).rejects.toThrow();
    await withTenant(T, (tx) => voidInvoice(tx, owner, inv?.id ?? "", { reason: "Paid in cash before the app" }));
    const late = at(addDays(M1, 40));
    const view = (status: "open" | "overdue" | "cancelled") => everyId({ status }, owner, late);
    expect(await view("open")).not.toContain(inv?.id);
    expect(await view("overdue")).not.toContain(inv?.id);
    expect(await view("cancelled")).toContain(inv?.id);
    expect((await invoicesOf(ids))[0]).toMatchObject({ status: "void", number: inv?.number });
    expect(await gen(M1, enrollments)).toEqual({ invoices: 0, lines: 0, skipped: [] });
    await expect(withTenant(T, (tx) => voidInvoice(tx, owner, inv?.id ?? "", { reason: "Again" }))).rejects.toThrow("Already void");

    const siblings = (await invoicesOf(H.siblings?.ids ?? [])).find((i) => i.status === "issued");
    expect(await view("overdue")).toContain(siblings?.id); // due date passed: overdue, worked out on read
  });

  it("mid-cycle joiners pay the full cycle by default, or by days; admission comes once per program, on the first invoice", async () => {
    const joinDay = addDays(M1, 15);
    const [anya, dev] = [await family("Anya"), await family("Dev")];
    const ea = await join(anya.ids[0] ?? "", "Karate A", joinDay);
    await gen(joinDay, [ea]);
    const [fullInv] = await invoicesOf(anya.ids);
    expect(await summary(fullInv?.id ?? "")).toEqual([
      ["Anya", "tuition", "Karate Monthly", 80000n, 0n, 0n],
      ["Anya", "admission", "Admission · Karate", 50000n, 0n, 0n],
    ]);
    expect(fullInv).toMatchObject({ issueDate: joinDay, periodStart: joinDay, periodEnd: monthEndOf(M1), totalPaise: 130000n });

    await withTenant(T, (tx) => saveFeeSettings(tx, owner, { proration: "daily" }));
    const ed = await join(dev.ids[0] ?? "", "Karate A", joinDay);
    await gen(joinDay, [ed]);
    const [byDays] = await invoicesOf(dev.ids);
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
    const next = (await invoicesOf(anya.ids)).find((i) => i.issueDate === M2);
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
    const [before, after] = await invoicesOf(f.ids);
    expect(before).toMatchObject({ taxPaise: 0n, totalPaise: 100000n });
    expect(after).toMatchObject({ taxPaise: 18000n, totalPaise: 118000n });
    const detail = await withTenant(T, (tx) => invoiceDetail(tx, owner, after?.id ?? ""));
    expect(detail.lines[0]).toMatchObject({ taxPaise: 18000n, amountPaise: 100000n });
  });

  it("a term plan: one invoice per installment due by offset, admission on the first; moving to a batch on the same plan bills nothing new", async () => {
    const f = await family("Meera");
    const e = await join(f.ids[0] ?? "", "Class 9 A", M1);
    expect(await gen(M1, [e])).toEqual({ invoices: 3, lines: 4, skipped: [] });
    const all = await invoicesOf(f.ids);
    expect(all.map((i) => [i.studentId, i.dueDate, i.totalPaise])).toEqual([
      [f.ids[0], M1, 800000n],
      [f.ids[0], addDays(M1, 120), 600000n],
      [f.ids[0], addDays(M1, 240), 500000n],
    ]);
    expect((await summary(all[0]?.id ?? "")).map((l) => l[2])).toEqual(["1st installment · Class 9 Term", "Admission · Class 9"]);

    const moved = await withTenant(T, (tx) => transferEnrollment(tx, owner, e, { batchId: batch["Class 9 B"] ?? "", date: addDays(M1, 10) }));
    expect(await gen(addDays(M1, 10), [e, moved.id])).toEqual({ invoices: 0, lines: 0, skipped: [] });
    expect(await invoicesOf(f.ids)).toHaveLength(3);
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
    const zoyasId = (await invoicesOf(f.ids)).find((i) => i.studentId === f.ids[0])?.id ?? "";
    const zaids = (await invoicesOf(f.ids)).find((i) => i.studentId === f.ids[1]);
    const [inv] = await withTenant(T, async (tx) => issueInvoices(tx, owner, [zoyasId], { now: at(M0) }));

    await withTenant(T, (tx) => leaveEnrollment(tx, owner, zoyaKarate, { date: addDays(M0, -1) }));
    const all = await invoicesOf(f.ids);
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
    const [inv] = await withTenant(T, async (tx) => issueInvoices(tx, owner, [(await invoicesOf(f.ids))[0]?.id ?? ""], { now: at(M0) }));
    const branchId = inv?.branchId ?? "";
    await withTenant(T, async (tx) => recordPayment(tx, owner, { requestId: uuidv7(), memberId: f.ids[0] ?? "", branchId, amountPaise: "180000" }));
    expect((await invoicesOf(f.ids))[0]).toMatchObject({ status: "paid", paidPaise: 180000n });
    const advance = async () => (await withTenant(T, (tx) => familyAccount(tx, owner, f.ids[0] ?? "", branchId))).advancePaise;

    await withTenant(T, (tx) => leaveEnrollment(tx, owner, karate, { date: addDays(M0, -1) }));
    const [voided, redraft] = await invoicesOf(f.ids);
    expect(voided).toMatchObject({ id: inv?.id, status: "void", paidPaise: 0n, number: inv?.number });
    expect(redraft).toMatchObject({ status: "draft", totalPaise: 100000n });
    expect((await summary(redraft?.id ?? "")).map((l) => l[0])).toEqual(["Meera"]);
    expect(await advance()).toBe(180000n);
    expect(await actions(inv?.id ?? "")).toEqual(expect.arrayContaining(["invoice.void", "payment.release"]));

    await withTenant(T, (tx) => issueInvoices(tx, owner, [redraft?.id ?? ""]));
    expect((await invoicesOf(f.ids))[1]).toMatchObject({ id: redraft?.id, status: "paid", paidPaise: 100000n });
    expect(await advance()).toBe(80000n);
  });

  it("a term student who leaves after paying installment 1 keeps 2 and 3 issued and unchanged; the leave screen lists both as voidable", async () => {
    const f = await family("Tanvi");
    const student = f.ids[0] ?? "";
    const e = await join(student, "Class 9 A", M0);
    await gen(M0, [e]);
    await withTenant(T, async (tx) => issueInvoices(tx, owner, (await invoicesOf(f.ids)).map((i) => i.id), { now: at(M0) }));
    const [first, second, third] = await invoicesOf(f.ids);
    // Installment 1 paid in full.
    const full = String(first?.totalPaise ?? 0n);
    await withTenant(T, async (tx) =>
      recordPayment(tx, owner, { requestId: uuidv7(), memberId: f.ids[0] ?? "", branchId: first?.branchId ?? "", amountPaise: full, allocations: [{ invoiceId: first?.id ?? "", amountPaise: full }] }),
    );
    const snapshot = async () => Promise.all([second, third].map(async (i) => ({ invoice: (await withTenant(T, (tx) => tx.select().from(invoices).where(eq(invoices.id, i?.id ?? ""))))[0], lines: await linesOn(i?.id ?? "") })));
    const before = await snapshot();

    await withTenant(T, (tx) => setStudentStatus(tx, owner, student, { status: "left", reason: "completed" }));

    expect(await snapshot()).toEqual(before);
    expect(before.map((b) => b.invoice?.status)).toEqual(["issued", "issued"]);
    expect((await invoicesOf(f.ids)).map((i) => i.status)).toEqual(["paid", "issued", "issued"]);
    expect(await everyId({ status: "open" })).toEqual(expect.arrayContaining([second?.id, third?.id]));
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
    expect((await invoicesOf(f.ids)).map((i) => i.status)).toEqual(["void"]);
  });

  it("a batch move mid-cycle doesn't double-bill: the old cycle stands, the new plan starts next cycle", async () => {
    const f = await family("Kiara");
    const e = await join(f.ids[0] ?? "", "Karate A", addMonths(M0, -1));
    await gen(M0, [e]);
    const moved = await withTenant(T, (tx) => transferEnrollment(tx, owner, e, { batchId: batch["Karate Adv"] ?? "", date: addDays(M0, 10) }));
    expect(await gen(addDays(M0, 10), [e, moved.id])).toEqual({ invoices: 0, lines: 0, skipped: [] });
    await gen(M1, [e, moved.id]);
    const all = await invoicesOf(f.ids);
    expect(await Promise.all(all.map(async (i) => [i.status, i.issueDate, (await summary(i.id)).map((l) => [l[2], l[3]])]))).toEqual([
      ["draft", M0, [["Karate Monthly", 80000n]]],
      ["draft", M1, [["Karate Advanced", 120000n]]],
    ]);
  });
});

describe("who can do what", () => {
  it("Teacher sees no fees; Front Desk reads but can't issue, void, discount or generate", async () => {
    const { ids } = await family("Nia");
    await expect(list({ status: "open" }, teacher)).rejects.toMatchObject({ status: 403 });
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
      const payer = await createGuardian(tx, { tenantId: T, fullName: `Payer ${++families}`, phone: `98766${String(10_000 + families)}` });
      const total = BigInt(rupees) * 100n;
      const kid = await insertStudent(tx, { tenantId: T, branchId, fullName: `Kid ${families}`, code: `BILL/${stamp}/${families}` });
      const inv = await insertInvoice(tx, { tenantId: T, branchId, studentId: kid.id, payerGuardianId: payer.id, issueDate: addDays(due, -7), dueDate: due, subtotalPaise: total, totalPaise: total });
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
      overduePayers: 1,
      overduePaise: 75_000n, // only the overdue invoice, and only what is left on it
      dueTomorrow: 1,
    });
  });

  it("counts overdue payers, not invoices: a payer with two overdue invoices is one, two payers are two", async () => {
    const branchTwo = (await withTenant(T, (tx) => createBranch(tx, { tenantId: T, name: "Payers branch" }))).id;
    await withTenant(T, async (tx) => {
      for (const [i, name] of ["Mother", "Father"].entries()) {
        const payer = await createGuardian(tx, { tenantId: T, fullName: name, phone: `98767${String(10_000 + i)}` });
        for (const late of i === 0 ? [2, 3] : [2]) {
          const kid = await insertStudent(tx, { tenantId: T, branchId: branchTwo, fullName: `Late ${i}-${late}`, code: `LATE/${stamp}/${i}-${late}` });
          const inv = await insertInvoice(tx, { tenantId: T, branchId: branchTwo, studentId: kid.id, payerGuardianId: payer.id, issueDate: addDays(today, -9), dueDate: addDays(today, -late), subtotalPaise: 10_000n, totalPaise: 10_000n });
          await updateInvoice(tx, inv.id, { number: await allocateNumber(tx, T, "invoice", financialYear(today)), fy: financialYear(today), status: "issued", issuedAt: new Date() });
        }
      }
    });
    expect(await withTenant(T, (tx) => owedSummary(tx, [branchTwo], today))).toMatchObject({ invoices: 3, overduePayers: 2 });
  });

  it("is all zeroes for a branch with nothing owed", async () => {
    expect(await withTenant(T, (tx) => owedSummary(tx, [empty], today))).toEqual({ invoices: 0, owedPaise: 0n, overduePayers: 0, overduePaise: 0n, dueTomorrow: 0 });
  });
});

describe("one payment for siblings' invoices", () => {
  it("settles three siblings' invoices from one run, with what is over kept as advance", async () => {
    const f = await family("Pay One", "Pay Two", "Pay Three");
    const es = await Promise.all(f.ids.map((id) => join(id, "Karate A", M0)));
    expect(await gen(M1, es)).toEqual({ invoices: 3, lines: 3, skipped: [] });
    const drafts = await invoicesOf(f.ids);
    const issued = await withTenant(T, (tx) => issueInvoices(tx, owner, drafts.map((d) => d.id), { now: at(M1) }));
    const branchId = issued[0]?.branchId ?? "";
    const payment = await withTenant(T, async (tx) => recordPayment(tx, owner, { requestId: uuidv7(), memberId: f.ids[0] ?? "", branchId, amountPaise: "250000" }));

    const after = await invoicesOf(f.ids);
    // Three invoices of 80000 each; a per-family balance bug would pay one invoice or none.
    expect(after.map((i) => [i.status, i.paidPaise])).toEqual([["paid", 80000n], ["paid", 80000n], ["paid", 80000n]]);
    const rows = await withTenant(T, (tx) => tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, payment.id)));
    expect(rows.map((r) => r.invoiceId).sort()).toEqual(after.map((i) => i.id).sort());
    expect(sum(rows.map((r) => r.amountPaise))).toBe(240000n);
    expect((await withTenant(T, (tx) => familyAccount(tx, owner, f.ids[0] ?? "", branchId))).advancePaise).toBe(10000n);
  });
});

describe("an invoice carries its payer and the name it was issued with", () => {
  const phoneNo = () => `+9197${String(20_000_000 + ++phone)}`;
  const one = (fullName: string, guardianName: string) =>
    withTenant(T, (tx) => createStudent(tx, owner, { fullName, guardian: { fullName: guardianName, phone: phoneNo(), relation: "mother" }, consents: { dataProcessing: true } }));
  const setPayer = (enrollmentId: string, guardianId: string) => withTenant(T, (tx) => tx.update(enrollments).set({ payerGuardianId: guardianId, payerMemberId: null }).where(eq(enrollments.id, enrollmentId)));
  const issue = (id: string, day: string) => withTenant(T, (tx) => issueInvoices(tx, owner, [id], { now: at(day) }));
  const listed = async (inv: Invoice | undefined) => (await list({ status: "open", q: inv?.number ?? "" })).rows.find((i) => i.id === inv?.id);

  it("the enrollment's payer lands on the invoice, and its name is the bill-to", async () => {
    const s = await one("Payer Kid", "Mother Payer");
    const aunt = await withTenant(T, (tx) => addFamilyMember(tx, owner, s.student.id, { fullName: "Aunt Payer", phone: phoneNo(), relation: "other" }));
    const e = await join(s.student.id, "Karate A", M0);
    await setPayer(e, aunt.id);
    await gen(M1, [e]);
    const [inv] = await invoicesOf([s.student.id]);
    // Would be Mother Payer (the manager fallback) if the enrollment's payer were ignored.
    expect(inv).toMatchObject({ payerGuardianId: aunt.id, payerMemberId: null, billToName: "Aunt Payer" });
  });

  it("an enrollment with no payer is billed to the member's manager guardian", async () => {
    const s = await one("Fallback Kid", "Mother Fallback");
    const e = await join(s.student.id, "Karate A", M0);
    expect(await gen(M1, [e])).toMatchObject({ invoices: 1, skipped: [] });
    expect((await invoicesOf([s.student.id]))[0]).toMatchObject({ payerGuardianId: s.guardian.id, billToName: "Mother Fallback" });
  });

  it("a member with no guardian at all (a gym) is billed with themselves as payer", async () => {
    const adult = await one("Gym Adult", "Soon Gone");
    const fine = await one("Fine Kid", "Mother Fine");
    const [ea, ef] = [await join(adult.student.id, "Karate A", M0), await join(fine.student.id, "Karate A", M0)];
    await withTenant(T, (tx) => removeFamilyLink(tx, adult.student.id, adult.guardian.id, new Date()));
    // Fails if the member were skipped (invoices 1, skipped 1) or billed to the removed guardian.
    expect(await gen(M1, [ea, ef])).toEqual({ invoices: 2, lines: 2, skipped: [] });
    expect((await invoicesOf([adult.student.id]))[0]).toMatchObject({ payerGuardianId: null, payerMemberId: adult.student.id, billToName: "Gym Adult" });
    expect((await invoicesOf([fine.student.id]))[0]?.billToName).toBe("Mother Fine");
  });

  it("a member whose two batches have different payers gets two invoices, one per payer, each with its own lines and bill-to name", async () => {
    const s = await one("Split Kid", "Mother Split");
    const aunt = await withTenant(T, (tx) => addFamilyMember(tx, owner, s.student.id, { fullName: "Aunt Split", phone: phoneNo(), relation: "other" }));
    const [karate, dance] = [await join(s.student.id, "Karate A", M0), await join(s.student.id, "Dance A", M0)];
    await setPayer(karate, s.guardian.id);
    await setPayer(dance, aunt.id);
    // One invoice (lines 2) would mean a payer was silently dropped.
    expect(await gen(M1, [karate, dance])).toEqual({ invoices: 2, lines: 2, skipped: [] });
    const all = await invoicesOf([s.student.id]);
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
    const b = await withTenant(T, (tx) => createStudent(tx, owner, { fullName: "Sib Two", guardian: { fullName: "Mother Sibs", phone: a.guardian.phone, relation: "mother" }, linkGuardianId: a.guardian.id, consents: { dataProcessing: true } }));
    expect(b.guardian.id).toBe(a.guardian.id);
    const c = await withTenant(T, (tx) => createStudent(tx, owner, { fullName: "Sib Three", guardian: { fullName: "Mother Sibs", phone: a.guardian.phone, relation: "mother" }, linkGuardianId: a.guardian.id, consents: { dataProcessing: true } }));
    const [ea, eb, ec] = [await join(a.student.id, "Karate A", M0), await join(b.student.id, "Karate A", M0), await join(c.student.id, "Karate A", M0)];
    for (const e of [ea, eb, ec]) await setPayer(e, a.guardian.id);
    expect(await gen(M1, [ea])).toEqual({ invoices: 1, lines: 1, skipped: [] });
    // Fails as invoices 1, lines 2 if siblings in one run shared a group, or as lines 1 if a later run appended to the first sibling's draft.
    expect(await gen(M1, [eb, ec])).toEqual({ invoices: 2, lines: 2, skipped: [] });
    const all = await invoicesOf([a.student.id, b.student.id, c.student.id]);
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
    const [draft] = await invoicesOf([s.student.id]);
    expect(draft?.billToName).toBe("Mother Before");
    await withTenant(T, (tx) => updateGuardian(tx, s.guardian.id, { fullName: "Mother Issue" }));
    const [issued] = await issue(draft?.id ?? "", M1);
    expect(issued?.billToName).toBe("Mother Issue");
    await withTenant(T, (tx) => updateGuardian(tx, s.guardian.id, { fullName: "Mother Later" }));
    // A live read would show Mother Later (or a name read live).
    expect((await listed(issued))?.billToName).toBe("Mother Issue");
    expect((await withTenant(T, (tx) => invoiceDetail(tx, owner, issued?.id ?? "", { now: at(M1) }))).billToName).toBe("Mother Issue");
  });

  it("a guardian left with no members, even a deleted one, leaves their invoices readable under the name they were issued with", async () => {
    const s = await one("Gone Kid", "Mother Gone");
    const e = await join(s.student.id, "Karate A", M0);
    await gen(M1, [e]);
    const [inv] = await issue((await invoicesOf([s.student.id]))[0]?.id ?? "", M1);
    await withTenant(T, (tx) => removeFamilyLink(tx, s.student.id, s.guardian.id, new Date()));
    await withTenant(T, (tx) => updateGuardian(tx, s.guardian.id, { fullName: "Renamed Away", deletedAt: new Date() }));
    expect((await listed(inv))?.billToName).toBe("Mother Gone");
    expect((await withTenant(T, (tx) => invoiceDetail(tx, owner, inv?.id ?? "", { now: at(M1) }))).billToName).toBe("Mother Gone");
  });

  it("a row that never got a bill-to name shows blank, not a guess", async () => {
    const s = await one("Legacy Kid", "Mother Legacy");
    const e = await join(s.student.id, "Karate A", M0);
    await gen(M1, [e]);
    const [inv] = await issue((await invoicesOf([s.student.id]))[0]?.id ?? "", M1);
    await withTenant(T, (tx) => tx.update(invoices).set({ billToName: null }).where(eq(invoices.id, inv?.id ?? "")));
    const row = await listed(inv);
    expect(row?.id).toBe(inv?.id); // found, so the blank is the name and not a missing row
    expect(row?.billToName).toBe("");
    expect((await withTenant(T, (tx) => invoiceDetail(tx, owner, inv?.id ?? "", { now: at(M1) }))).billToName).toBe("");
  });
});

describe("the invoice list", () => {
  const phoneNo = () => `+9197${String(30_000_000 + ++phone)}`;
  const one = (fullName: string, guardianName: string) =>
    withTenant(T, (tx) => createStudent(tx, owner, { fullName, guardian: { fullName: guardianName, phone: phoneNo(), relation: "mother" }, consents: { dataProcessing: true } }));
  // A student billed for next month in these batches: the draft(s), not yet numbered.
  const billed = async (fullName: string, payer: string, ...batchNames: string[]) => {
    const s = await one(fullName, payer);
    await gen(M1, await Promise.all(batchNames.map((b) => join(s.student.id, b, M0))));
    return invoicesOf([s.student.id]);
  };
  const issue = (drafts: Invoice[]) => withTenant(T, (tx) => issueInvoices(tx, owner, drafts.map((d) => d.id), { now: NOW }));
  const only = (rows: Invoice[]): Invoice => {
    const [row] = rows;
    if (!row) throw new Error("expected an invoice");
    return row;
  };
  const pay = (inv: Invoice, rupees: number) =>
    withTenant(T, (tx) => recordPayment(tx, owner, { requestId: uuidv7(), memberId: inv.studentId, branchId: inv.branchId, amountPaise: String(rupees * 100), allocations: [{ invoiceId: inv.id, amountPaise: String(rupees * 100) }] }));
  const numbered = (inv: Invoice | undefined) => inv?.number ?? "";
  // A hand-made invoice (no lines) for a payer of its own, due on `due`.
  const direct = (branchId: string, label: string, rupees: number, due: string, paidRupees: number) =>
    withTenant(T, async (tx) => {
      const payer = await createGuardian(tx, { tenantId: T, fullName: `Mother ${label}`, phone: phoneNo() });
      const kid = await insertStudent(tx, { tenantId: T, branchId, fullName: `Kid ${label}`, code: `LIST/${stamp}/${label}` });
      const total = BigInt(rupees) * 100n;
      const inv = await insertInvoice(tx, { tenantId: T, branchId, studentId: kid.id, payerGuardianId: payer.id, billToName: payer.fullName, issueDate: addDays(due, -8), dueDate: due, subtotalPaise: total, totalPaise: total });
      const fy = financialYear(today);
      return updateInvoice(tx, inv.id, { number: await allocateNumber(tx, T, "invoice", fy), fy, status: paidRupees ? "part_paid" : "issued", paidPaise: BigInt(paidRupees) * 100n, issuedAt: new Date() });
    });

  let main = "";
  let karate: Invoice;
  let dance: Invoice;
  let both: Invoice;
  let paid: Invoice;
  let cancelled: Invoice;
  let draft: Invoice;
  let installments: Invoice[];
  let termStudent = "";
  let overdue: Invoice;
  let elsewhere: Invoice;
  let other = "";

  beforeAll(async () => {
    karate = only(await issue(await billed("List Karate", "Mother 7 Lister", "Karate A")));
    main = karate.branchId;
    dance = only(await issue(await billed("List Dancer", "Father Dancer", "Dance A")));
    both = only(await issue(await billed("List Both", "Mother Both", "Karate A", "Dance A")));
    paid = only(await issue(await billed("List Paid", "Mother 50% Paid_Up", "Karate A")));
    cancelled = only(await issue(await billed("List Void", "Mother Void", "Karate A")));
    draft = only(await billed("List Draft", "Mother Draft", "Karate A"));
    installments = await issue(await billed("List Term", "Mother Term", "Class 9 A"));
    termStudent = only(installments).studentId;
    await pay(dance, 500); // part paid, and not yet due
    await pay(paid, Number(paid.totalPaise / 100n));
    await withTenant(T, (tx) => voidInvoice(tx, owner, cancelled.id, { reason: "Joined elsewhere" }, { now: NOW }));
    overdue = await direct(main, "Overdue", 1500, addDays(M1, -1), 500);
    other = (await withTenant(T, (tx) => createBranch(tx, { tenantId: T, name: "List branch" }))).id;
    elsewhere = await direct(other, "Elsewhere", 700, addDays(M1, 3), 0);
  });

  it("each invoice is in one status tab, the tabs add up to All, and they match the rule in code", async () => {
    const l = await list();
    expect(DISPLAY_STATUSES.reduce((n, s) => n + l.counts[s], 0)).toBe(l.counts.all);
    for (const s of DISPLAY_STATUSES) expect(l.counts[s], s).toBeGreaterThan(0); // every branch of the rule is exercised
    // The SQL rule against displayStatus(), invoice by invoice.
    const every = await withTenant(T, (tx) => tx.select().from(invoices));
    expect(l.counts.all).toBe(every.length);
    for (const s of DISPLAY_STATUSES) expect((await everyId({ status: s })).sort(), s).toEqual(every.filter((i) => displayStatus(i, M1) === s).map((i) => i.id).sort());
  });

  it("a part-paid invoice past its due date is listed under Overdue only", async () => {
    // ₹1,500 due the day before NOW, ₹500 paid
    expect(await everyId({ status: "overdue" })).toContain(overdue.id);
    expect(await everyId({ status: "part_paid" })).not.toContain(overdue.id);
    expect((await list({ q: numbered(overdue) })).rows[0]).toMatchObject({ display: "overdue", totalPaise: 150_000n, paidPaise: 50_000n });
    // Positive control: read two days before its due date it is part paid.
    const before = at(addDays(M1, -2));
    expect(await everyId({ status: "part_paid" }, owner, before)).toContain(overdue.id);
    expect(await everyId({ status: "overdue" }, owner, before)).not.toContain(overdue.id);
  });

  it("Open is issued or part paid on any due date, and is not a tab of its own", async () => {
    const l = await list({ status: "open" });
    expect(l.matched).toBe(l.counts.due + l.counts.part_paid + l.counts.overdue);
    const rows = await everyRow({ status: "open" });
    expect(rows.filter((r) => r.display === "draft" || r.display === "paid" || r.display === "cancelled")).toEqual([]);
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([karate.id, dance.id, overdue.id]));
  });

  it("finds by number, student or payer, and ignores case", async () => {
    expect(ids(await list({ q: numbered(karate) }))).toEqual([karate.id]);
    expect(ids(await list({ q: "Mother 7" }))).toEqual([karate.id]); // the payer's name
    expect(ids(await list({ q: "list karate" }))).toEqual([karate.id]); // the student's name
    expect(ids(await list({ q: "father dancer" }))).toEqual([dance.id]);
    expect(ids(await list({ q: "no such person" }))).toEqual([]);
  });

  it("takes % _ and \\ in a search as the characters they are", async () => {
    expect(ids(await list({ q: "50%" }))).toEqual([paid.id]);
    expect(ids(await list({ q: "Paid_Up" }))).toEqual([paid.id]);
    // As wildcards these would find "Paid_Up"; as themselves they find nothing.
    expect(ids(await list({ q: "Paid%Up" }))).toEqual([]);
    expect(ids(await list({ q: "Pa_d" }))).toEqual([]);
    expect(ids(await list({ q: "\\" }))).toEqual([]);
  });

  it("filters by program and by batch, and the tab counts follow the filters", async () => {
    const inDance = await everyId({ programId: program.dance ?? "" });
    expect(inDance).toEqual(expect.arrayContaining([dance.id, both.id]));
    expect(inDance).not.toContain(karate.id);
    const inBatch = await everyId({ batchId: batch["Dance A"] ?? "" });
    expect(inBatch).toEqual(expect.arrayContaining([dance.id, both.id]));
    expect(inBatch).not.toContain(karate.id);
    expect(await everyId({ programId: program.dance ?? "", batchId: batch["Karate A"] ?? "" })).toEqual([]); // one placement must be both
    const l = await list({ programId: program.dance ?? "" });
    expect(l.counts.all).toBe(inDance.length);
    expect(l.matched).toBe(inDance.length);
  });

  it("names the programs on an invoice, by name, and offers the programs and batches to filter by", async () => {
    expect((await list({ q: numbered(karate) })).rows[0]?.programs).toEqual(["Karate"]);
    expect((await list({ q: numbered(both) })).rows[0]?.programs).toEqual(["Dance", "Karate"]);
    expect((await list({ q: numbered(overdue) })).rows[0]?.programs).toEqual([]); // a hand-made invoice has no lines
    const { options } = await list();
    expect(options.programs.map((p) => p.name)).toEqual(expect.arrayContaining(["Karate", "Dance", "Class 9"]));
    expect(options.batches.map((b) => b.name)).toEqual(expect.arrayContaining(["Karate A", "Dance A", "Class 9 A"]));
  });

  it("filters by issue and due dates, both ends included", async () => {
    const dueEve = addDays(M1, -1);
    expect(await everyId({ dueFrom: dueEve, dueTo: dueEve })).toContain(overdue.id);
    expect(await everyId({ dueFrom: dueEve, dueTo: addDays(dueEve, -1) })).not.toContain(overdue.id);
    expect(await everyId({ dueFrom: addDays(dueEve, 1) })).not.toContain(overdue.id);
    const issuedOn = await everyId({ issuedFrom: M1, issuedTo: M1 });
    expect(issuedOn).toEqual(expect.arrayContaining([karate.id, dance.id]));
    expect(issuedOn).not.toContain(overdue.id); // issued nine days before
    expect(await everyId({ issuedTo: addDays(M1, -1) })).toContain(overdue.id);
  });

  it("pages by ten, newest first, and a page past the end shows the last", async () => {
    const all = await list();
    expect(all.counts.all).toBeGreaterThan(10); // the eleven above, and whatever earlier tests billed
    expect(all.pageSize).toBe(10);
    expect(all.rows).toHaveLength(10);
    const second = await list({ page: 2 });
    expect(second.rows).toHaveLength(Math.min(10, all.counts.all - 10));
    expect(second.page).toBe(2);
    expect(ids(all).filter((id) => ids(second).includes(id))).toEqual([]);
    const issued = (await everyRow()).map((r) => r.issueDate);
    expect(issued).toEqual([...issued].sort().reverse());
    const last = await list({ page: 99 });
    expect(last.page).toBe(Math.ceil(all.matched / 10));
    expect(last.rows.length).toBeGreaterThan(0);
  });

  it("sorts oldest first, by amount, and by due date, without repeating or dropping a row at a page edge", async () => {
    const oldest = (await everyRow({ sort: "oldest" })).map((r) => r.issueDate);
    expect(oldest).toEqual([...oldest].sort());
    const byAmount = await everyRow({ sort: "amount" });
    const amounts = byAmount.map((r) => r.totalPaise);
    expect(amounts).toEqual([...amounts].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
    const dues = (await everyRow({ sort: "due" })).map((r) => r.dueDate);
    expect(dues).toEqual([...dues].sort());
    expect(new Set(byAmount.map((r) => r.id)).size).toBe((await list()).counts.all);
  });

  it("shows the installment position", async () => {
    // a term plan with 3 installments, all billed; the second one
    const [first, second, third] = [...installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    expect(installments).toHaveLength(3);
    expect((await list({ q: numbered(second) })).rows[0]?.installment).toEqual({ n: 2, of: 3 });
    expect((await list({ q: numbered(first) })).rows[0]?.installment).toEqual({ n: 1, of: 3 });
    expect((await list({ q: numbered(third) })).rows[0]?.installment).toEqual({ n: 3, of: 3 });
    expect((await list({ q: numbered(karate) })).rows[0]?.installment).toBeNull(); // a monthly fee is no installment
    expect((await list({ q: numbered(first) })).rows[0]?.programs).toEqual(["Class 9"]);
  });

  it("a viewer limited to one branch never counts another branch's invoices", async () => {
    // one invoice in the second branch; ctx with branchIds [main]
    const mainOnly = { ...owner, branchIds: [main] };
    expect(ids(await list({ q: numbered(elsewhere) }))).toEqual([elsewhere.id]);
    expect(ids(await list({ q: numbered(elsewhere) }, mainOnly))).toEqual([]);
    expect(await everyId({}, mainOnly)).not.toContain(elsewhere.id);
    expect((await list({}, mainOnly)).counts.all).toBe((await list({}, { ...owner, branchIds: [main, other] })).counts.all - 1);
  });

  it("counts the drafts waiting for review across the academy, whatever the filters", async () => {
    const drafts = (await withTenant(T, (tx) => tx.select().from(invoices))).filter((i) => i.status === "draft");
    expect(drafts.map((d) => d.id)).toContain(draft.id);
    expect((await list({ status: "paid", q: "no such person" })).drafts).toEqual({ count: drafts.length, total: sum(drafts.map((d) => d.totalPaise)) });
  });

  it("Front Desk can read the list; Teacher cannot", async () => {
    expect((await list({}, desk)).rows.length).toBeGreaterThan(0);
    await expect(list({}, teacher)).rejects.toMatchObject({ status: 403 });
  });

  it("the detail names each program, batch and fee plan an invoice bills, once each; a hand-made invoice has none", async () => {
    const detail = (id: string) => withTenant(T, (tx) => invoiceDetail(tx, owner, id, { now: NOW }));
    const d = await detail(both.id);
    expect(d.programs.map((p) => [p.programName, p.batchName, p.planName])).toEqual([
      ["Dance", "Dance A", "Dance Monthly"],
      ["Karate", "Karate A", "Karate Monthly"],
    ]);
    expect(d.programs.map((p) => p.enrollmentId).sort()).toEqual([...new Set((await linesOn(both.id)).map((l) => l.enrollmentId ?? ""))].sort());
    expect(await detail(overdue.id)).toMatchObject({ programs: [], createdByName: null, issuedByName: null });
  });

  it("an invoice and a student's fees carry the same status as the list", async () => {
    const detail = (id: string, now: Date = NOW) => withTenant(T, (tx) => invoiceDetail(tx, owner, id, { now }));
    expect(await detail(overdue.id)).toMatchObject({ display: "overdue", overdue: true });
    expect(await detail(overdue.id, at(addDays(M1, -2)))).toMatchObject({ display: "part_paid", overdue: false });
    expect((await detail(draft.id)).display).toBe("draft");
    expect((await detail(cancelled.id)).display).toBe("cancelled");

    const fees = await withTenant(T, (tx) => studentFees(tx, owner, termStudent, { now: NOW }));
    expect(fees.invoices.map((i) => i.installment?.of)).toEqual([3, 3, 3]);
    expect(fees.invoices.map((i) => i.display)).toEqual(["due", "due", "due"]);
    const mine = await withTenant(T, (tx) => studentFees(tx, owner, dance.studentId, { now: NOW }));
    expect(mine.invoices.map((i) => [i.id, i.display, i.programs])).toEqual([[dance.id, "part_paid", ["Dance"]]]);
  });
});

describe("who created and issued an invoice", () => {
  const phoneNo = () => `+9197${String(40_000_000 + ++phone)}`;
  const kid = (fullName: string) => withTenant(T, (tx) => createStudent(tx, owner, { fullName, guardian: { fullName: `Mother ${fullName}`, phone: phoneNo(), relation: "mother" }, consents: { dataProcessing: true } }));
  const invoiceOf = async (studentId: string): Promise<Invoice> => {
    const [inv] = await invoicesOf([studentId]);
    if (!inv) throw new Error("expected an invoice");
    return inv;
  };
  const detail = (id: string) => withTenant(T, (tx) => invoiceDetail(tx, owner, id, { now: at(M1) }));
  let night: Invoice;
  let byHand: Invoice;

  beforeAll(async () => {
    const [nightly, manual] = [await kid("Night Kid"), await kid("Now Kid")];
    await gen(M1, [await join(nightly.student.id, "Karate A", M0)]); // the nightly run has no staff member
    await join(manual.student.id, "Karate A", M1); // joins today: tuition and admission on one invoice
    await withTenant(T, (tx) => generateNow(tx, owner, { now: at(M1) }));
    night = await invoiceOf(nightly.student.id);
    byHand = await invoiceOf(manual.student.id);
  });

  it("the nightly run creates with nobody; Generate now creates with the staff member", () => {
    expect(night).toMatchObject({ createdBy: null, issuedBy: null });
    expect(byHand).toMatchObject({ createdBy: owner.staffId, issuedBy: null });
  });

  it("issuing records who issued it and leaves who created it", async () => {
    const [a, b] = await withTenant(T, (tx) => issueInvoices(tx, owner, [night.id, byHand.id], { now: at(M1) }));
    expect([a, b].map((i) => [i?.createdBy, i?.issuedBy])).toEqual([
      [null, owner.staffId],
      [owner.staffId, owner.staffId],
    ]);
    expect(await invoiceOf(night.studentId)).toMatchObject({ createdBy: null, issuedBy: owner.staffId });
  });

  it("the detail names both, and the program once though two lines bill it", async () => {
    const d = await detail(byHand.id);
    expect((await linesOn(byHand.id)).map((l) => l.kind).sort()).toEqual(["admission", "tuition"]);
    expect(d).toMatchObject({ createdByName: "Owner", issuedByName: "Owner", programs: [{ programName: "Karate", batchName: "Karate A", planName: "Karate Monthly" }] });
    expect(d.programs).toHaveLength(1);
    expect(await detail(night.id)).toMatchObject({ createdByName: null, issuedByName: "Owner" });
  });

  it("lines on two fee plans for one placement list it once, under the first plan by name", async () => {
    const [admission] = (await linesOn(byHand.id)).filter((l) => l.kind === "admission");
    const swap = (feePlanId: string) => withTenant(T, (tx) => tx.update(invoiceLines).set({ feePlanId }).where(eq(invoiceLines.id, admission?.id ?? "")));
    await swap(plan.advanced ?? "");
    expect((await detail(byHand.id)).programs.map((p) => [p.batchName, p.planName])).toEqual([["Karate A", "Karate Advanced"]]);
    await swap(plan.karate ?? ""); // as it was
  });

  it("a staff member who is later removed keeps their name on what they made", async () => {
    const gone = await withTenant(T, async (tx) => createStaffMember(tx, owner, { email: `gone-${stamp}@example.test`, fullName: "Gone Staff", roleId: (await listRoles(tx)).find((r) => r.name === "Front Desk")?.id ?? "" }));
    await withTenant(T, (tx) => tx.update(invoices).set({ createdBy: gone.id }).where(eq(invoices.id, night.id)));
    await withTenant(T, (tx) => tx.update(staffUsers).set({ deletedAt: new Date() }).where(eq(staffUsers.id, gone.id)));
    expect((await detail(night.id)).createdByName).toBe("Gone Staff");
  });
});

describe("a one-off charge added by hand", () => {
  const phoneNo = () => `+9197${String(50_000_000 + ++phone)}`;
  const exam = { kind: "exam", description: "Grading exam", amountPaise: "50000" } as const;
  const student = (fullName: string) => withTenant(T, (tx) => createStudent(tx, owner, { fullName, guardian: { fullName: `Mother ${fullName}`, phone: phoneNo(), relation: "mother" }, consents: { dataProcessing: true } }));
  const create = (input: Parameters<typeof createInvoice>[2], as: ScopedCtx = owner) => withTenant(T, (tx) => createInvoice(tx, as, input, { now: NOW }));
  const edit = (id: string, input: Parameters<typeof editDraft>[3], as: ScopedCtx = owner) => withTenant(T, (tx) => editDraft(tx, as, id, input));
  const setPayer = (enrollmentId: string, guardianId: string) => withTenant(T, (tx) => tx.update(enrollments).set({ payerGuardianId: guardianId, payerMemberId: null }).where(eq(enrollments.id, enrollmentId)));
  let kid = "";
  let kidMother = "";

  beforeAll(async () => {
    const k = await student("Charge Kid");
    [kid, kidMother] = [k.student.id, k.guardian.id];
  });

  it("creates a draft from the lines given; the number comes on issue", async () => {
    const d = await create({ studentId: kid, lines: [exam] });
    expect(d).toMatchObject({ status: "draft", number: null, totalPaise: 50_000n, createdBy: owner.staffId });
    expect((await linesOn(d.id)).map((l) => [l.kind, l.description, l.unitPaise, l.billingKey])).toEqual([["exam", "Grading exam", 50_000n, null]]);
    expect((await create({ studentId: kid, lines: [exam], issue: true })).number).toMatch(/^INV\//);
  });

  it("create and issue lets the payer's advance pay it", async () => {
    const rich = await student("Advance Kid");
    await withTenant(T, (tx) => recordPayment(tx, owner, { requestId: uuidv7(), memberId: rich.student.id, branchId: rich.student.branchId, amountPaise: "100000" }));
    expect(await create({ studentId: rich.student.id, lines: [exam], issue: true })).toMatchObject({ status: "paid", paidPaise: 50_000n });
  });

  it("charges tax only with a GSTIN", async () => {
    const taxed = { ...exam, taxRateBp: 1800 };
    expect((await create({ studentId: kid, lines: [taxed] })).totalPaise).toBe(50_000n); // no GSTIN yet
    await withTenant(T, (tx) => saveFeeSettings(tx, owner, { gstin: "27abcde1234f1z5" }));
    try {
      const withTax = await create({ studentId: kid, lines: [taxed] });
      expect(withTax).toMatchObject({ taxPaise: 9_000n, totalPaise: 59_000n });
      // The sheet works the rate back from the tax, and knows GST is on.
      const sheet = await withTenant(T, (tx) => editScreen(tx, owner, withTax.id));
      expect(sheet?.seed.lines.map((l) => l.taxRateBp)).toEqual([1800]);
      expect(sheet?.screen.gst).toBe(true);
    } finally {
      await withTenant(T, (tx) => saveFeeSettings(tx, owner, { gstin: null }));
    }
  });

  it("edits a manual draft; refuses a generated draft and an issued invoice", async () => {
    const manual = await create({ studentId: kid, lines: [exam] });
    const edited = await edit(manual.id, { studentId: kid, lines: [{ ...exam, amountPaise: "60000" }] });
    expect(edited).toMatchObject({ id: manual.id, status: "draft", totalPaise: 60_000n });
    expect(await linesOn(manual.id)).toHaveLength(1); // swapped, not added to
    expect(await actions(manual.id)).toEqual(["invoice.create", "invoice.edit"]);
    const sheet = await withTenant(T, (tx) => editScreen(tx, owner, manual.id));
    expect(sheet?.seed).toMatchObject({ id: manual.id, payerKey: `guardian:${kidMother}`, lines: [{ kind: "exam", description: "Grading exam", amountPaise: "60000", enrollmentId: null, taxRateBp: 0 }] });

    const other = await student("Generated Kid");
    await gen(M1, [await join(other.student.id, "Karate A", M0)]);
    const [generatedDraft] = await invoicesOf([other.student.id]);
    const issued = await create({ studentId: kid, lines: [exam], issue: true });
    // A generated draft is fixed by its plan; an issued invoice is fixed.
    await expect(edit(generatedDraft?.id ?? "", { studentId: other.student.id, lines: [exam] })).rejects.toMatchObject({ status: 409 });
    await expect(edit(issued.id, { studentId: kid, lines: [exam] })).rejects.toMatchObject({ status: 409 });
    expect(await linesOn(generatedDraft?.id ?? "")).toHaveLength(1);
    expect(await withTenant(T, (tx) => editScreen(tx, owner, generatedDraft?.id ?? ""))).toBeNull(); // the sheet opens on manual drafts only
    expect(await withTenant(T, (tx) => editScreen(tx, owner, issued.id))).toBeNull();
  });

  it("the nightly run never adds charges to a manual draft", async () => {
    const night = await student("Night Charge Kid");
    const e = await join(night.student.id, "Karate A", M0);
    const manual = await create({ studentId: night.student.id, lines: [exam] }); // dated NOW's day, as is the recurring charge
    // Fails as invoices 0 (the tuition line appended to the manual draft) if the draft were not left alone.
    expect(await gen(M1, [e])).toEqual({ invoices: 1, lines: 1, skipped: [] });
    expect((await linesOn(manual.id)).map((l) => [l.kind, l.billingKey])).toEqual([["exam", null]]);
    expect(await invoicesOf([night.student.id])).toHaveLength(2);
  });

  it("needs invoices:manage", async () => {
    await expect(create({ studentId: kid, lines: [exam] }, desk)).rejects.toMatchObject({ status: 403 });
    await expect(edit(uuidv7(), { studentId: kid, lines: [exam] }, desk)).rejects.toMatchObject({ status: 403 });
  });

  it("the payer must be one of the student's payers", async () => {
    const strangersMother = (await student("Strangers Kid")).guardian.id;
    await expect(create({ studentId: kid, payerGuardianId: strangersMother, lines: [exam] })).rejects.toMatchObject({ status: 400 });
  });

  it("an exam fee for one enrollment goes to that enrollment's payer; programs that disagree need a choice", async () => {
    const riya = await student("Riya Split");
    const father = await withTenant(T, (tx) => addFamilyMember(tx, owner, riya.student.id, { fullName: "Father Riya", phone: phoneNo(), relation: "father" }));
    const [karate, dance] = [await join(riya.student.id, "Karate A", M0), await join(riya.student.id, "Dance A", M0)];
    await setPayer(dance, father.id); // the mother pays Karate through the lead-guardian fallback
    expect((await create({ studentId: riya.student.id, lines: [{ ...exam, enrollmentId: dance }] })).payerGuardianId).toBe(father.id);
    expect((await create({ studentId: riya.student.id, lines: [{ ...exam, enrollmentId: karate }] })).payerGuardianId).toBe(riya.guardian.id);
    const both = [{ ...exam, enrollmentId: karate }, { ...exam, enrollmentId: dance }];
    await expect(create({ studentId: riya.student.id, lines: both })).rejects.toMatchObject({ status: 400 });
    expect((await create({ studentId: riya.student.id, payerGuardianId: father.id, lines: both })).payerGuardianId).toBe(father.id);
    // A program of another student can't be named.
    await expect(create({ studentId: kid, lines: [{ ...exam, enrollmentId: dance }] })).rejects.toMatchObject({ status: 400 });
  });

  it("the sheet lists the payers and programs, and the admission a plan already billed", async () => {
    const s = await student("Screen Kid");
    const e = await join(s.student.id, "Karate A", M1); // joins on NOW's day: tuition and admission on one invoice
    await gen(M1, [e]);
    const screen = () => withTenant(T, (tx) => createScreen(tx, owner, s.student.id));
    expect(await screen()).toMatchObject({
      student: { id: s.student.id, name: "Screen Kid", branchId: s.student.branchId },
      payers: [{ key: `guardian:${s.guardian.id}`, name: "Mother Screen Kid", relation: "Mother" }],
      defaultPayerKey: `guardian:${s.guardian.id}`,
      enrollments: [{ id: e, programId: program.karate, programName: "Karate", batchName: "Karate A", payerKey: `guardian:${s.guardian.id}` }],
      gst: false,
      admissionBilled: { [program.karate ?? ""]: "a draft invoice" },
    });
    const [draft] = await invoicesOf([s.student.id]);
    const [issued] = await withTenant(T, (tx) => issueInvoices(tx, owner, [draft?.id ?? ""], { now: NOW }));
    expect((await screen()).admissionBilled).toEqual({ [program.karate ?? ""]: issued?.number });
    await withTenant(T, (tx) => voidInvoice(tx, owner, issued?.id ?? "", { reason: "Entered twice" }, { now: NOW }));
    expect((await screen()).admissionBilled).toEqual({}); // a cancelled invoice bills nothing
    await expect(withTenant(T, (tx) => createScreen(tx, desk, s.student.id))).rejects.toMatchObject({ status: 403 });
  });
});
