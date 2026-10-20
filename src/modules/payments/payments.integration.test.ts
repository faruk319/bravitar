import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { allows } from "@/lib/auth/can";
import type { ScopedCtx } from "@/lib/auth/route";
import { auditLog } from "@/lib/db/audit";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { login, setPassword } from "@/modules/auth/service";
import { createProgram, insertBatch } from "@/modules/batches/repo";
import { insertEnrollment, updateEnrollment } from "@/modules/enrollments/repo";
import { insertInvoice, insertLines, insertPlan, updateInvoice } from "@/modules/fees/repo";
import { type Invoice, invoiceLines, invoices } from "@/modules/fees/schema";
import { issueInvoices, voidInvoice } from "@/modules/fees/service";
import { allocateNumber } from "@/modules/numbering/repo";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { collectionRegister } from "@/modules/reports/service";
import { payerKey } from "@/modules/students/payer";
import { createGuardian, guardiansOfMembers, insertStudent, removeFamilyLink, upsertFamilyLink } from "@/modules/students/repo";
import { addFamilyMember } from "@/modules/students/family";
import { guardians, students } from "@/modules/students/schema";
import { createStudent } from "@/modules/students/service";
import { createBranch, updateOwnTenant } from "@/modules/tenancy/repo";
import { testAcademy } from "@/lib/db/isolation/academy";
import { collectedByMonth, familyContact, insertPayment } from "./repo";
import { applyAdvanceRoute, cancelPaymentRoute, recordPaymentRoute, refundPaymentRoute } from "./routes";
import { type Payment, paymentAllocations, payments, refunds } from "./schema";
import {
  applyAdvanceNow,
  cancelPayment,
  collectedToday,
  collectScreen,
  collectTarget,
  collectionSheet,
  familyAccount,
  invoiceMoney,
  myReceiptsToday,
  type PaymentInput,
  receipt,
  recordGatewayPayment,
  recordPayment,
  refundPayment,
} from "./service";

// docs/04 "Test list": the database guards under the payments code
// (migration 0015) in academy G, and the payments service in academy T, where
// the ledger must add up after every test.

const stamp = Math.random().toString(36).slice(2, 8);
const DENIED = "42501"; // insufficient_privilege
const CHECK = "23514"; // check_violation
const UNIQUE = "23505"; // unique_violation
const NOT_NULL = "23502"; // not_null_violation

function sqlState(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
}
const fails = (code: string) => (e: unknown) => sqlState(e) === code;

const made: string[] = [];
const academy = async (key: string) => {
  const t = await testAcademy({ name: `Payments ${key} ${stamp}`, slug: `pay-${key}-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `pay-${key}-${stamp}@example.test` } });
  made.push(t.tenant.id);
  return t;
};

beforeAll(async () => {
});

afterAll(async () => {
  await deleteTenantsCompletely(made);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

// ---- the database guards, run as app_runtime straight against the tables

describe("at the database", () => {
  const G = { tenant: "", branch: "", owner: "", guardian: "", student: "" };
  let n = 0;

  const newPayment = (extra: Partial<typeof payments.$inferInsert> = {}): Promise<Payment> =>
    withTenant(G.tenant, async (tx) => {
      return insertPayment(tx, { tenantId: G.tenant, branchId: G.branch, receiptNumber: `RCT/TEST/${++n}`, fy: "2026-27", method: "cash", amountPaise: 150_000n, receivedOn: "2026-09-24", recordedOn: "2026-09-24", receivedBy: G.owner, billToName: "Payer", ...extra });
    });

  const issuedInvoice = (totalPaise: bigint): Promise<Invoice> =>
    withTenant(G.tenant, async (tx) => {
      const inv = await insertInvoice(tx, { tenantId: G.tenant, branchId: G.branch, studentId: G.student, issueDate: "2026-09-01", dueDate: "2026-09-08", subtotalPaise: totalPaise, totalPaise });
      return updateInvoice(tx, inv.id, { number: `INV/TEST/${++n}`, fy: "2026-27", status: "issued", issuedAt: new Date() });
    });

  beforeAll(async () => {
    const t = await academy("g");
    Object.assign(G, { tenant: t.tenant.id, branch: t.branch.id, owner: t.owner.id });
    G.guardian = (await withTenant(G.tenant, (tx) => createGuardian(tx, { tenantId: G.tenant, fullName: "Deshmukh", phone: "+919876500777" }))).id;
    G.student = (await withTenant(G.tenant, (tx) => insertStudent(tx, { tenantId: G.tenant, branchId: G.branch, fullName: "Kid", code: "DB/KID" }))).id;
  });

  describe("a payment", () => {
    it("never changes its amount, method, dates, payer, branch, collector, receipt number or balance after", async () => {
      const p = await newPayment();
      const patches: Partial<typeof payments.$inferInsert>[] = [
        { amountPaise: 1n },
        { method: "upi" },
        { receiptNumber: "RCT/TEST/edited" },
        { receivedOn: "2026-09-20" },
        { recordedOn: "2026-09-25" },
        { payerGuardianId: G.guardian },
        { branchId: G.branch },
        { receivedBy: null },
        { balanceAfterPaise: 1n },
      ];
      for (const patch of patches) {
        await expect(withTenant(G.tenant, (tx) => tx.update(payments).set(patch).where(eq(payments.id, p.id))), JSON.stringify(Object.keys(patch))).rejects.toSatisfy(fails(DENIED));
      }
      await expect(withTenant(G.tenant, (tx) => tx.delete(payments).where(eq(payments.id, p.id)))).rejects.toSatisfy(fails(DENIED));
    });

    it("can be cancelled, but only with who, when and why", async () => {
      const p = await newPayment();
      const cancel = (patch: Partial<typeof payments.$inferInsert>) => withTenant(G.tenant, (tx) => tx.update(payments).set(patch).where(eq(payments.id, p.id)).returning());
      await expect(cancel({ status: "cancelled" })).rejects.toSatisfy(fails(CHECK));
      await expect(cancel({ status: "cancelled", cancelledAt: new Date(), cancelledBy: G.owner })).rejects.toSatisfy(fails(CHECK));
      await expect(cancel({ status: "cancelled", cancelledAt: new Date(), cancelledBy: G.owner, cancelReason: "  " })).rejects.toSatisfy(fails(CHECK));
      await expect(cancel({ cancelReason: "Not actually cancelled" })).rejects.toSatisfy(fails(CHECK));
      const [done] = await cancel({ status: "cancelled", cancelledAt: new Date(), cancelledBy: G.owner, cancelReason: "Typed 1,500 for 150" });
      expect(done?.status).toBe("cancelled");
    });

    it("is never received after the day it was recorded", async () => {
      await expect(newPayment({ receivedOn: "2026-09-25", recordedOn: "2026-09-24" })).rejects.toSatisfy(fails(CHECK));
      expect((await newPayment({ receivedOn: "2026-09-17", recordedOn: "2026-09-24" })).receivedOn).toBe("2026-09-17");
    });

    it("is one payment per request id, and one per receipt number", async () => {
      const requestId = uuidv7();
      await newPayment({ requestId });
      await expect(newPayment({ requestId })).rejects.toSatisfy(fails(UNIQUE));
      await newPayment({ receiptNumber: "RCT/TEST/same" });
      await expect(newPayment({ receiptNumber: "RCT/TEST/same" })).rejects.toSatisfy(fails(UNIQUE));
    });

    it("refuses a zero or negative amount", async () => {
      await expect(newPayment({ amountPaise: 0n })).rejects.toSatisfy(fails(CHECK));
      await expect(newPayment({ amountPaise: -100n })).rejects.toSatisfy(fails(CHECK));
    });

    it("records its balance after as zero or more, or leaves it empty", async () => {
      await expect(newPayment({ balanceAfterPaise: -1n })).rejects.toSatisfy(fails(CHECK));
      expect((await newPayment({ balanceAfterPaise: 0n })).balanceAfterPaise).toBe(0n);
      expect((await newPayment()).balanceAfterPaise).toBeNull();
    });
  });

  describe("allocations and refunds", () => {
    it("never cross payers, and a payment always carries its name", async () => {
      const mine = await withTenant(G.tenant, (tx) => insertInvoice(tx, { tenantId: G.tenant, branchId: G.branch, studentId: G.student, payerGuardianId: G.guardian, issueDate: "2026-09-01", dueDate: "2026-09-08", subtotalPaise: 1_000n, totalPaise: 1_000n }));
      const theirs = await newPayment({ payerMemberId: G.student });
      const alloc = (paymentId: string, invoiceId: string) =>
        withTenant(G.tenant, (tx) => tx.insert(paymentAllocations).values({ id: uuidv7(), tenantId: G.tenant, paymentId, invoiceId, kind: "receipt", amountPaise: 100n }));
      await expect(alloc(theirs.id, mine.id)).rejects.toSatisfy(fails(CHECK));
      await expect(alloc((await newPayment()).id, mine.id)).rejects.toSatisfy(fails(CHECK));
      await alloc((await newPayment({ payerGuardianId: G.guardian })).id, mine.id);
      await expect(newPayment({ billToName: null } as unknown as Partial<typeof payments.$inferInsert>)).rejects.toSatisfy(fails(NOT_NULL));
    });

    it("a name is more than whitespace", async () => {
      await expect(newPayment({ billToName: "  " })).rejects.toSatisfy(fails(CHECK));
    });

    it("an invoice's payer is fixed once money is allocated, and free before", async () => {
      const inv = await withTenant(G.tenant, (tx) => insertInvoice(tx, { tenantId: G.tenant, branchId: G.branch, studentId: G.student, payerGuardianId: G.guardian, issueDate: "2026-09-01", dueDate: "2026-09-08", subtotalPaise: 1_000n, totalPaise: 1_000n }));
      const repayer = (patch: Partial<typeof invoices.$inferInsert>) => withTenant(G.tenant, (tx) => updateInvoice(tx, inv.id, patch));
      await repayer({ payerGuardianId: null, payerMemberId: G.student });
      await repayer({ payerMemberId: null, payerGuardianId: G.guardian });
      const p = await newPayment({ payerGuardianId: G.guardian });
      await withTenant(G.tenant, (tx) => tx.insert(paymentAllocations).values({ id: uuidv7(), tenantId: G.tenant, paymentId: p.id, invoiceId: inv.id, kind: "receipt", amountPaise: 100n }));
      await expect(repayer({ payerGuardianId: null, payerMemberId: G.student })).rejects.toSatisfy(fails(CHECK));
      await repayer({ billToName: "Renamed" }); // only the payer is frozen
    });

    it("a member pays only for themselves; another's invoice needs them as a guardian", async () => {
      const other = await withTenant(G.tenant, (tx) => insertStudent(tx, { tenantId: G.tenant, branchId: G.branch, fullName: "Sibling", code: `DB/SIB${++n}` }));
      const raise = (payerMemberId: string) => withTenant(G.tenant, (tx) => insertInvoice(tx, { tenantId: G.tenant, branchId: G.branch, studentId: G.student, payerMemberId, issueDate: "2026-09-01", dueDate: "2026-09-08", subtotalPaise: 1_000n, totalPaise: 1_000n }));
      await expect(raise(other.id)).rejects.toSatisfy(fails(CHECK));
      await raise(G.student);
    });

    it("are append-only", async () => {
      const p = await newPayment();
      const inv = await issuedInvoice(150_000n);
      const [a] = await withTenant(G.tenant, (tx) => tx.insert(paymentAllocations).values({ id: uuidv7(), tenantId: G.tenant, paymentId: p.id, invoiceId: inv.id, kind: "receipt", amountPaise: 150_000n }).returning());
      const [r] = await withTenant(G.tenant, (tx) =>
        tx.insert(refunds).values({ id: uuidv7(), tenantId: G.tenant, paymentId: p.id, amountPaise: 500n, method: "cash", reason: "Paid twice", refundedOn: "2026-09-24", approvedBy: G.owner }).returning(),
      );
      const aid = a?.id ?? "";
      const rid = r?.id ?? "";
      await expect(withTenant(G.tenant, (tx) => tx.update(paymentAllocations).set({ amountPaise: 1n }).where(eq(paymentAllocations.id, aid)))).rejects.toSatisfy(fails(DENIED));
      await expect(withTenant(G.tenant, (tx) => tx.delete(paymentAllocations).where(eq(paymentAllocations.id, aid)))).rejects.toSatisfy(fails(DENIED));
      await expect(withTenant(G.tenant, (tx) => tx.update(refunds).set({ amountPaise: 1n }).where(eq(refunds.id, rid)))).rejects.toSatisfy(fails(DENIED));
      await expect(withTenant(G.tenant, (tx) => tx.delete(refunds).where(eq(refunds.id, rid)))).rejects.toSatisfy(fails(DENIED));
    });

    it("put money on with a positive amount, take it back with a negative one, and a refund row names its refund", async () => {
      const p = await newPayment();
      const inv = await issuedInvoice(150_000n);
      const [r] = await withTenant(G.tenant, (tx) => tx.insert(refunds).values({ id: uuidv7(), tenantId: G.tenant, paymentId: p.id, amountPaise: 500n, method: "cash", reason: "Test", refundedOn: "2026-09-24" }).returning());
      const allocate = (kind: (typeof paymentAllocations.$inferInsert)["kind"], amountPaise: bigint, refundId?: string) =>
        withTenant(G.tenant, (tx) => tx.insert(paymentAllocations).values({ id: uuidv7(), tenantId: G.tenant, paymentId: p.id, invoiceId: inv.id, kind, amountPaise, ...(refundId ? { refundId } : {}) }));
      await expect(allocate("receipt", -100n)).rejects.toSatisfy(fails(CHECK));
      await expect(allocate("advance", -100n)).rejects.toSatisfy(fails(CHECK));
      await expect(allocate("void", 100n)).rejects.toSatisfy(fails(CHECK));
      await expect(allocate("cancel", 100n)).rejects.toSatisfy(fails(CHECK));
      await expect(allocate("receipt", 0n)).rejects.toSatisfy(fails(CHECK));
      await expect(allocate("refund", -500n)).rejects.toSatisfy(fails(CHECK));
      await expect(allocate("void", -100n, r?.id)).rejects.toSatisfy(fails(CHECK));
      await allocate("refund", -500n, r?.id);
    });

    it("a refund needs a reason and a positive amount", async () => {
      const p = await newPayment();
      const refund = (reason: string, amountPaise: bigint) => withTenant(G.tenant, (tx) => tx.insert(refunds).values({ id: uuidv7(), tenantId: G.tenant, paymentId: p.id, amountPaise, method: "cash", reason, refundedOn: "2026-09-24" }));
      await expect(refund("  ", 500n)).rejects.toSatisfy(fails(CHECK));
      await expect(refund("Overpaid", 0n)).rejects.toSatisfy(fails(CHECK));
    });
  });

  describe("an invoice's status follows what is paid (docs/02 §9 invariant 4)", () => {
    it("is never paid above its total, or below zero", async () => {
      const inv = await issuedInvoice(150_000n);
      const set = (patch: Partial<typeof invoices.$inferInsert>) => withTenant(G.tenant, (tx) => updateInvoice(tx, inv.id, patch));
      await expect(set({ paidPaise: 150_001n, status: "paid" })).rejects.toSatisfy(fails(CHECK));
      await expect(set({ paidPaise: -1n })).rejects.toSatisfy(fails(CHECK));
    });

    it("issued, part paid, paid and void each match the amount paid", async () => {
      const inv = await issuedInvoice(150_000n);
      const set = (patch: Partial<typeof invoices.$inferInsert>) => withTenant(G.tenant, (tx) => updateInvoice(tx, inv.id, patch));
      await expect(set({ paidPaise: 80_000n })).rejects.toSatisfy(fails(CHECK));
      expect((await set({ paidPaise: 80_000n, status: "part_paid" })).status).toBe("part_paid");
      await expect(set({ paidPaise: 150_000n })).rejects.toSatisfy(fails(CHECK));
      expect((await set({ paidPaise: 150_000n, status: "paid" })).status).toBe("paid");
      await expect(set({ paidPaise: 0n })).rejects.toSatisfy(fails(CHECK));
      await expect(set({ status: "void", voidReason: "Money still on it" })).rejects.toSatisfy(fails(CHECK));
      expect((await set({ paidPaise: 0n, status: "void", voidReason: "Released to the advance" })).status).toBe("void");
    });

    it("a draft can hold no money", async () => {
      const draft = await withTenant(G.tenant, (tx) => insertInvoice(tx, { tenantId: G.tenant, branchId: G.branch, studentId: G.student, issueDate: "2026-09-01", dueDate: "2026-09-08", subtotalPaise: 1_000n, totalPaise: 1_000n }));
      await expect(withTenant(G.tenant, (tx) => updateInvoice(tx, draft.id, { paidPaise: 500n }))).rejects.toSatisfy(fails(CHECK));
    });
  });
});

// ---- the payments service

describe("payments", () => {
  const NOW = new Date("2026-09-24T06:00:00Z"); // 11:30 in India
  const FY = "2026-27";
  let T = "";
  let main = "";
  let other = "";
  let owner: ScopedCtx;
  let desk: ScopedCtx;
  let desk2: ScopedCtx;
  let teacher: ScopedCtx;
  let families = 0;

  const rupees = (n: number) => BigInt(n) * 100n;
  const seq = (p: Payment) => Number(p.receiptNumber.split("/").at(-1));
  const ctxFor = async (staffId: string): Promise<ScopedCtx> => {
    const [base, branchIds] = await withTenant(T, async (tx) => [await loadAccessContext(tx, staffId), await staffBranchIds(tx, staffId)] as const);
    return { ...base, branchIds };
  };
  const hire = async (name: string, role: string): Promise<ScopedCtx> => {
    const roleId = (await withTenant(T, listRoles)).find((r) => r.name === role)?.id ?? "";
    return ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `${name}-${stamp}@example.test`, fullName: name, roleId }))).id);
  };
  // A member (the handle is their id) and their mother, who is the payer of everything billed to them.
  const payerOfFamily = new Map<string, string>();
  const nameOfKid = new Map<string, string>();
  const name = (kid: string) => nameOfKid.get(kid) ?? "";
  const family = async () => {
    const n = ++families;
    const c = await withTenant(T, (tx) => createStudent(tx, owner, { fullName: `Child ${n}`, guardian: { fullName: `Mother ${n}`, phone: `98765 ${40_000 + n}`, relation: "mother" }, consents: { dataProcessing: true } }));
    payerOfFamily.set(c.student.id, c.guardian.id);
    nameOfKid.set(c.student.id, c.student.fullName);
    return c.student.id;
  };
  // An issued invoice with a real number from the series.
  const bill = (memberId: string, amount: number, dueDate = "2026-09-10", branchId = main, who: { payerGuardianId: string | null; payerMemberId?: string } = { payerGuardianId: payerOfFamily.get(memberId) ?? null }): Promise<Invoice> =>
    withTenant(T, async (tx) => {
      const total = rupees(amount);
      const inv = await insertInvoice(tx, { tenantId: T, branchId, studentId: memberId, ...who, billToName: "Mother", issueDate: "2026-09-01", dueDate, subtotalPaise: total, totalPaise: total });
      return updateInvoice(tx, inv.id, { number: await allocateNumber(tx, T, "invoice", FY), fy: FY, status: "issued", issuedAt: NOW });
    });
  const draftBill = (memberId: string, amount: number, dueDate: string, payerGuardianId = payerOfFamily.get(memberId) ?? null): Promise<Invoice> =>
    withTenant(T, (tx) => insertInvoice(tx, { tenantId: T, branchId: main, studentId: memberId, payerGuardianId, issueDate: "2026-09-01", dueDate, subtotalPaise: rupees(amount), totalPaise: rupees(amount) }));
  const pay = (memberId: string, amount: number, extra: Partial<PaymentInput> = {}, as: ScopedCtx = desk, now = NOW): Promise<Payment> =>
    withTenant(T, async (tx) => recordPayment(tx, as, { requestId: uuidv7(), memberId, branchId: main, amountPaise: String(rupees(amount)), ...extra }, { now }));
  const refund = (paymentId: string, amount: number, extra: { reason?: string; invoiceId?: string } = {}, as: ScopedCtx = owner) =>
    withTenant(T, (tx) => refundPayment(tx, as, paymentId, { amountPaise: String(rupees(amount)), reason: extra.reason ?? "Refund", ...(extra.invoiceId ? { invoiceId: extra.invoiceId } : {}) }, { now: NOW }));
  const cancel = (paymentId: string, as: ScopedCtx, now = NOW) => withTenant(T, (tx) => cancelPayment(tx, as, paymentId, { reason: "Wrong entry" }, { now }));
  const state = async (id: string) => {
    const [i] = await withTenant(T, (tx) => tx.select().from(invoices).where(eq(invoices.id, id)));
    return [i?.status, i?.paidPaise];
  };
  const advanceOf = async (memberId: string, branchId = main) => (await withTenant(T, (tx) => familyAccount(tx, desk, memberId, branchId))).advancePaise;
  const receiptOf = (id: string) => withTenant(T, (tx) => receipt(tx, desk, id));
  const actions = async (entityId: string) => (await withTenant(T, (tx) => tx.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, entityId)))).map((r) => r.a).sort();

  // docs/02 §9 invariants 1 and 2, and the ledger's own rules, over the whole academy.
  // The last query is deliberate: a member paying a sibling's invoice IS a violation (decided 2026-10-08;
  // staff add the payer as a guardian instead). Do not relax it. It reads live links (removed_at IS NULL),
  // so removing a guardian later would flag an old allocation: fine in a test, unsafe as a runtime guard.
  async function ledgerHolds(): Promise<void> {
    const problems = await withTenant(T, (tx) =>
      tx.execute<{ problem: string }>(sql`
        SELECT 'invoice ' || coalesce(i.number, i.id::text) || ': paid is not the sum of its allocations' AS problem FROM app.invoices i
         WHERE i.paid_paise <> (SELECT coalesce(sum(a.amount_paise), 0) FROM app.payment_allocations a WHERE a.invoice_id = i.id)
        UNION ALL
        SELECT 'payment ' || p.receipt_number || ': allocations and refunds exceed it' FROM app.payments p
         WHERE (SELECT coalesce(sum(a.amount_paise), 0) FROM app.payment_allocations a WHERE a.payment_id = p.id)
             + (SELECT coalesce(sum(r.amount_paise), 0) FROM app.refunds r WHERE r.payment_id = p.id) > p.amount_paise
        UNION ALL
        SELECT 'payment ' || p.receipt_number || ': cancelled with money on invoices' FROM app.payments p
         WHERE p.status = 'cancelled' AND (SELECT coalesce(sum(a.amount_paise), 0) FROM app.payment_allocations a WHERE a.payment_id = p.id) <> 0
        UNION ALL
        SELECT 'allocation ' || a.payment_id || ' on ' || a.invoice_id || ': below zero' FROM app.payment_allocations a
         GROUP BY a.payment_id, a.invoice_id HAVING sum(a.amount_paise) < 0
        UNION ALL
        SELECT 'allocation ' || a.id || ': another payer or branch' FROM app.payment_allocations a
          JOIN app.payments p ON p.id = a.payment_id JOIN app.invoices i ON i.id = a.invoice_id
         WHERE p.branch_id <> i.branch_id
            OR p.payer_guardian_id IS DISTINCT FROM i.payer_guardian_id OR p.payer_member_id IS DISTINCT FROM i.payer_member_id
        UNION ALL
        SELECT 'allocation ' || a.id || ': the invoice is for a member the payment could not have been recorded for' FROM app.payment_allocations a
          JOIN app.payments p ON p.id = a.payment_id JOIN app.invoices i ON i.id = a.invoice_id
         WHERE NOT EXISTS (
           SELECT 1 FROM app.students x
            WHERE (x.id = p.payer_member_id OR x.id IN (SELECT g.student_id FROM app.student_guardians g WHERE g.guardian_id = p.payer_guardian_id AND g.removed_at IS NULL))
              AND (x.id = i.student_id OR EXISTS (SELECT 1 FROM app.student_guardians l JOIN app.student_guardians r ON r.guardian_id = l.guardian_id
                                                   WHERE l.student_id = x.id AND r.student_id = i.student_id AND l.removed_at IS NULL AND r.removed_at IS NULL)))
      `),
    );
    expect(problems.map((p) => p.problem)).toEqual([]);
  }

  beforeAll(async () => {
    const t = await academy("t");
    T = t.tenant.id;
    main = t.branch.id;
    owner = await ctxFor(t.owner.id);
    desk = await hire("Priya", "Front Desk");
    desk2 = await hire("Amit", "Front Desk");
    teacher = await hire("Coach", "Teacher");
    other = (await withTenant(T, (tx) => createBranch(tx, { tenantId: T, name: "Second branch" }))).id;
  });

  afterEach(ledgerHolds);

  describe("recording", () => {
    it("₹1,500 invoice, ₹800 then ₹700: part paid, then paid with nothing left over", async () => {
      const h = await family();
      const inv = await bill(h, 1500);
      await pay(h, 800);
      expect(await state(inv.id)).toEqual(["part_paid", rupees(800)]);
      await pay(h, 700);
      expect(await state(inv.id)).toEqual(["paid", rupees(1500)]);
      expect(await advanceOf(h)).toBe(0n);
    });

    it("₹1,000 against a ₹1,500 invoice leaves it part paid with ₹500 outstanding", async () => {
      const h = await family();
      const inv = await bill(h, 1500);
      await pay(h, 1000);
      const account = await withTenant(T, (tx) => familyAccount(tx, desk, h, main));
      expect(account.open.map((o) => [o.id, o.status, o.balancePaise])).toEqual([[inv.id, "part_paid", rupees(500)]]);
    });

    it("₹3,000 pays two siblings' ₹1,500 invoices", async () => {
      const h = await family();
      const [a, b] = [await bill(h, 1500), await bill(h, 1500)];
      await pay(h, 3000);
      expect([await state(a.id), await state(b.id)]).toEqual([
        ["paid", rupees(1500)],
        ["paid", rupees(1500)],
      ]);
    });

    it("over-payment stays as the family's advance: ₹2,000 on ₹1,500, and ₹5,000 on ₹3,000", async () => {
      const h = await family();
      await bill(h, 1500);
      await pay(h, 2000);
      expect(await advanceOf(h)).toBe(rupees(500));
      const h2 = await family();
      await bill(h2, 1500);
      await bill(h2, 1500);
      await pay(h2, 5000);
      expect(await advanceOf(h2)).toBe(rupees(2000));
      expect((await withTenant(T, (tx) => familyAccount(tx, desk, h2, main))).open).toEqual([]);
    });

    it("with nothing picked, the earliest due date goes first, then the lower number", async () => {
      const h = await family();
      const later = await bill(h, 1500, "2026-09-20");
      const first = await bill(h, 1500, "2026-09-05");
      const second = await bill(h, 1500, "2026-09-05");
      await pay(h, 2000);
      expect([await state(first.id), await state(second.id), await state(later.id)]).toEqual([
        ["paid", rupees(1500)],
        ["part_paid", rupees(500)],
        ["issued", 0n],
      ]);
    });

    it("picked invoices get the money; the rest is advance, even with another still open", async () => {
      const h = await family();
      const older = await bill(h, 1500, "2026-09-05");
      const newer = await bill(h, 1500, "2026-09-20");
      await pay(h, 2000, { allocations: [{ invoiceId: newer.id, amountPaise: "150000" }] });
      expect([await state(older.id), await state(newer.id)]).toEqual([
        ["issued", 0n],
        ["paid", rupees(1500)],
      ]);
      expect(await advanceOf(h)).toBe(rupees(500));
    });

    it("refuses picks above the payment or above a balance, and uses no receipt number", async () => {
      const h = await family();
      const [a, b] = [await bill(h, 1500), await bill(h, 1500)];
      const before = await pay(h, 1);
      await expect(
        pay(h, 1000, {
          allocations: [
            { invoiceId: a.id, amountPaise: "80000" },
            { invoiceId: b.id, amountPaise: "80000" },
          ],
        }),
      ).rejects.toThrow("add up to more than the payment");
      await expect(pay(h, 2000, { allocations: [{ invoiceId: a.id, amountPaise: "150001" }] })).rejects.toThrow("more than the invoice's balance");
      expect(seq(await pay(h, 1))).toBe(seq(before) + 1);
    });

    it("refuses a draft, a void, a paid invoice, another family's, and another branch's", async () => {
      const h = await family();
      const draft = await draftBill(h, 1500, "2026-10-10");
      const voided = await bill(h, 1500);
      await withTenant(T, (tx) => voidInvoice(tx, owner, voided.id, { reason: "Wrong fee" }));
      const paid = await bill(h, 500);
      await pay(h, 500);
      expect(await state(paid.id)).toEqual(["paid", rupees(500)]);
      const theirs = await bill(await family(), 1500);
      const elsewhere = await bill(h, 1500, "2026-09-10", other);
      for (const inv of [draft, voided, paid, theirs, elsewhere]) {
        await expect(pay(h, 100, { allocations: [{ invoiceId: inv.id, amountPaise: "10000" }] })).rejects.toThrow("isn't open for this family");
      }
    });

    it("takes a received date from today back 7 days, never later, never before the financial year", async () => {
      const h = await family();
      expect((await pay(h, 10)).receivedOn).toBe("2026-09-24");
      expect((await pay(h, 10, { receivedOn: "2026-09-17" })).receivedOn).toBe("2026-09-17");
      await expect(pay(h, 10, { receivedOn: "2026-09-16" })).rejects.toThrow("Only up to 7 days back");
      await expect(pay(h, 10, { receivedOn: "2026-09-25" })).rejects.toThrow("can't be in the future");
      const april = new Date("2027-04-03T06:00:00Z");
      await expect(pay(h, 10, { receivedOn: "2027-03-31" }, desk, april)).rejects.toThrow("Not before this financial year began");
      const p = await pay(h, 10, { receivedOn: "2027-04-01" }, desk, april);
      expect([p.receivedOn, p.recordedOn, p.fy, p.receiptNumber]).toEqual(["2027-04-01", "2027-04-03", "2027-28", "RCT/2027-28/0001"]);
    });

    it("a family's advance pays its next invoice when that is issued", async () => {
      const h = await family();
      await bill(h, 1500);
      await pay(h, 2000);
      const next = await draftBill(h, 1500, "2026-10-10");
      await withTenant(T, (tx) => issueInvoices(tx, owner, [next.id], { now: NOW }));
      expect(await state(next.id)).toEqual(["part_paid", rupees(500)]);
      expect(await advanceOf(h)).toBe(0n);
      expect(await actions(next.id)).toContain("payment.apply_advance");
    });

    it("voiding an invoice with ₹800 on it makes the ₹800 advance again; the receipt stays; both are audited", async () => {
      const h = await family();
      const inv = await bill(h, 1500);
      const p = await pay(h, 800);
      const before = await receiptOf(p.id);
      await withTenant(T, (tx) => voidInvoice(tx, owner, inv.id, { reason: "Billed twice" }));
      expect(await state(inv.id)).toEqual(["void", 0n]);
      expect(await advanceOf(h)).toBe(rupees(800));
      expect(await receiptOf(p.id)).toEqual(before);
      expect(await actions(inv.id)).toEqual(expect.arrayContaining(["invoice.void", "payment.release"]));
    });

    it("the same request id twice, even at the same moment, is one payment with one number", async () => {
      const h = await family();
      await bill(h, 1500);
      const requestId = uuidv7();
      const [a, b] = await Promise.all([pay(h, 1500, { requestId }), pay(h, 1500, { requestId }, desk2)]);
      expect(b.id).toBe(a.id);
      expect((await pay(h, 1500, { requestId })).id).toBe(a.id);
      expect(await withTenant(T, (tx) => tx.select({ id: payments.id }).from(payments).where(eq(payments.requestId, requestId)))).toHaveLength(1);
      expect(seq(await pay(h, 10))).toBe(seq(a) + 1);
      await expect(pay(h, 999, { requestId })).rejects.toThrow("already used for a different payment");
    });

    it("two payments for one invoice at the same moment never pay it twice", async () => {
      const h = await family();
      const inv = await bill(h, 1500);
      await Promise.all([pay(h, 1500), pay(h, 1500, {}, desk2)]);
      expect(await state(inv.id)).toEqual(["paid", rupees(1500)]);
      expect(await advanceOf(h)).toBe(rupees(1500));
    });

    it("needs fees:collect", async () => {
      const h = await family();
      await expect(pay(h, 100, {}, teacher)).rejects.toMatchObject({ status: 403 });
    });

    it("card can be recorded by hand; online cannot", async () => {
      const h = await family();
      await expect(pay(h, 500, { method: "card" })).resolves.toMatchObject({ method: "card" });
      await expect(pay(h, 500, { method: "online" as never })).rejects.toMatchObject({ issues: [{ path: ["method"] }] });
    });
  });

  describe("receipts and numbering", () => {
    it("50 payments at once take 50 consecutive numbers: no gap, no duplicate", async () => {
      const hs = await Promise.all(Array.from({ length: 10 }, () => family()));
      const done = await Promise.all(Array.from({ length: 50 }, (_, i) => pay(hs[i % 10] ?? "", 100, {}, i % 2 ? desk : desk2)));
      const numbers = done.map(seq).sort((a, b) => a - b);
      expect(new Set(numbers).size).toBe(50);
      expect((numbers.at(-1) ?? 0) - (numbers[0] ?? 0)).toBe(49);
    });

    it("a payment that fails and rolls back gives its number back", async () => {
      const h = await family();
      const first = await pay(h, 100);
      await withTenant(T, async (tx) => {
        await recordPayment(tx, desk, { requestId: uuidv7(), memberId: h, branchId: main, amountPaise: "10000" }, { now: NOW });
        throw new Error("printer jammed");
      }).catch(() => {});
      expect(seq(await pay(h, 100))).toBe(seq(first) + 1);
    });

    it("the receipt shows what the payment paid when it was recorded", async () => {
      const h = await family();
      const inv = await bill(h, 1500);
      const p = await pay(h, 2000, { method: "upi", reference: "UPI 4471" });
      const r = await receiptOf(p.id);
      expect(r.lines.map((l) => [l.number, l.amountPaise])).toEqual([[inv.number, rupees(1500)]]);
      expect([r.advancePaise, r.collectorName, r.payment.method, r.payment.reference]).toEqual([rupees(500), "Priya", "upi", "UPI 4471"]);
    });

    it("the receipt names what each invoice was for and whose it is", async () => {
      const kid = await family();
      const inv = await bill(kid, 1500);
      await withTenant(T, (tx) => insertLines(tx, [{ tenantId: T, invoiceId: inv.id, studentId: kid, kind: "tuition", description: "Karate Kids", periodStart: "2026-09-01", periodEnd: "2026-09-30", unitPaise: rupees(1500), amountPaise: rupees(1500) }]));
      const r = await receiptOf((await pay(kid, 1500)).id);
      expect(r.lines[0]?.items[0]).toMatchObject({ description: "Karate Kids", studentName: name(kid), periodStart: "2026-09-01", periodEnd: "2026-09-30" });
      expect(r.students).toEqual([name(kid)]);
    });

    it("balance after counts the payer's other open invoices in the branch", async () => {
      const kid = await family();
      await bill(kid, 1500);
      await bill(kid, 1500);
      await bill(kid, 700, "2026-09-10", other); // another branch is another balance
      const p = await pay(kid, 1500);
      expect((await receiptOf(p.id)).balanceAfterPaise).toBe(150_000n);
    });

    it("balance after counts the payer's members who are no longer on the collect screen", async () => {
      const [a, b] = [await family(), await family()];
      const shared = payerOfFamily.get(a) ?? "";
      await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: b, guardianId: shared, relation: "mother" }));
      await bill(b, 700, "2026-09-10", main, { payerGuardianId: shared });
      await withTenant(T, (tx) => removeFamilyLink(tx, b, shared, NOW));
      await bill(a, 1500, "2026-09-10", main, { payerGuardianId: shared });
      const p = await pay(a, 1500, { payerGuardianId: shared });
      expect((await receiptOf(p.id)).balanceAfterPaise).toBe(70_000n);
    });

    it("an all-advance receipt names the payer's active children in its branch", async () => {
      const kid = await family();
      const r = await receiptOf((await pay(kid, 500)).id);
      expect(r.lines).toEqual([]);
      expect([r.advancePaise, r.students]).toEqual([rupees(500), [name(kid)]]);
      // A sibling who shares the payer but attends the other branch is named only on a receipt of that branch.
      const sibling = await withTenant(T, (tx) => insertStudent(tx, { tenantId: T, branchId: other, fullName: `Sibling of ${name(kid)}`, code: `PAY/SIB${++families}` }));
      await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: sibling.id, guardianId: payerOfFamily.get(kid) ?? "", relation: "mother" }));
      expect((await receiptOf((await pay(kid, 500)).id)).students).toEqual([name(kid)]);
      expect((await receiptOf((await pay(kid, 500, { branchId: other })).id)).students).toEqual([sibling.fullName]);
    });

    it("a later refund leaves the receipt's balance as recorded", async () => {
      const kid = await family();
      await bill(kid, 1500);
      await bill(kid, 1500);
      const p = await pay(kid, 1500);
      await refund(p.id, 500);
      expect((await receiptOf(p.id)).balanceAfterPaise).toBe(150_000n);
    });

    it("an online payment records its balance after too", async () => {
      const kid = await family();
      const inv = await bill(kid, 1500);
      const { payment: p } = await withTenant(T, (tx) => recordGatewayPayment(tx, { invoiceId: inv.id, gatewayPaymentId: `pay_${stamp}`, amountPaise: rupees(1500), capturedAt: NOW }, { now: NOW }));
      expect(p.balanceAfterPaise).toBe(0n);
    });
  });

  describe("a retried request and the scope of a collect screen", () => {
    // One child with two guardians, so nothing but the request says who paid.
    const twoGuardians = async () => {
      const h = await family();
      const dad = await withTenant(T, (tx) => addFamilyMember(tx, owner, h, { fullName: `Father ${h.slice(-4)}`, phone: `98766 ${String(40_000 + ++families)}`, relation: "father" }));
      return { h, mum: payerOfFamily.get(h) ?? "", dad: dad.id };
    };
    const count = async (requestId: string) => (await withTenant(T, (tx) => tx.select({ id: payments.id }).from(payments).where(eq(payments.requestId, requestId)))).length;

    it("a retry of a payment that paid its invoice off is the same payment, though nothing is left open to name the payer", async () => {
      const { h, dad } = await twoGuardians();
      const inv = await bill(h, 1500, "2026-09-10", main, { payerGuardianId: dad });
      const input = { requestId: uuidv7(), allocations: [{ invoiceId: inv.id, amountPaise: String(rupees(1500)) }] };
      const first = await pay(h, 1500, input);
      expect(first.payerGuardianId).toBe(dad);
      expect((await pay(h, 1500, input)).id).toBe(first.id);
      expect(await count(input.requestId)).toBe(1);
      expect(await state(inv.id)).toEqual(["paid", rupees(1500)]);
    });

    it("a retry that names the payer is the same payment; naming the other payer is a different one", async () => {
      const { h, mum, dad } = await twoGuardians();
      const requestId = uuidv7();
      const first = await pay(h, 700, { requestId, payerGuardianId: dad });
      expect((await pay(h, 700, { requestId, payerGuardianId: dad })).id).toBe(first.id);
      await expect(pay(h, 700, { requestId, payerGuardianId: mum })).rejects.toThrow("already used for a different payment");
      expect(await count(requestId)).toBe(1);
    });

    it("the same request for another family, branch or amount is a different payment, not a replay", async () => {
      const { h, dad } = await twoGuardians();
      const requestId = uuidv7();
      await pay(h, 700, { requestId, payerGuardianId: dad });
      await expect(pay(await family(), 700, { requestId })).rejects.toThrow("already used for a different payment");
      await expect(pay(h, 700, { requestId, branchId: other })).rejects.toThrow("already used for a different payment");
      await expect(pay(h, 701, { requestId })).rejects.toThrow("already used for a different payment");
      expect(await count(requestId)).toBe(1);
    });

    it("a guardian linked to a member of two families pays for either, and the advance is theirs on both screens", async () => {
      const [a, b, c] = [await family(), await family(), await family()];
      const shared = payerOfFamily.get(a) ?? "";
      await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: b, guardianId: shared, relation: "mother" }));
      const invB = await bill(b, 1000, "2026-09-10", main, { payerGuardianId: shared });
      // An unrelated family's mother cannot be asked for on A's screen, but the shared guardian can be on both.
      await expect(pay(a, 500, { payerGuardianId: payerOfFamily.get(c) ?? "" })).rejects.toMatchObject({ status: 400 });
      const p = await pay(b, 1500, { payerGuardianId: shared });
      expect(await state(invB.id)).toEqual(["paid", rupees(1000)]);
      expect([await advanceOf(a), await advanceOf(b)]).toEqual([rupees(500), rupees(500)]);
      expect(p.payerGuardianId).toBe(shared);
      // A and B are siblings through the shared guardian, so either screen lists both children's open invoices; C's stay off it.
      const invA = await bill(a, 300, "2026-09-10", main, { payerGuardianId: shared });
      const invB2 = await bill(b, 200, "2026-09-11", main, { payerGuardianId: shared });
      await bill(c, 400);
      const open = (h: string) => withTenant(T, async (tx) => (await familyAccount(tx, desk, h, main)).open.map((o) => o.id).sort());
      expect(await open(a)).toEqual([invA.id, invB2.id].sort());
      expect(await open(b)).toEqual([invA.id, invB2.id].sort());
    });

    it("a shared guardian paying with nothing ticked settles the screen's siblings oldest first, and never an unrelated family's", async () => {
      const [a, b, c] = [await family(), await family(), await family()];
      const shared = payerOfFamily.get(a) ?? "";
      await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: b, guardianId: shared, relation: "mother" }));
      const invB = await bill(b, 1000, "2026-09-01", main, { payerGuardianId: shared });
      const invA = await bill(a, 1000, "2026-09-10", main, { payerGuardianId: shared });
      const invC = await bill(c, 1000, "2026-09-05");
      const p = await pay(a, 1500, { payerGuardianId: shared });
      expect([await state(invB.id), await state(invA.id), await state(invC.id)]).toEqual([["paid", rupees(1000)], ["part_paid", rupees(500)], ["issued", 0n]]);
      expect((await withTenant(T, (tx) => tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, p.id)))).map((x) => [x.invoiceId, x.amountPaise]).sort()).toEqual([[invA.id, rupees(500)], [invB.id, rupees(1000)]].sort());
      expect(await advanceOf(a)).toBe(0n);
      // Ticking an unrelated family's invoice from this screen is refused.
      await expect(pay(a, 500, { payerGuardianId: shared, allocations: [{ invoiceId: invC.id, amountPaise: String(rupees(500)) }] })).rejects.toMatchObject({ status: 400 });
    });

    it("siblings are members who share a live guardian link: a removed link or an unknown member shares nothing", async () => {
      const [a, b] = [await family(), await family()];
      const shared = payerOfFamily.get(a) ?? "";
      const [childA, childB] = [a, b];
      const invB = await bill(b, 300, "2026-09-10", main, { payerGuardianId: shared });
      const openOn = async (m: string) => (await withTenant(T, (tx) => collectScreen(tx, desk, m, main, { now: NOW }))).payers.flatMap((p) => p.open.map((o) => o.id));
      expect(await openOn(childA)).toEqual([]);
      await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: childB, guardianId: shared, relation: "mother" }));
      expect(await openOn(childA)).toEqual([invB.id]);
      expect((await withTenant(T, (tx) => collectScreen(tx, desk, childA, main, { now: NOW }))).memberName).toMatch(/^Child/);
      await withTenant(T, (tx) => removeFamilyLink(tx, childB, shared, NOW));
      expect(await openOn(childA)).toEqual([]);
      await expect(withTenant(T, (tx) => recordPayment(tx, desk, { requestId: uuidv7(), memberId: uuidv7(), branchId: main, amountPaise: "100" }, { now: NOW }))).rejects.toMatchObject({ status: 404 });
    });

    it("a link goes to the payer; a member paying for themselves with no guardian gets their own name and number", async () => {
      const h = await family();
      const self = h;
      const byGuardian = await bill(h, 100, "2026-09-10");
      const [mum] = await withTenant(T, (tx) => guardiansOfMembers(tx, [self]));
      expect(await withTenant(T, (tx) => familyContact(tx, byGuardian))).toEqual({ name: mum?.fullName, phone: mum?.phone });
      const lone = await withTenant(T, (tx) => createStudent(tx, owner, { fullName: "Adult Gym", dateOfBirth: "1990-01-01", adultPhone: `98766 ${String(40_000 + ++families)}`, consents: { dataProcessing: true } }));
      await withTenant(T, (tx) => removeFamilyLink(tx, lone.student.id, lone.guardian.id, NOW));
      const byMember = await bill(lone.student.id, 100, "2026-09-10", main, { payerGuardianId: null, payerMemberId: lone.student.id });
      expect(await withTenant(T, (tx) => familyContact(tx, byMember))).toEqual({ name: "Adult Gym", phone: lone.student.phone });
    });
  });

  describe("the collect screen and using the advance", () => {
    const screen = (memberId: string, as: ScopedCtx = desk, branchId = main) => withTenant(T, (tx) => collectScreen(tx, as, memberId, branchId, { now: NOW }));
    const keyOf = (guardianId: string) => payerKey({ kind: "guardian", guardianId });
    const optionOf = (s: Awaited<ReturnType<typeof screen>>, guardianId: string) => s.payers.find((p) => p.key === keyOf(guardianId));
    const applyNow = (payerGuardianId: string, branchId: string, as: ScopedCtx = desk) => withTenant(T, (tx) => applyAdvanceNow(tx, as, { branchId, payerGuardianId }));
    // A father for the child, a guardian of their own: a second payer next to the mother.
    const addFather = (kid: string) =>
      withTenant(T, async (tx) => {
        const dad = await createGuardian(tx, { tenantId: T, fullName: "Father", phone: `+9198766${String(10_000 + ++families)}` });
        await upsertFamilyLink(tx, { tenantId: T, studentId: kid, guardianId: dad.id, relation: "father" });
        return dad.id;
      });
    const parents = async () => {
      const kid = await family();
      return { kid, mum: payerOfFamily.get(kid) ?? "", dad: await addFather(kid) };
    };
    const swim = { program: "", beginner: "", advanced: "", beginnerBatch: "", advancedBatch: "", otherBatch: "" };
    const enrol = (studentId: string, batchId: string, feePlanId: string) => withTenant(T, (tx) => insertEnrollment(tx, { tenantId: T, studentId, batchId, startDate: "2026-09-01", feePlanId }));

    beforeAll(async () => {
      await withTenant(T, async (tx) => {
        const program = await createProgram(tx, { tenantId: T, name: "Swimming", activityKey: "karate" });
        const plan = (name: string, billingCycle: "monthly" | "quarterly", amountPaise: bigint) => insertPlan(tx, { tenantId: T, name, kind: "recurring", billingCycle, amountPaise });
        const batch = (name: string, defaultFeePlanId: string, branchId: string) => insertBatch(tx, { tenantId: T, branchId, programId: program.id, name, defaultFeePlanId, startDate: "2026-01-01" });
        const [beginner, advanced] = [await plan("Swimming Beginner", "monthly", rupees(2000)), await plan("Swimming Advanced", "quarterly", rupees(6000))];
        Object.assign(swim, {
          program: program.id,
          beginner: beginner.id,
          advanced: advanced.id,
          beginnerBatch: (await batch("Beginner", beginner.id, main)).id,
          advancedBatch: (await batch("Advanced", advanced.id, main)).id,
          otherBatch: (await batch("Beginner (second branch)", beginner.id, other)).id,
        });
      });
    });

    it("a split-payer family lists each payer with only their own dues", async () => {
      const { kid, mum, dad } = await parents();
      await bill(kid, 1500, "2026-09-10", main, { payerGuardianId: mum });
      await bill(kid, 2000, "2026-09-12", main, { payerGuardianId: dad });
      const s = await screen(kid);
      expect(s.payers.map((p) => [p.name, p.open.map((o) => o.balancePaise)])).toEqual([
        ["Father", [rupees(2000)]],
        [expect.stringMatching(/^Mother /), [rupees(1500)]],
      ]);
      expect(s.defaultPayerKey).toBeNull();
    });

    it("one payer with dues is the default, and a payer with nothing is not listed", async () => {
      const { kid, mum } = await parents();
      await bill(kid, 1500, "2026-09-10", main, { payerGuardianId: mum });
      const s = await screen(kid);
      expect(s.defaultPayerKey).toBe(keyOf(mum));
      expect(s.payers.map((p) => p.key)).toEqual([keyOf(mum)]);
    });

    it("with nothing owed, the only guardian is the default, several guardians are all offered, and no guardian means the member", async () => {
      const { kid, mum, dad } = await parents();
      const solo = await family();
      const adult = await withTenant(T, (tx) => createStudent(tx, owner, { fullName: "Adult Gym", dateOfBirth: "1990-01-01", adultPhone: `98766 ${String(40_000 + ++families)}`, consents: { dataProcessing: true } }));
      await withTenant(T, (tx) => removeFamilyLink(tx, adult.student.id, adult.guardian.id, NOW));
      const [both, one, self] = [await screen(kid), await screen(solo), await screen(adult.student.id)];
      expect([both.defaultPayerKey, both.payers.map((p) => p.key)]).toEqual([null, [keyOf(dad), keyOf(mum)]]);
      expect([one.defaultPayerKey, one.payers.map((p) => p.key)]).toEqual([keyOf(payerOfFamily.get(solo) ?? ""), [keyOf(payerOfFamily.get(solo) ?? "")]]);
      expect([self.defaultPayerKey, self.payers.map((p) => [p.name, p.relation])]).toEqual([payerKey({ kind: "member", memberId: adult.student.id }), [["Adult Gym", null]]]);
    });

    it("a payer who holds advance is listed even when someone else is the one who owes", async () => {
      const { kid, mum, dad } = await parents();
      await pay(kid, 500, { payerGuardianId: mum });
      await bill(kid, 1000, "2026-09-10", main, { payerGuardianId: dad });
      const s = await screen(kid);
      expect(s.payers.map((p) => [p.key, p.advancePaise, p.open.length])).toEqual([[keyOf(dad), 0n, 1], [keyOf(mum), rupees(500), 0]]);
      expect(s.defaultPayerKey).toBe(keyOf(dad));
    });

    it("each payer carries their student plans, and the opened child's enrollments come with the screen", async () => {
      const { kid, mum, dad } = await parents();
      const monthly = await enrol(kid, swim.beginnerBatch, swim.beginner); // no payer of its own: the lead guardian, the mother, pays
      const quarterly = await enrol(kid, swim.advancedBatch, swim.advanced);
      await withTenant(T, (tx) => updateEnrollment(tx, quarterly.id, { payerGuardianId: dad }));
      await pay(kid, 500, { payerGuardianId: mum });
      await bill(kid, 1000, "2026-09-10", main, { payerGuardianId: dad });
      const s = await screen(kid);
      expect(optionOf(s, mum)).toMatchObject({
        relation: "Mother",
        advancePaise: rupees(500),
        open: [],
        plans: [{ enrollmentId: monthly.id, studentName: name(kid), programName: "Swimming", batchName: "Beginner", planName: "Swimming Beginner", kind: "recurring", cycle: "monthly", amountPaise: rupees(2000) }],
      });
      expect(optionOf(s, dad)).toMatchObject({ relation: "Father", advancePaise: 0n, plans: [{ enrollmentId: quarterly.id, batchName: "Advanced", planName: "Swimming Advanced", cycle: "quarterly", amountPaise: rupees(6000) }] });
      expect(s.enrollments).toEqual([
        { id: monthly.id, programId: swim.program, programName: "Swimming", batchName: "Beginner" },
        { id: quarterly.id, programId: swim.program, programName: "Swimming", batchName: "Advanced" },
      ]);
    });

    it("an open invoice says what it was for and for whom, from its lines", async () => {
      const kid = await family();
      const [month, quarter] = [await bill(kid, 1500, "2026-09-10"), await bill(kid, 3000, "2026-09-20")];
      const line = (invoiceId: string, description: string, unit: number, period: { periodStart: string; periodEnd: string } | { periodStart: null; periodEnd: null }) => ({
        tenantId: T,
        invoiceId,
        studentId: kid,
        kind: "tuition" as const,
        description,
        unitPaise: rupees(unit),
        amountPaise: rupees(unit),
        ...period,
      });
      await withTenant(T, (tx) =>
        insertLines(tx, [
          line(month.id, "Swimming Beginner", 1500, { periodStart: "2026-10-01", periodEnd: "2026-10-31" }),
          line(quarter.id, "Karate Quarterly", 2500, { periodStart: "2026-10-01", periodEnd: "2026-12-31" }),
          line(quarter.id, "Admission", 500, { periodStart: null, periodEnd: null }),
        ]),
      );
      const [first, second] = (await screen(kid)).payers.flatMap((p) => p.open);
      expect([first?.id, first?.description, first?.students]).toEqual([month.id, "Swimming Beginner · Oct 2026", [name(kid)]]);
      expect([second?.id, second?.description, second?.students]).toEqual([quarter.id, "Karate Quarterly · Oct – Dec 2026, Admission", [name(kid)]]);
    });

    it("a guardian's relation is to the opened child, else to a sibling's", async () => {
      const [a, b] = [await family(), await family()];
      const shared = payerOfFamily.get(a) ?? "";
      await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: b, guardianId: shared, relation: "grandparent" }));
      const dadOfB = await addFather(b);
      await bill(a, 300, "2026-09-10", main, { payerGuardianId: shared });
      await bill(b, 400, "2026-09-10", main, { payerGuardianId: dadOfB });
      const [onA, onB] = [await screen(a), await screen(b)];
      expect([optionOf(onA, shared)?.relation, optionOf(onA, dadOfB)?.relation]).toEqual(["Mother", "Father"]);
      expect([optionOf(onB, shared)?.relation, optionOf(onB, dadOfB)?.relation]).toEqual(["Grandparent", "Father"]);
    });

    it("shows only this branch's dues, advance, plans and programs", async () => {
      const kid = await family();
      const mum = payerOfFamily.get(kid) ?? "";
      const sibling = await withTenant(T, (tx) => insertStudent(tx, { tenantId: T, branchId: other, fullName: `Sibling of ${name(kid)}`, code: `PAY/COL${++families}` }));
      await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: sibling.id, guardianId: mum, relation: "mother" }));
      await enrol(kid, swim.beginnerBatch, swim.beginner);
      await enrol(sibling.id, swim.otherBatch, swim.beginner);
      await pay(kid, 800); // advance in main
      await pay(kid, 300, { branchId: other }); // advance in the second branch
      await bill(kid, 600, "2026-09-10");
      await bill(kid, 700, "2026-09-10", other);
      const facts = async (branchId: string) => {
        const o = optionOf(await screen(kid, desk, branchId), mum);
        return [o?.open.map((i) => i.balancePaise), o?.advancePaise, o?.plans.map((p) => p.studentName)];
      };
      expect(await facts(main)).toEqual([[rupees(600)], rupees(800), [name(kid)]]);
      expect(await facts(other)).toEqual([[rupees(700)], rupees(300), [sibling.fullName]]);
      expect((await screen(kid, desk, other)).enrollments).toEqual([]); // a charge there can't name the child's program here
    });

    it("says who and which branch, the days a payment can be dated, and whether the academy charges GST", async () => {
      const kid = await family();
      const s = await screen(kid);
      const [row] = await withTenant(T, (tx) => tx.select({ code: students.code }).from(students).where(eq(students.id, kid)));
      expect([s.memberId, s.memberName, s.memberCode, s.branchId, s.today, s.earliest, s.gst]).toEqual([kid, name(kid), row?.code, main, "2026-09-24", "2026-09-17", false]);
      expect((await screen(kid, desk, other)).branchName).toBe("Second branch");
      await withTenant(T, (tx) => updateOwnTenant(tx, T, { gstin: "27ABCDE1234F1Z5" }));
      try {
        expect((await screen(kid)).gst).toBe(true);
      } finally {
        await withTenant(T, (tx) => updateOwnTenant(tx, T, { gstin: null }));
      }
    });

    it("needs fees:collect, a branch in the viewer's scope and a member that exists", async () => {
      const kid = await family();
      await expect(screen(kid, teacher)).rejects.toMatchObject({ status: 403 });
      await expect(screen(kid, { ...desk, branchIds: [other] })).rejects.toMatchObject({ status: 404 });
      await expect(screen(uuidv7())).rejects.toMatchObject({ status: 404 });
    });

    it("use advance pays the payer's open invoices oldest first, in that branch only", async () => {
      const kid = await family();
      const mum = payerOfFamily.get(kid) ?? "";
      await pay(kid, 1000); // ₹1,000 advance in main, nothing open yet
      const [sep10, sep5, elsewhere] = [await bill(kid, 600, "2026-09-10"), await bill(kid, 600, "2026-09-05"), await bill(kid, 600, "2026-09-10", other)];
      expect((await applyNow(mum, main)).appliedPaise).toBe(rupees(1000));
      expect([await state(sep5.id), await state(sep10.id), await state(elsewhere.id)]).toEqual([
        ["paid", rupees(600)],
        ["part_paid", rupees(400)],
        ["issued", 0n],
      ]);
      expect(await advanceOf(kid)).toBe(0n);
      expect(await actions(sep5.id)).toContain("payment.apply_advance");
    });

    it("use advance with nothing owed, or no advance, moves nothing", async () => {
      const [held, owing] = [await family(), await family()];
      await pay(held, 500);
      const inv = await bill(owing, 600);
      expect((await applyNow(payerOfFamily.get(held) ?? "", main)).appliedPaise).toBe(0n);
      expect((await applyNow(payerOfFamily.get(owing) ?? "", main)).appliedPaise).toBe(0n);
      expect([await advanceOf(held), await state(inv.id)]).toEqual([rupees(500), ["issued", 0n]]);
    });

    it("use advance never pays the other payer's invoice", async () => {
      const { kid, mum, dad } = await parents();
      await pay(kid, 1000, { payerGuardianId: mum });
      const dads = await bill(kid, 1500, "2026-09-10", main, { payerGuardianId: dad });
      expect((await applyNow(mum, main)).appliedPaise).toBe(0n);
      expect(await state(dads.id)).toEqual(["issued", 0n]);
      expect(await advanceOf(kid)).toBe(rupees(1000));
    });

    it("use advance works for a member who pays for themselves", async () => {
      const h = await family();
      await pay(h, 700, { payerMemberId: h });
      const inv = await bill(h, 1000, "2026-09-10", main, { payerGuardianId: null, payerMemberId: h });
      expect((await withTenant(T, (tx) => applyAdvanceNow(tx, desk, { branchId: main, payerMemberId: h }))).appliedPaise).toBe(rupees(700));
      expect(await state(inv.id)).toEqual(["part_paid", rupees(700)]);
    });

    it("use advance needs fees:collect, a branch in the viewer's scope and exactly one payer", async () => {
      const { kid, mum } = await parents();
      const apply = (input: Parameters<typeof applyAdvanceNow>[2]) => withTenant(T, (tx) => applyAdvanceNow(tx, desk, input));
      await expect(applyNow(mum, main, teacher)).rejects.toMatchObject({ status: 403 });
      await expect(applyNow(mum, main, { ...desk, branchIds: [other] })).rejects.toMatchObject({ status: 404 });
      await expect(apply({ branchId: main, payerGuardianId: mum, payerMemberId: kid })).rejects.toMatchObject({ status: 400, message: "Pick one payer" });
      await expect(apply({ branchId: main })).rejects.toMatchObject({ status: 400, message: "Pick one payer" });
    });

    describe("a new charge at the desk", () => {
      const uniform = { kind: "item", description: "Uniform", amountPaise: "120000" } as const;
      const uniforms = (memberId: string) => withTenant(T, (tx) => tx.select().from(invoiceLines).where(and(eq(invoiceLines.studentId, memberId), eq(invoiceLines.description, "Uniform"))));

      it("a charge added at the desk is issued and paid in full in one step", async () => {
        const kid = await family();
        const p = await pay(kid, 1200, { charge: uniform });
        expect((await receiptOf(p.id)).lines.map((l) => l.items[0]?.description)).toEqual(["Uniform"]);
        const [line] = await uniforms(kid);
        expect(await state(line?.invoiceId ?? "")).toEqual(["paid", 120_000n]);
        expect(await actions(line?.invoiceId ?? "")).toContain("invoice.create");
        const [created] = await withTenant(T, (tx) => tx.select({ after: auditLog.after }).from(auditLog).where(and(eq(auditLog.entityId, line?.invoiceId ?? ""), eq(auditLog.action, "invoice.create"))));
        expect(created?.after).toMatchObject({ via: "collect" });
      });

      it("paying less than the charge is refused and nothing is created", async () => {
        const kid = await family();
        await expect(pay(kid, 1000, { charge: uniform })).rejects.toMatchObject({ status: 400, message: "A charge added here is paid in full" });
        expect(await uniforms(kid)).toEqual([]);
      });

      it("the same request id twice makes one charge and one payment", async () => {
        const kid = await family();
        const input = { requestId: uuidv7(), charge: uniform };
        const [a, b] = await Promise.all([pay(kid, 1200, input), pay(kid, 1200, input)]);
        expect(a.id).toBe(b.id);
        expect((await uniforms(kid)).length).toBe(1);
      });

      it("above the charge pays the ticked invoices, then advance", async () => {
        const kid = await family();
        const open = await bill(kid, 1500);
        await pay(kid, 3000, { charge: uniform, allocations: [{ invoiceId: open.id, amountPaise: "150000" }] });
        expect(await state(open.id)).toEqual(["paid", 150_000n]);
        expect(await advanceOf(kid)).toBe(30_000n);
      });

      it("a desk charge leaves the payer's advance alone", async () => {
        const kid = await family();
        await pay(kid, 500);
        await pay(kid, 1200, { charge: uniform });
        expect(await advanceOf(kid)).toBe(50_000n);
      });

      it("a desk charge needs only fees:collect", async () => {
        const kid = await family();
        expect(allows(desk, "invoices:manage")).toBe(false);
        await expect(pay(kid, 1200, { charge: uniform }, desk)).resolves.toMatchObject({ amountPaise: 120_000n });
      });

      it("a desk charge names only the student's own program in this branch, and bills only the student's own payer", async () => {
        const kid = await family();
        const mum = payerOfFamily.get(kid) ?? "";
        const own = await enrol(kid, swim.beginnerBatch, swim.beginner);
        const theirs = await enrol(await family(), swim.beginnerBatch, swim.beginner);
        const sibling = await withTenant(T, (tx) => insertStudent(tx, { tenantId: T, branchId: main, fullName: `Sibling of ${name(kid)}`, code: `PAY/CHG${++families}` }));
        await withTenant(T, (tx) => upsertFamilyLink(tx, { tenantId: T, studentId: sibling.id, guardianId: mum, relation: "mother" }));
        const siblingsFather = await addFather(sibling.id);
        for (const extra of [{ charge: { ...uniform, enrollmentId: theirs.id } }, { branchId: other, charge: { ...uniform, enrollmentId: own.id } }]) {
          await expect(pay(kid, 1200, { payerGuardianId: mum, ...extra })).rejects.toMatchObject({ status: 400, message: "Pick one of this student's programs" });
        }
        await expect(pay(kid, 1200, { payerGuardianId: siblingsFather, charge: uniform })).rejects.toMatchObject({ status: 400, message: "That payer isn't one of this student's payers" });
        await pay(kid, 1200, { payerGuardianId: mum, charge: { ...uniform, enrollmentId: own.id } });
        expect((await uniforms(kid)).map((l) => l.enrollmentId)).toEqual([own.id]);
      });
    });
  });

  describe("opening the collect drawer, and the desk's own receipts", () => {
    let deskA: ScopedCtx;
    let deskB: ScopedCtx;
    const target = (q: Parameters<typeof collectTarget>[2], as: ScopedCtx = desk) => withTenant(T, (tx) => collectTarget(tx, as, q));
    const mine = (as: ScopedCtx) => withTenant(T, (tx) => myReceiptsToday(tx, as, { now: NOW }));

    beforeAll(async () => {
      [deskA, deskB] = [await hire("Neha", "Front Desk"), await hire("Ravi", "Front Desk")];
    });

    it("Front Desk's own receipts today, nobody else's and not yesterday's", async () => {
      const h = await family();
      const [first, second] = [await pay(h, 100, {}, deskA), await pay(h, 200, {}, deskA)];
      await pay(h, 300, {}, deskB);
      await pay(h, 400, {}, deskA, new Date(NOW.getTime() - 86_400_000));
      expect((await withTenant(T, (tx) => myReceiptsToday(tx, deskA, { now: NOW }))).length).toBe(2);
      expect((await mine(deskA)).map((p) => p.id)).toEqual([first.id, second.id]);
    });

    it("the desk's own receipts are only from the viewer's branches, and need fees:collect", async () => {
      const h = await family();
      const [here, there] = [await pay(h, 100, {}, deskB), await pay(h, 100, { branchId: other }, deskB)];
      expect((await mine(deskB)).map((p) => p.id)).toEqual(expect.arrayContaining([here.id, there.id]));
      expect((await mine({ ...deskB, branchIds: [main] })).map((p) => p.id)).not.toContain(there.id);
      await expect(mine(teacher)).rejects.toMatchObject({ status: 403 });
    });

    it("the drawer's Advance sends no invoices: the payer's dues stay open and it is all advance", async () => {
      const h = await family();
      const inv = await bill(h, 1500);
      await pay(h, 700, { payerGuardianId: payerOfFamily.get(h) ?? "", allocations: [] });
      expect(await state(inv.id)).toEqual(["issued", 0n]);
      expect(await advanceOf(h)).toBe(rupees(700));
    });

    it("collectTarget opens an invoice's member with that invoice ticked", async () => {
      const child = await family();
      const inv = await bill(child, 1500);
      const t = await target({ invoiceId: inv.id });
      expect(t).toEqual({ memberId: child, branchId: main, preselect: [inv.id] });
    });

    it("collectTarget opens a student at their branch with nothing ticked, and nobody without either", async () => {
      const kid = await withTenant(T, (tx) => insertStudent(tx, { tenantId: T, branchId: other, fullName: "Second branch kid", code: `PAY/TGT${++families}` }));
      expect(await target({ studentId: kid.id })).toEqual({ memberId: kid.id, branchId: other, preselect: [] });
      expect(await target({})).toBeNull();
    });

    it("collectTarget needs fees:collect and an invoice or student in the viewer's branches", async () => {
      const child = await family();
      const elsewhere = await bill(child, 1500, "2026-09-10", other);
      await expect(target({ invoiceId: elsewhere.id }, teacher)).rejects.toMatchObject({ status: 403 });
      await expect(target({ invoiceId: elsewhere.id }, { ...desk, branchIds: [main] })).rejects.toMatchObject({ status: 404 });
      await expect(target({ studentId: child }, { ...desk, branchIds: [other] })).rejects.toMatchObject({ status: 404 });
      await expect(target({ invoiceId: uuidv7() })).rejects.toMatchObject({ status: 404 });
      await expect(target({ studentId: "not-an-id" })).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("the payer (money never crosses payers)", () => {
    // One child, two payers: the mother, and a father who is added as a guardian.
    const twoPayers = async () => {
      const h = await family();
      const dad = await withTenant(T, (tx) => addFamilyMember(tx, owner, h, { fullName: `Father ${h.slice(-4)}`, phone: `98766 ${String(40_000 + ++families)}`, relation: "father" }));
      return { h, mum: payerOfFamily.get(h) ?? "", dad: dad.id };
    };
    const paymentRows = () => withTenant(T, (tx) => tx.select().from(payments));
    const issue = (ids: string[]) => withTenant(T, (tx) => issueInvoices(tx, owner, ids, { now: NOW }));

    it("a payer's advance pays their own member's invoice and not the other payer's in the same family", async () => {
      const { h, mum, dad } = await twoPayers();
      const advance = await pay(h, 3000, { payerGuardianId: mum });
      const [mums, dads] = [await draftBill(h, 1500, "2026-09-10", mum), await draftBill(h, 1500, "2026-09-10", dad)];
      await issue([dads.id, mums.id]);
      expect([await state(mums.id), await state(dads.id)]).toEqual([
        ["paid", rupees(1500)],
        ["issued", 0n],
      ]);
      const onDads = await withTenant(T, (tx) => tx.select().from(paymentAllocations).where(eq(paymentAllocations.invoiceId, dads.id)));
      expect(onDads).toEqual([]);
      expect(advance.payerGuardianId).toBe(mum);
      expect((await withTenant(T, (tx) => tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, advance.id)))).map((a) => [a.invoiceId, a.kind, a.amountPaise])).toEqual([[mums.id, "advance", rupees(1500)]]);
    });

    it("the other payer's advance pays only the other payer's invoice", async () => {
      const { h, mum, dad } = await twoPayers();
      await pay(h, 1000, { payerGuardianId: dad });
      const [mums, dads] = [await draftBill(h, 1500, "2026-09-10", mum), await draftBill(h, 1500, "2026-09-10", dad)];
      await issue([mums.id, dads.id]);
      expect([await state(mums.id), await state(dads.id)]).toEqual([
        ["issued", 0n],
        ["part_paid", rupees(1000)],
      ]);
    });

    it("stamps the payer of the invoices ticked, and writes it, with the frozen name, to the audit row", async () => {
      const { h, mum, dad } = await twoPayers();
      const [mums, dads] = [await bill(h, 1000, "2026-09-10", main, { payerGuardianId: mum }), await bill(h, 1000, "2026-09-11", main, { payerGuardianId: dad })];
      const p = await pay(h, 1000, { allocations: [{ invoiceId: dads.id, amountPaise: String(rupees(1000)) }] });
      expect([p.payerGuardianId, p.payerMemberId]).toEqual([dad, null]);
      expect([await state(mums.id), await state(dads.id)]).toEqual([
        ["issued", 0n],
        ["paid", rupees(1000)],
      ]);
      const [a] = await withTenant(T, (tx) => tx.select().from(auditLog).where(eq(auditLog.entityId, p.id)));
      expect(a?.after).toMatchObject({ payerGuardianId: dad, billToName: expect.stringMatching(/^Father /) });
    });

    it("one payment never settles invoices of two payers: refused whole, nothing written", async () => {
      const { h, mum, dad } = await twoPayers();
      const [mums, dads] = [await bill(h, 1000, "2026-09-10", main, { payerGuardianId: mum }), await bill(h, 1000, "2026-09-11", main, { payerGuardianId: dad })];
      const before = (await paymentRows()).length;
      await expect(pay(h, 2000, { allocations: [{ invoiceId: mums.id, amountPaise: String(rupees(1000)) }, { invoiceId: dads.id, amountPaise: String(rupees(1000)) }] })).rejects.toMatchObject({ status: 400 });
      expect((await paymentRows()).length).toBe(before);
      expect([await state(mums.id), await state(dads.id)]).toEqual([
        ["issued", 0n],
        ["issued", 0n],
      ]);
      await pay(h, 1000, { payerGuardianId: mum });
      expect(await state(mums.id)).toEqual(["paid", rupees(1000)]);
      expect(await state(dads.id)).toEqual(["issued", 0n]);
    });

    it("an advance with nobody named and nothing ticked is never put on the one payer who happens to owe", async () => {
      const { h, dad } = await twoPayers();
      const dads = await bill(h, 1500, "2026-09-10", main, { payerGuardianId: dad });
      await expect(pay(h, 1500)).rejects.toMatchObject({ status: 400 });
      expect(await state(dads.id)).toEqual(["issued", 0n]);
      expect((await withTenant(T, (tx) => tx.select().from(paymentAllocations).where(eq(paymentAllocations.invoiceId, dads.id)))).length).toBe(0);
    });

    it("with several payers owing and nobody named, it asks who; naming one pays only theirs, oldest first", async () => {
      const { h, mum, dad } = await twoPayers();
      const [mums, dads] = [await bill(h, 1000, "2026-09-20", main, { payerGuardianId: mum }), await bill(h, 1000, "2026-09-05", main, { payerGuardianId: dad })];
      await expect(pay(h, 1000)).rejects.toMatchObject({ status: 400 });
      await pay(h, 1000, { payerGuardianId: mum });
      expect([await state(mums.id), await state(dads.id)]).toEqual([
        ["paid", rupees(1000)],
        ["issued", 0n],
      ]);
    });

    it("a named payer must be in the family, and must be the payer of the invoices ticked", async () => {
      const { h, mum, dad } = await twoPayers();
      const mums = await bill(h, 1000, "2026-09-10", main, { payerGuardianId: mum });
      await expect(pay(h, 1000, { payerGuardianId: dad, allocations: [{ invoiceId: mums.id, amountPaise: String(rupees(1000)) }] })).rejects.toMatchObject({ status: 400 });
      const other = await family();
      await expect(pay(h, 1000, { payerGuardianId: payerOfFamily.get(other) ?? "" })).rejects.toMatchObject({ status: 400 });
      expect(await state(mums.id)).toEqual(["issued", 0n]);
    });

    it("a member who pays for themselves is the payer of a payment too", async () => {
      const h = await family();
      const self = h;
      const inv = await bill(h, 1000, "2026-09-10", main, { payerGuardianId: null, payerMemberId: self });
      const p = await pay(h, 1000, { payerMemberId: self });
      expect([p.payerGuardianId, p.payerMemberId]).toEqual([null, self]);
      expect(await state(inv.id)).toEqual(["paid", rupees(1000)]);
    });

    it("two payers of one family record at the same moment: each pays only their own invoice", async () => {
      const { h, mum, dad } = await twoPayers();
      const [mums, dads] = [await bill(h, 1500, "2026-09-10", main, { payerGuardianId: mum }), await bill(h, 1500, "2026-09-10", main, { payerGuardianId: dad })];
      await Promise.all([pay(h, 2000, { payerGuardianId: mum }), pay(h, 700, { payerGuardianId: dad })]);
      expect([await state(mums.id), await state(dads.id)]).toEqual([
        ["paid", rupees(1500)],
        ["part_paid", rupees(700)],
      ]);
      expect(await advanceOf(h)).toBe(rupees(500));
    });

    it("a receipt keeps the name it was made with after the payer is renamed, on the receipt and on the day's sheet", async () => {
      const { h, mum } = await twoPayers();
      await bill(h, 1000, "2026-09-10", main, { payerGuardianId: mum });
      const p = await pay(h, 1000, { payerGuardianId: mum });
      const named = (await receiptOf(p.id)).billToName;
      expect(named).toMatch(/^Mother /);
      await withTenant(T, (tx) => tx.update(guardians).set({ fullName: "Renamed Person" }).where(eq(guardians.id, mum)));
      expect((await receiptOf(p.id)).billToName).toBe(named);
      const sheet = await withTenant(T, (tx) => collectionSheet(tx, owner, { branchId: main }, { now: NOW }));
      expect(sheet.payments.find((x) => x.id === p.id)?.billToName).toBe(named);
      const register = await withTenant(T, (tx) => collectionRegister(tx, owner, { from: "2026-09-01", to: "2026-09-30" }));
      expect(register.rows.find((x) => x.id === p.id)?.billToName).toBe(named);
    });
  });

  describe("cancelling on the day", () => {
    it("keeps the number, reopens the invoices, and is audited", async () => {
      const h = await family();
      const inv = await bill(h, 1500);
      const p = await pay(h, 1500);
      const c = await cancel(p.id, desk);
      expect([c.status, c.receiptNumber, c.cancelReason, c.cancelledBy]).toEqual(["cancelled", p.receiptNumber, "Wrong entry", desk.staffId]);
      expect(await state(inv.id)).toEqual(["issued", 0n]);
      expect(await advanceOf(h)).toBe(0n);
      expect(await actions(p.id)).toEqual(["payment.cancel", "payment.create"]);
      await expect(cancel(p.id, desk)).rejects.toThrow("Already cancelled");
      await expect(refund(p.id, 100)).rejects.toThrow("A cancelled payment can't be refunded");
    });

    it("only on the day it was recorded; someone else's needs fees:refund", async () => {
      const h = await family();
      await bill(h, 1500);
      const p = await pay(h, 500);
      await expect(cancel(p.id, owner, new Date("2026-09-25T06:00:00Z"))).rejects.toThrow("Only on the day it was recorded");
      await expect(cancel(p.id, desk2)).rejects.toMatchObject({ status: 403 });
      expect((await cancel(p.id, owner)).status).toBe("cancelled");
    });

    it("not once part of it is refunded", async () => {
      const h = await family();
      const p = await pay(h, 1000);
      await refund(p.id, 200);
      await expect(cancel(p.id, owner)).rejects.toThrow("It has a refund");
    });
  });

  describe("refunds", () => {
    it("₹500 back on a paid ₹1,500 invoice reopens it as part paid", async () => {
      const h = await family();
      const inv = await bill(h, 1500);
      const p = await pay(h, 1500);
      await refund(p.id, 500, { reason: "Missed a week" });
      expect(await state(inv.id)).toEqual(["part_paid", rupees(1000)]);
      expect(await actions(p.id)).toEqual(["payment.create", "payment.refund"]);
    });

    it("come out of the unused advance first, then the invoice", async () => {
      const h = await family();
      const inv = await bill(h, 1500);
      const p = await pay(h, 2000);
      await refund(p.id, 500);
      expect(await state(inv.id)).toEqual(["paid", rupees(1500)]);
      expect(await advanceOf(h)).toBe(0n);
      await refund(p.id, 200);
      expect(await state(inv.id)).toEqual(["part_paid", rupees(1300)]);
    });

    it("can be taken off a picked invoice first", async () => {
      const h = await family();
      const [sep, oct] = [await bill(h, 1500, "2026-09-05"), await bill(h, 1500, "2026-10-05")];
      const p = await pay(h, 3000);
      await refund(p.id, 300, { invoiceId: sep.id });
      expect([await state(sep.id), await state(oct.id)]).toEqual([
        ["part_paid", rupees(1200)],
        ["paid", rupees(1500)],
      ]);
    });

    it("never more than is left; the last rupee marks the payment refunded", async () => {
      const h = await family();
      const inv = await bill(h, 1500);
      const p = await pay(h, 1500);
      await refund(p.id, 1000);
      await expect(refund(p.id, 600)).rejects.toThrow("Only ₹500 is left on this payment");
      await refund(p.id, 500);
      expect(await state(inv.id)).toEqual(["issued", 0n]);
      const [after] = await withTenant(T, (tx) => tx.select().from(payments).where(eq(payments.id, p.id)));
      expect(after?.status).toBe("refunded");
      await expect(refund(p.id, 1)).rejects.toThrow("Nothing is left on this payment");
    });

    it("never change the original receipt", async () => {
      const h = await family();
      await bill(h, 1500);
      const p = await pay(h, 2000);
      const before = await receiptOf(p.id);
      await refund(p.id, 700);
      const after = await receiptOf(p.id);
      expect([after.lines, after.advancePaise, after.payment.receiptNumber, after.payment.amountPaise]).toEqual([before.lines, before.advancePaise, p.receiptNumber, rupees(2000)]);
    });

    it("need fees:refund", async () => {
      const h = await family();
      const p = await pay(h, 500);
      await expect(refund(p.id, 100, {}, desk)).rejects.toMatchObject({ status: 403 });
    });
  });

  describe("the collection sheet", () => {
    let branch = "";
    const payHere = (h: string, amount: number, extra: Partial<PaymentInput> = {}, as: ScopedCtx = desk, now = NOW) => pay(h, amount, { branchId: branch, ...extra }, as, now);
    const sheetFor = (day?: string, now = NOW) => withTenant(T, (tx) => collectionSheet(tx, owner, { branchId: branch, ...(day ? { day } : {}) }, { now }));

    beforeAll(async () => {
      branch = (await withTenant(T, (tx) => createBranch(tx, { tenantId: T, name: "Sheet branch" }))).id;
    });

    it("adds up the day by method and by collector, to the paisa, and matches the payments table", async () => {
      const [h1, h2, h3] = [await family(), await family(), await family()];
      await payHere(h1, 1500);
      await payHere(h2, 0, { amountPaise: "83333", method: "upi", reference: "UPI 1" }, desk2);
      await payHere(h3, 2000, { method: "cheque", reference: "000123" }, desk2);
      const wrong = await payHere(h3, 999);
      await cancel(wrong.id, desk);
      const s = await sheetFor();
      expect([s.day, s.branch.name]).toEqual(["2026-09-24", "Sheet branch"]);
      expect(s.total).toEqual({ count: 3, totalPaise: rupees(1500) + 83333n + rupees(2000) });
      expect(s.byMethod.map((m) => [m.method, m.count, m.totalPaise])).toEqual([
        ["cash", 1, rupees(1500)],
        ["upi", 1, 83333n],
        ["cheque", 1, rupees(2000)],
      ]);
      expect(s.byCollector.map((c) => [c.name, c.count, c.totalPaise])).toEqual([
        ["Amit", 2, 83333n + rupees(2000)],
        ["Priya", 1, rupees(1500)],
      ]);
      expect(s.payments.map((p) => [p.receiptNumber, p.status])).toContainEqual([wrong.receiptNumber, "cancelled"]);
      const [row] = await withTenant(T, (tx) =>
        tx.execute<{ total: string }>(sql`SELECT coalesce(sum(amount_paise), 0)::text AS total FROM app.payments WHERE branch_id = ${branch} AND recorded_on = '2026-09-24' AND status <> 'cancelled'`),
      );
      expect(BigInt(row?.total ?? "-1")).toBe(s.total.totalPaise);
    });

    it("cash in hand is the cash collected less the cash refunded that day", async () => {
      const day = new Date("2026-09-22T06:00:00Z");
      const h = await family();
      const p = await payHere(h, 1000, {}, desk, day);
      await payHere(h, 500, { method: "upi" }, desk, day);
      await withTenant(T, (tx) => refundPayment(tx, owner, p.id, { amountPaise: "20000", reason: "Missed classes" }, { now: day }));
      const s = await sheetFor("2026-09-22", day);
      expect([s.total.totalPaise, s.refunds.totalPaise, s.cashInHandPaise]).toEqual([rupees(1500), rupees(200), rupees(800)]);
      expect(s.refunds.rows.map((r) => [r.receiptNumber, r.method, r.amountPaise])).toEqual([[p.receiptNumber, "cash", rupees(200)]]);
    });

    it("a payment at 23:50 in India counts on that Indian day, not the UTC one", async () => {
      const late = new Date("2026-09-20T18:20:00Z"); // 23:50 IST, 20 Sep
      const early = new Date("2026-09-20T18:40:00Z"); // 00:10 IST, 21 Sep
      const h = await family();
      const a = await payHere(h, 100, {}, desk, late);
      const b = await payHere(h, 200, {}, desk, early);
      expect([a.recordedOn, b.recordedOn]).toEqual(["2026-09-20", "2026-09-21"]);
      expect((await sheetFor("2026-09-20", early)).payments.map((p) => p.id)).toEqual([a.id]);
      expect((await sheetFor("2026-09-21", early)).payments.map((p) => p.id)).toEqual([b.id]);
    });

    it("a back-dated payment counts on the day it was recorded and shows the day it was received", async () => {
      const h = await family();
      const p = await payHere(h, 300, { receivedOn: "2026-09-19" });
      expect((await sheetFor("2026-09-19")).payments.map((x) => x.id)).not.toContain(p.id);
      const row = (await sheetFor()).payments.find((x) => x.id === p.id);
      expect([row?.recordedOn, row?.receivedOn]).toEqual(["2026-09-24", "2026-09-19"]);
    });

    it("the dashboard's figure for today is the sheet's total", async () => {
      const s = await sheetFor();
      expect(await withTenant(T, (tx) => collectedToday(tx, { ...owner, branchIds: [branch] }, { now: NOW }))).toEqual({ count: s.total.count, total: s.total.totalPaise });
    });

    it("needs payments:read", async () => {
      await expect(withTenant(T, (tx) => collectionSheet(tx, desk, { branchId: branch }, { now: NOW }))).rejects.toMatchObject({ status: 403 });
    });
  });

  describe("an invoice's money history", () => {
    const money = (id: string, as: ScopedCtx = owner) => withTenant(T, (tx) => invoiceMoney(tx, as, id));

    it("lists the receipts that paid it, oldest first, with how each was paid", async () => {
      const h = await family();
      const inv = await bill(h, 1500);
      const [a, b] = [await pay(h, 800), await pay(h, 700, { method: "upi" })];
      expect((await money(inv.id)).map((r) => [r.kind, r.receiptNumber, r.amountPaise, r.method, r.receivedOn])).toEqual([
        ["receipt", a.receiptNumber, rupees(800), "cash", "2026-09-24"],
        ["receipt", b.receiptNumber, rupees(700), "upi", "2026-09-24"],
      ]);
    });

    it("shows money paid online like a desk receipt, with method Online", async () => {
      const h = await family();
      const inv = await bill(h, 1500);
      const { payment } = await withTenant(T, (tx) => recordGatewayPayment(tx, { invoiceId: inv.id, gatewayPaymentId: `pay_money_${stamp}`, amountPaise: rupees(1500), capturedAt: NOW }, { now: NOW }));
      expect(await money(inv.id)).toMatchObject([{ kind: "receipt", amountPaise: rupees(1500), paymentId: payment.id, receiptNumber: payment.receiptNumber, method: "online" }]);
    });

    it("shows advance with the receipt it came from, and that receipt's own date and method", async () => {
      const h = await family();
      const p = await pay(h, 2000, { method: "upi", receivedOn: "2026-09-20" }); // against nothing: it waits as advance
      const next = await draftBill(h, 1500, "2026-10-10");
      await withTenant(T, (tx) => issueInvoices(tx, owner, [next.id], { now: NOW }));
      expect(await money(next.id)).toMatchObject([{ kind: "advance", amountPaise: rupees(1500), paymentId: p.id, receiptNumber: p.receiptNumber, receivedOn: "2026-09-20", method: "upi", reason: null }]);
    });

    it("a refund is its own negative row with the reason, and the paid receipt stays above it", async () => {
      const h = await family();
      const inv = await bill(h, 1500);
      const p = await pay(h, 1500);
      await refund(p.id, 500, { reason: "Missed classes", invoiceId: inv.id });
      const rows = await money(inv.id);
      expect(rows.map((r) => [r.kind, r.amountPaise, r.reason])).toEqual([
        ["receipt", rupees(1500), null],
        ["refund", -rupees(500), "Missed classes"],
      ]);
      expect(rows.at(-1)).toMatchObject({ paymentId: p.id, receiptNumber: p.receiptNumber });
    });

    it("money released by cancelling the invoice is a negative row with the cancel reason", async () => {
      const h = await family();
      const inv = await bill(h, 1500);
      await pay(h, 800);
      await withTenant(T, (tx) => voidInvoice(tx, owner, inv.id, { reason: "Wrong fee plan" }));
      expect((await money(inv.id)).map((r) => [r.kind, r.amountPaise, r.reason])).toEqual([
        ["receipt", rupees(800), null],
        ["void", -rupees(800), "Wrong fee plan"],
      ]);
    });

    it("a cancelled payment takes its money off as its own row", async () => {
      const h = await family();
      const inv = await bill(h, 800);
      const p = await pay(h, 800);
      await cancel(p.id, desk);
      expect((await money(inv.id)).map((r) => [r.kind, r.amountPaise, r.reason])).toEqual([
        ["receipt", rupees(800), null],
        ["cancel", -rupees(800), null],
      ]);
    });

    it("every row adds up to what the invoice has paid", async () => {
      const h = await family();
      const inv = await bill(h, 1500);
      const p = await pay(h, 1000);
      await pay(h, 300);
      await refund(p.id, 200, { invoiceId: inv.id });
      const rows = await money(inv.id);
      expect(rows).toHaveLength(3);
      expect(rows.reduce((total, r) => total + r.amountPaise, 0n)).toBe(rupees(1100));
      expect(await state(inv.id)).toEqual(["part_paid", rupees(1100)]);
    });

    it("needs invoices:read and an invoice in the viewer's branches", async () => {
      const h = await family();
      const inv = await bill(h, 1500);
      await expect(money(inv.id, teacher)).rejects.toMatchObject({ status: 403 });
      await expect(money(inv.id, { ...owner, branchIds: [other] })).rejects.toMatchObject({ status: 404 });
      expect(await money(inv.id, desk)).toEqual([]);
    });
  });

  describe("routes", () => {
    const PASSWORD = "Correct-Horse-9";
    const cookie: Record<string, string> = {};
    const call = (route: (req: Request) => Promise<Response>, path: string, as: string, body: unknown) =>
      route(new Request(`http://pay-t-${stamp}.localhost:3000${path}`, { method: "POST", headers: { "content-type": "application/json", cookie: cookie[as] ?? "" }, body: JSON.stringify(body) }));

    beforeAll(async () => {
      const people: [string, ScopedCtx, string][] = [
        ["owner", owner, `pay-t-${stamp}@example.test`],
        ["desk", desk, `Priya-${stamp}@example.test`],
        ["teacher", teacher, `Coach-${stamp}@example.test`],
      ];
      for (const [key, ctx, email] of people) {
        await withTenant(T, (tx) => setPassword(tx, owner, ctx.staffId, PASSWORD));
        cookie[key] = `${SESSION_COOKIE}=${(await login({ slug: `pay-t-${stamp}`, email, password: PASSWORD })).token}`;
      }
    });

    it("recording needs fees:collect, returns the payment, and a repeat returns the same one", async () => {
      const h = await family();
      await bill(h, 1500);
      const body = { requestId: uuidv7(), memberId: h, branchId: main, amountPaise: "150000" };
      expect((await call(recordPaymentRoute, "/api/payments", "teacher", body)).status).toBe(403);
      const res = await call(recordPaymentRoute, "/api/payments", "desk", body);
      expect(res.status).toBe(201);
      const p = (await res.json()) as { id: string; receiptNumber: string; amountPaise: string; method: string };
      expect([p.amountPaise, p.method]).toEqual(["150000", "cash"]);
      expect(((await (await call(recordPaymentRoute, "/api/payments", "desk", body)).json()) as { id: string }).id).toBe(p.id);
      expect((await call(recordPaymentRoute, "/api/payments", "desk", { ...body, requestId: uuidv7(), amountPaise: "0" })).status).toBe(400);
    });

    it("a card payment is recorded by hand; an online one is refused", async () => {
      const h = await family();
      const record = (method: string) => call(recordPaymentRoute, "/api/payments", "desk", { requestId: uuidv7(), memberId: h, branchId: main, amountPaise: "50000", method });
      expect([(await record("card")).status, (await record("online")).status]).toEqual([201, 400]);
    });

    it("using the advance needs fees:collect and says how much it applied", async () => {
      const h = await family();
      await pay(h, 1000); // advance, nothing open yet
      const inv = await bill(h, 600);
      const body = { branchId: main, payerGuardianId: payerOfFamily.get(h) };
      expect((await call(applyAdvanceRoute, "/api/payments/advance", "teacher", body)).status).toBe(403);
      const res = await call(applyAdvanceRoute, "/api/payments/advance", "desk", body);
      expect([res.status, await res.json()]).toEqual([200, { appliedPaise: "60000" }]);
      expect(await state(inv.id)).toEqual(["paid", rupees(600)]);
      expect((await call(applyAdvanceRoute, "/api/payments/advance", "desk", { branchId: main })).status).toBe(400);
    });

    it("refunding needs fees:refund at the route", async () => {
      const h = await family();
      const p = (await (await call(recordPaymentRoute, "/api/payments", "desk", { requestId: uuidv7(), memberId: h, branchId: main, amountPaise: "50000" })).json()) as { id: string };
      expect((await call(refundPaymentRoute, `/api/payments/${p.id}/refund`, "desk", { amountPaise: "10000", reason: "Overpaid" })).status).toBe(403);
      expect((await call(refundPaymentRoute, `/api/payments/${p.id}/refund`, "owner", { amountPaise: "10000", reason: "Overpaid" })).status).toBe(201);
    });

    it("the collector cancels their own payment on the day", async () => {
      const h = await family();
      const p = (await (await call(recordPaymentRoute, "/api/payments", "desk", { requestId: uuidv7(), memberId: h, branchId: main, amountPaise: "5000" })).json()) as { id: string };
      const out = await call(cancelPaymentRoute, `/api/payments/${p.id}/cancel`, "desk", { reason: "Typed the wrong family" });
      expect(out.status).toBe(200);
      expect(((await out.json()) as { status: string }).status).toBe("cancelled");
    });
  });

  describe("the year's receipts", () => {
    it("run from 0001 with no gap, cancelled ones included", async () => {
      const rows = await withTenant(T, (tx) => tx.select({ n: payments.receiptNumber }).from(payments).where(eq(payments.fy, FY)));
      const numbers = rows.map((r) => Number(r.n.split("/").at(-1))).sort((a, b) => a - b);
      expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
    });
  });
});

// ---- collection by calendar month: the dashboard's revenue chart

describe("collection by month", () => {
  const M = { tenant: "", branch: "", other: "", owner: "" };
  let n = 0;

  // A payment recorded on a chosen day, straight into the table.
  const pay = (branchId: string, day: string, amountPaise: bigint, extra: Partial<typeof payments.$inferInsert> = {}) =>
    withTenant(M.tenant, (tx) =>
      insertPayment(tx, { tenantId: M.tenant, branchId, receiptNumber: `RCT/TEST/${++n}`, fy: "2026-27", method: "cash", amountPaise, receivedOn: day, recordedOn: day, receivedBy: M.owner, billToName: "Payer", ...extra }),
    );
  const byMonth = (branchIds: string[], from = "2026-06-01", to = "2026-08-31") => withTenant(M.tenant, (tx) => collectedByMonth(tx, branchIds, from, to));

  beforeAll(async () => {
    const t = await academy("months");
    Object.assign(M, { tenant: t.tenant.id, branch: t.branch.id, owner: t.owner.id });
    M.other = (await withTenant(M.tenant, (tx) => createBranch(tx, { tenantId: M.tenant, name: "Second branch" }))).id;

    // Out of date order on purpose. July has nothing; June has two that count and three that don't.
    await pay(M.branch, "2026-08-01", 250_000n);
    await pay(M.other, "2026-06-12", 300_000n);
    await pay(M.branch, "2026-06-05", 150_000n);
    await pay(M.branch, "2026-06-30", 80_050n, { status: "refunded" }); // fully refunded, but the money was taken in
    await pay(M.branch, "2026-06-10", 11_100n, { status: "pending" });
    await pay(M.branch, "2026-06-11", 22_200n, { status: "failed" });
    await pay(M.branch, "2026-06-12", 33_300n, { status: "cancelled", cancelledAt: new Date(), cancelledBy: M.owner, cancelReason: "Typed the wrong family" });
  });

  it("totals the confirmed and refunded payments of each month, oldest first, with no row for an empty month", async () => {
    expect(await byMonth([M.branch])).toEqual([
      { month: "2026-06", count: 2, total: 230_050n },
      { month: "2026-08", count: 1, total: 250_000n },
    ]);
  });

  it("takes every branch when none is named, and only the named one otherwise", async () => {
    expect(await byMonth([])).toEqual([
      { month: "2026-06", count: 3, total: 530_050n },
      { month: "2026-08", count: 1, total: 250_000n },
    ]);
    expect(await byMonth([M.other])).toEqual([{ month: "2026-06", count: 1, total: 300_000n }]);
  });

  it("includes the window's first and last day, and an empty window is empty", async () => {
    expect(await byMonth([M.branch], "2026-06-30", "2026-08-01")).toEqual([
      { month: "2026-06", count: 1, total: 80_050n },
      { month: "2026-08", count: 1, total: 250_000n },
    ]);
    expect(await byMonth([], "2026-07-01", "2026-07-31")).toEqual([]);
  });
});
