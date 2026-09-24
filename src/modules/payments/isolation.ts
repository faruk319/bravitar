import type { Tx } from "@/lib/db/client";
import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { uuidv7 } from "@/lib/ids";
import { insertInvoice } from "@/modules/fees/repo";
import { createHousehold } from "@/modules/students/repo";
import { createBranch } from "@/modules/tenancy/repo";
import { type Payment, paymentAllocations, payments, refunds } from "./schema";

const stamp = () => Math.random().toString(36).slice(2, 8);

async function payment(tx: Tx, tenantId: string): Promise<Payment> {
  const branch = await createBranch(tx, { tenantId, name: `Branch ${stamp()}` });
  const household = await createHousehold(tx, { tenantId, name: "Iso family" });
  const [p] = await tx
    .insert(payments)
    .values({ id: uuidv7(), tenantId, branchId: branch.id, householdId: household.id, receiptNumber: `RCT/ISO/${stamp()}`, fy: "2099-00", method: "cash", amountPaise: 150_000n, receivedOn: "2026-01-01", recordedOn: "2026-01-01" })
    .returning();
  if (!p) throw new Error("payment fixture returned no row");
  return p;
}

export const paymentFixtures: IsolationFixtures = {
  payments: payment,
  refunds: async (tx, tenantId) =>
    tx.insert(refunds).values({ id: uuidv7(), tenantId, paymentId: (await payment(tx, tenantId)).id, amountPaise: 100n, method: "cash", reason: "Iso", refundedOn: "2026-01-01" }),
  payment_allocations: async (tx, tenantId) => {
    const p = await payment(tx, tenantId);
    const inv = await insertInvoice(tx, { tenantId, branchId: p.branchId, householdId: p.householdId, issueDate: "2026-01-01", dueDate: "2026-01-08" });
    return tx.insert(paymentAllocations).values({ id: uuidv7(), tenantId, paymentId: p.id, invoiceId: inv.id, kind: "receipt", amountPaise: 100n });
  },
};
