import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as runtimeSql } from "@/lib/db/client";
import { deleteTenantsCompletely } from "@/lib/db/isolation/teardown";
import { platformSql, withPlatformAdmin } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { uuidv7 } from "@/lib/ids";
import { insertInvoice, updateInvoice } from "@/modules/fees/repo";
import { type Invoice, invoices } from "@/modules/fees/schema";
import { ensurePlatformPlans } from "@/modules/platform/repo";
import { createHousehold } from "@/modules/students/repo";
import { createTenantWithDefaults } from "@/modules/tenancy/service";
import { type Payment, paymentAllocations, payments, refunds } from "./schema";

// The database guards under the payments code (migrations/0015_payments.sql),
// run as app_runtime. The service tests from docs/04's test list join this file
// with the code.

const stamp = Math.random().toString(36).slice(2, 8);
const DENIED = "42501"; // insufficient_privilege
const CHECK = "23514"; // check_violation
const UNIQUE = "23505"; // unique_violation

function sqlState(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
}
const fails = (code: string) => (e: unknown) => sqlState(e) === code;

let T = "";
let branchId = "";
let ownerId = "";
let householdId = "";
let n = 0;

const newPayment = (extra: Partial<typeof payments.$inferInsert> = {}): Promise<Payment> =>
  withTenant(T, async (tx) => {
    const [p] = await tx
      .insert(payments)
      .values({ id: uuidv7(), tenantId: T, branchId, householdId, receiptNumber: `RCT/TEST/${++n}`, fy: "2026-27", method: "cash", amountPaise: 150_000n, receivedOn: "2026-09-24", recordedOn: "2026-09-24", receivedBy: ownerId, ...extra })
      .returning();
    if (!p) throw new Error("payment insert returned no row");
    return p;
  });

const issuedInvoice = (totalPaise: bigint): Promise<Invoice> =>
  withTenant(T, async (tx) => {
    const inv = await insertInvoice(tx, { tenantId: T, branchId, householdId, issueDate: "2026-09-01", dueDate: "2026-09-08", subtotalPaise: totalPaise, totalPaise });
    return updateInvoice(tx, inv.id, { number: `INV/TEST/${++n}`, fy: "2026-27", status: "issued", issuedAt: new Date() });
  });

beforeAll(async () => {
  await withPlatformAdmin({ action: "test.setup", actorType: "system" }, ensurePlatformPlans);
  const t = await createTenantWithDefaults({ actorType: "system" }, { name: `Payments ${stamp}`, slug: `pay-${stamp}`, owner: { name: "Owner", email: `pay-owner-${stamp}@example.test` } });
  T = t.tenant.id;
  branchId = t.branch.id;
  ownerId = t.owner.id;
  householdId = (await withTenant(T, (tx) => createHousehold(tx, { tenantId: T, name: "Deshmukh" }))).id;
});

afterAll(async () => {
  await deleteTenantsCompletely([T]);
  await runtimeSql.end({ timeout: 5 });
  await platformSql.end({ timeout: 5 });
});

describe("a payment at the database", () => {
  it("never changes its amount, method, dates, family, branch or receipt number", async () => {
    const p = await newPayment();
    const patches: Partial<typeof payments.$inferInsert>[] = [
      { amountPaise: 1n },
      { method: "upi" },
      { receiptNumber: "RCT/TEST/edited" },
      { receivedOn: "2026-09-20" },
      { recordedOn: "2026-09-25" },
      { householdId },
      { branchId },
      { receivedBy: null },
    ];
    for (const patch of patches) {
      await expect(withTenant(T, (tx) => tx.update(payments).set(patch).where(eq(payments.id, p.id))), JSON.stringify(Object.keys(patch))).rejects.toSatisfy(fails(DENIED));
    }
    await expect(withTenant(T, (tx) => tx.delete(payments).where(eq(payments.id, p.id)))).rejects.toSatisfy(fails(DENIED));
  });

  it("can be cancelled, but only with who, when and why", async () => {
    const p = await newPayment();
    const cancel = (patch: Partial<typeof payments.$inferInsert>) => withTenant(T, (tx) => tx.update(payments).set(patch).where(eq(payments.id, p.id)).returning());
    await expect(cancel({ status: "cancelled" })).rejects.toSatisfy(fails(CHECK));
    await expect(cancel({ status: "cancelled", cancelledAt: new Date(), cancelledBy: ownerId })).rejects.toSatisfy(fails(CHECK));
    await expect(cancel({ status: "cancelled", cancelledAt: new Date(), cancelledBy: ownerId, cancelReason: "  " })).rejects.toSatisfy(fails(CHECK));
    await expect(cancel({ cancelReason: "Not actually cancelled" })).rejects.toSatisfy(fails(CHECK));
    const [done] = await cancel({ status: "cancelled", cancelledAt: new Date(), cancelledBy: ownerId, cancelReason: "Typed 1,500 for 150" });
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

describe("allocations and refunds at the database", () => {
  it("are append-only", async () => {
    const p = await newPayment();
    const inv = await issuedInvoice(150_000n);
    const [a] = await withTenant(T, (tx) => tx.insert(paymentAllocations).values({ id: uuidv7(), tenantId: T, paymentId: p.id, invoiceId: inv.id, kind: "receipt", amountPaise: 150_000n }).returning());
    const [r] = await withTenant(T, (tx) =>
      tx.insert(refunds).values({ id: uuidv7(), tenantId: T, paymentId: p.id, amountPaise: 500n, method: "cash", reason: "Paid twice", refundedOn: "2026-09-24", approvedBy: ownerId }).returning(),
    );
    const aid = a?.id ?? "";
    const rid = r?.id ?? "";
    await expect(withTenant(T, (tx) => tx.update(paymentAllocations).set({ amountPaise: 1n }).where(eq(paymentAllocations.id, aid)))).rejects.toSatisfy(fails(DENIED));
    await expect(withTenant(T, (tx) => tx.delete(paymentAllocations).where(eq(paymentAllocations.id, aid)))).rejects.toSatisfy(fails(DENIED));
    await expect(withTenant(T, (tx) => tx.update(refunds).set({ amountPaise: 1n }).where(eq(refunds.id, rid)))).rejects.toSatisfy(fails(DENIED));
    await expect(withTenant(T, (tx) => tx.delete(refunds).where(eq(refunds.id, rid)))).rejects.toSatisfy(fails(DENIED));
  });

  it("put money on with a positive amount, take it back with a negative one, and a refund row names its refund", async () => {
    const p = await newPayment();
    const inv = await issuedInvoice(150_000n);
    const [r] = await withTenant(T, (tx) => tx.insert(refunds).values({ id: uuidv7(), tenantId: T, paymentId: p.id, amountPaise: 500n, method: "cash", reason: "Test", refundedOn: "2026-09-24" }).returning());
    const allocate = (kind: (typeof paymentAllocations.$inferInsert)["kind"], amountPaise: bigint, refundId?: string) =>
      withTenant(T, (tx) => tx.insert(paymentAllocations).values({ id: uuidv7(), tenantId: T, paymentId: p.id, invoiceId: inv.id, kind, amountPaise, ...(refundId ? { refundId } : {}) }));
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
    const refund = (reason: string, amountPaise: bigint) => withTenant(T, (tx) => tx.insert(refunds).values({ id: uuidv7(), tenantId: T, paymentId: p.id, amountPaise, method: "cash", reason, refundedOn: "2026-09-24" }));
    await expect(refund("  ", 500n)).rejects.toSatisfy(fails(CHECK));
    await expect(refund("Overpaid", 0n)).rejects.toSatisfy(fails(CHECK));
  });
});

describe("an invoice's status follows what is paid (docs/02 §9 invariant 4)", () => {
  it("is never paid above its total, or below zero", async () => {
    const inv = await issuedInvoice(150_000n);
    const set = (patch: Partial<typeof invoices.$inferInsert>) => withTenant(T, (tx) => updateInvoice(tx, inv.id, patch));
    await expect(set({ paidPaise: 150_001n, status: "paid" })).rejects.toSatisfy(fails(CHECK));
    await expect(set({ paidPaise: -1n })).rejects.toSatisfy(fails(CHECK));
  });

  it("issued, part paid, paid and void each match the amount paid", async () => {
    const inv = await issuedInvoice(150_000n);
    const set = (patch: Partial<typeof invoices.$inferInsert>) => withTenant(T, (tx) => updateInvoice(tx, inv.id, patch));
    await expect(set({ paidPaise: 80_000n })).rejects.toSatisfy(fails(CHECK));
    expect((await set({ paidPaise: 80_000n, status: "part_paid" })).status).toBe("part_paid");
    await expect(set({ paidPaise: 150_000n })).rejects.toSatisfy(fails(CHECK));
    expect((await set({ paidPaise: 150_000n, status: "paid" })).status).toBe("paid");
    await expect(set({ paidPaise: 0n })).rejects.toSatisfy(fails(CHECK));
    await expect(set({ status: "void", voidReason: "Money still on it" })).rejects.toSatisfy(fails(CHECK));
    expect((await set({ paidPaise: 0n, status: "void", voidReason: "Released to the advance" })).status).toBe("void");
  });

  it("a draft can hold no money", async () => {
    const draft = await withTenant(T, (tx) => insertInvoice(tx, { tenantId: T, branchId, householdId, issueDate: "2026-09-01", dueDate: "2026-09-08", subtotalPaise: 1_000n, totalPaise: 1_000n }));
    await expect(withTenant(T, (tx) => updateInvoice(tx, draft.id, { paidPaise: 500n }))).rejects.toSatisfy(fails(CHECK));
  });
});
