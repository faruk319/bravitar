import type { Tx } from "@/lib/db/client";
import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { uuidv7 } from "@/lib/ids";
import { insertInvoice } from "@/modules/fees/repo";
import { createBranch } from "@/modules/tenancy/repo";
import { insertStudent } from "@/modules/students/repo";
import { insertPayment } from "./repo";
import { type Payment, paymentAllocations, paymentLinks, refunds } from "./schema";

const stamp = () => Math.random().toString(36).slice(2, 8);

const student = (tx: Tx, tenantId: string, branchId: string) => insertStudent(tx, { tenantId, branchId, fullName: "Iso Kid", code: `ISO/${stamp()}` });

async function payment(tx: Tx, tenantId: string): Promise<Payment> {
  const branch = await createBranch(tx, { tenantId, name: `Branch ${stamp()}` });
  return insertPayment(tx, { tenantId, branchId: branch.id, receiptNumber: `RCT/ISO/${stamp()}`, fy: "2099-00", method: "cash", amountPaise: 150_000n, receivedOn: "2026-01-01", recordedOn: "2026-01-01", billToName: "Iso Payer" });
}

export const paymentFixtures: IsolationFixtures = {
  payments: payment,
  refunds: async (tx, tenantId) =>
    tx.insert(refunds).values({ id: uuidv7(), tenantId, paymentId: (await payment(tx, tenantId)).id, amountPaise: 100n, method: "cash", reason: "Iso", refundedOn: "2026-01-01" }),
  payment_allocations: async (tx, tenantId) => {
    const p = await payment(tx, tenantId);
    const inv = await insertInvoice(tx, { tenantId, branchId: p.branchId, studentId: (await student(tx, tenantId, p.branchId)).id, issueDate: "2026-01-01", dueDate: "2026-01-08" });
    return tx.insert(paymentAllocations).values({ id: uuidv7(), tenantId, paymentId: p.id, invoiceId: inv.id, kind: "receipt", amountPaise: 100n });
  },
  payment_links: async (tx, tenantId) => {
    const p = await payment(tx, tenantId);
    const inv = await insertInvoice(tx, { tenantId, branchId: p.branchId, studentId: (await student(tx, tenantId, p.branchId)).id, issueDate: "2026-01-01", dueDate: "2026-01-08" });
    return tx.insert(paymentLinks).values({ id: uuidv7(), tenantId, invoiceId: inv.id, gatewayLinkId: `plink_${stamp()}`, shortUrl: "https://rzp.io/i/iso", amountPaise: 100n });
  },
};
