import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ScopedCtx } from "@/lib/auth/route";
import { auditLog } from "@/lib/db/audit";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { login, setPassword } from "@/modules/auth/service";
import { insertInvoice, updateInvoice } from "@/modules/fees/repo";
import { type Invoice, invoices } from "@/modules/fees/schema";
import { issueInvoices, voidInvoice } from "@/modules/fees/service";
import { allocateNumber } from "@/modules/numbering/repo";
import { listRoles, staffBranchIds } from "@/modules/staff/repo";
import { createStaffMember, loadAccessContext } from "@/modules/staff/service";
import { createHousehold } from "@/modules/students/repo";
import { createBranch } from "@/modules/tenancy/repo";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { cancelPaymentRoute, recordPaymentRoute, refundPaymentRoute } from "./routes";
import { type Payment, paymentAllocations, payments, refunds } from "./schema";
import { cancelPayment, collectedToday, collectionSheet, familyAccount, invoiceReceipts, type PaymentInput, receipt, recordPayment, refundPayment } from "./service";

// docs/04 "Test list": the database guards under the payments code
// (migration 0015) in academy G, and the payments service in academy T, where
// the ledger must add up after every test.

const stamp = Math.random().toString(36).slice(2, 8);
const DENIED = "42501"; // insufficient_privilege
const CHECK = "23514"; // check_violation
const UNIQUE = "23505"; // unique_violation

function sqlState(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
}
const fails = (code: string) => (e: unknown) => sqlState(e) === code;

const made: string[] = [];
const academy = async (key: string) => {
  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Payments ${key} ${stamp}`, slug: `pay-${key}-${stamp}`, verticalPreset: "karate", owner: { name: "Owner", email: `pay-${key}-${stamp}@example.test` } });
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
  const G = { tenant: "", branch: "", owner: "", household: "" };
  let n = 0;

  const newPayment = (extra: Partial<typeof payments.$inferInsert> = {}): Promise<Payment> =>
    withTenant(G.tenant, async (tx) => {
      const [p] = await tx
        .insert(payments)
        .values({ id: uuidv7(), tenantId: G.tenant, branchId: G.branch, householdId: G.household, receiptNumber: `RCT/TEST/${++n}`, fy: "2026-27", method: "cash", amountPaise: 150_000n, receivedOn: "2026-09-24", recordedOn: "2026-09-24", receivedBy: G.owner, ...extra })
        .returning();
      if (!p) throw new Error("payment insert returned no row");
      return p;
    });

  const issuedInvoice = (totalPaise: bigint): Promise<Invoice> =>
    withTenant(G.tenant, async (tx) => {
      const inv = await insertInvoice(tx, { tenantId: G.tenant, branchId: G.branch, householdId: G.household, issueDate: "2026-09-01", dueDate: "2026-09-08", subtotalPaise: totalPaise, totalPaise });
      return updateInvoice(tx, inv.id, { number: `INV/TEST/${++n}`, fy: "2026-27", status: "issued", issuedAt: new Date() });
    });

  beforeAll(async () => {
    const t = await academy("g");
    Object.assign(G, { tenant: t.tenant.id, branch: t.branch.id, owner: t.owner.id });
    G.household = (await withTenant(G.tenant, (tx) => createHousehold(tx, { tenantId: G.tenant, name: "Deshmukh" }))).id;
  });

  describe("a payment", () => {
    it("never changes its amount, method, dates, family, branch, collector or receipt number", async () => {
      const p = await newPayment();
      const patches: Partial<typeof payments.$inferInsert>[] = [
        { amountPaise: 1n },
        { method: "upi" },
        { receiptNumber: "RCT/TEST/edited" },
        { receivedOn: "2026-09-20" },
        { recordedOn: "2026-09-25" },
        { householdId: G.household },
        { branchId: G.branch },
        { receivedBy: null },
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
  });

  describe("allocations and refunds", () => {
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
      const draft = await withTenant(G.tenant, (tx) => insertInvoice(tx, { tenantId: G.tenant, branchId: G.branch, householdId: G.household, issueDate: "2026-09-01", dueDate: "2026-09-08", subtotalPaise: 1_000n, totalPaise: 1_000n }));
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
  const family = async () => (await withTenant(T, (tx) => createHousehold(tx, { tenantId: T, name: `Family ${++families}` }))).id;
  // An issued invoice with a real number from the series.
  const bill = (householdId: string, amount: number, dueDate = "2026-09-10", branchId = main): Promise<Invoice> =>
    withTenant(T, async (tx) => {
      const total = rupees(amount);
      const inv = await insertInvoice(tx, { tenantId: T, branchId, householdId, issueDate: "2026-09-01", dueDate, subtotalPaise: total, totalPaise: total });
      return updateInvoice(tx, inv.id, { number: await allocateNumber(tx, T, "invoice", FY), fy: FY, status: "issued", issuedAt: NOW });
    });
  const draftBill = (householdId: string, amount: number, dueDate: string): Promise<Invoice> =>
    withTenant(T, (tx) => insertInvoice(tx, { tenantId: T, branchId: main, householdId, issueDate: "2026-09-01", dueDate, subtotalPaise: rupees(amount), totalPaise: rupees(amount) }));
  const pay = (householdId: string, amount: number, extra: Partial<PaymentInput> = {}, as: ScopedCtx = desk, now = NOW): Promise<Payment> =>
    withTenant(T, (tx) => recordPayment(tx, as, { requestId: uuidv7(), householdId, branchId: main, amountPaise: String(rupees(amount)), ...extra }, { now }));
  const refund = (paymentId: string, amount: number, extra: { reason?: string; invoiceId?: string } = {}, as: ScopedCtx = owner) =>
    withTenant(T, (tx) => refundPayment(tx, as, paymentId, { amountPaise: String(rupees(amount)), reason: extra.reason ?? "Refund", ...(extra.invoiceId ? { invoiceId: extra.invoiceId } : {}) }, { now: NOW }));
  const cancel = (paymentId: string, as: ScopedCtx, now = NOW) => withTenant(T, (tx) => cancelPayment(tx, as, paymentId, { reason: "Wrong entry" }, { now }));
  const state = async (id: string) => {
    const [i] = await withTenant(T, (tx) => tx.select().from(invoices).where(eq(invoices.id, id)));
    return [i?.status, i?.paidPaise];
  };
  const advanceOf = async (householdId: string, branchId = main) => (await withTenant(T, (tx) => familyAccount(tx, desk, householdId, branchId))).advancePaise;
  const receiptOf = (id: string) => withTenant(T, (tx) => receipt(tx, desk, id));
  const actions = async (entityId: string) => (await withTenant(T, (tx) => tx.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, entityId)))).map((r) => r.a).sort();

  // docs/02 §9 invariants 1 and 2, and the ledger's own rules, over the whole academy.
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
        SELECT 'allocation ' || a.id || ': another family or branch' FROM app.payment_allocations a
          JOIN app.payments p ON p.id = a.payment_id JOIN app.invoices i ON i.id = a.invoice_id
         WHERE p.household_id <> i.household_id OR p.branch_id <> i.branch_id
      `),
    );
    expect(problems.map((p) => p.problem)).toEqual([]);
  }

  beforeAll(async () => {
    const t = await academy("t");
    T = t.tenant.id;
    main = t.branch.id;
    owner = await ctxFor(t.owner.id);
    const roles = Object.fromEntries((await withTenant(T, listRoles)).map((r) => [r.name, r.id]));
    const hire = async (name: string, role: string) => ctxFor((await withTenant(T, (tx) => createStaffMember(tx, owner, { email: `${name}-${stamp}@example.test`, fullName: name, roleIds: [roles[role] ?? ""] }))).id);
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
        await recordPayment(tx, desk, { requestId: uuidv7(), householdId: h, branchId: main, amountPaise: "10000" }, { now: NOW });
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

  it("an invoice lists the receipts that paid it", async () => {
    const h = await family();
    const inv = await bill(h, 1500);
    const [a, b] = [await pay(h, 800), await pay(h, 700)];
    expect((await withTenant(T, (tx) => invoiceReceipts(tx, owner, inv.id))).map((r) => [r.receiptNumber, r.net])).toEqual([
      [a.receiptNumber, rupees(800)],
      [b.receiptNumber, rupees(700)],
    ]);
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
      const body = { requestId: uuidv7(), householdId: h, branchId: main, amountPaise: "150000" };
      expect((await call(recordPaymentRoute, "/api/payments", "teacher", body)).status).toBe(403);
      const res = await call(recordPaymentRoute, "/api/payments", "desk", body);
      expect(res.status).toBe(201);
      const p = (await res.json()) as { id: string; receiptNumber: string; amountPaise: string; method: string };
      expect([p.amountPaise, p.method]).toEqual(["150000", "cash"]);
      expect(((await (await call(recordPaymentRoute, "/api/payments", "desk", body)).json()) as { id: string }).id).toBe(p.id);
      expect((await call(recordPaymentRoute, "/api/payments", "desk", { ...body, requestId: uuidv7(), amountPaise: "0" })).status).toBe(400);
    });

    it("refunding needs fees:refund at the route", async () => {
      const h = await family();
      const p = (await (await call(recordPaymentRoute, "/api/payments", "desk", { requestId: uuidv7(), householdId: h, branchId: main, amountPaise: "50000" })).json()) as { id: string };
      expect((await call(refundPaymentRoute, `/api/payments/${p.id}/refund`, "desk", { amountPaise: "10000", reason: "Overpaid" })).status).toBe(403);
      expect((await call(refundPaymentRoute, `/api/payments/${p.id}/refund`, "owner", { amountPaise: "10000", reason: "Overpaid" })).status).toBe(201);
    });

    it("the collector cancels their own payment on the day", async () => {
      const h = await family();
      const p = (await (await call(recordPaymentRoute, "/api/payments", "desk", { requestId: uuidv7(), householdId: h, branchId: main, amountPaise: "5000" })).json()) as { id: string };
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
