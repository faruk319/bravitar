import type { Tx } from "@/lib/db/client";
import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { uuidv7 } from "@/lib/ids";
import { createProgram, insertBatch } from "@/modules/batches/repo";
import { enrollments } from "@/modules/enrollments/schema";
import { insertStudent } from "@/modules/students/repo";
import { createBranch } from "@/modules/tenancy/repo";
import { insertPack } from "./packs";
import { insertDiscount, insertInvoice, insertLines, insertPlan, insertStudentDiscount } from "./repo";

const stamp = () => Math.random().toString(36).slice(2, 8);

async function family(tx: Tx, tenantId: string) {
  const branch = await createBranch(tx, { tenantId, name: `Branch ${stamp()}` });
  const student = await insertStudent(tx, { tenantId, branchId: branch.id, fullName: "Iso Kid", code: `ISO/${stamp()}` });
  return { branch, student };
}

async function invoice(tx: Tx, tenantId: string) {
  const { branch, student } = await family(tx, tenantId);
  return insertInvoice(tx, { tenantId, branchId: branch.id, studentId: student.id, issueDate: "2026-01-01", dueDate: "2026-01-08" });
}

export const feeFixtures: IsolationFixtures = {
  fee_plans: (tx, tenantId) => insertPlan(tx, { tenantId, name: `Iso ${stamp()}`, billingCycle: "monthly", amountPaise: 80_000n }),
  discounts: (tx, tenantId) => insertDiscount(tx, { tenantId, name: "Iso", kind: "percent", value: 10 }),
  student_discounts: async (tx, tenantId) => {
    const { student } = await family(tx, tenantId);
    const d = await insertDiscount(tx, { tenantId, name: "Iso", kind: "percent", value: 10 });
    return insertStudentDiscount(tx, { tenantId, studentId: student.id, discountId: d.id, reason: "Iso", validFrom: "2026-01-01" });
  },
  invoices: invoice,
  session_packs: async (tx, tenantId) => {
    const inv = await invoice(tx, tenantId);
    const program = await createProgram(tx, { tenantId, name: `Program ${stamp()}`, activityKey: "general" });
    const batch = await insertBatch(tx, { tenantId, branchId: inv.branchId, programId: program.id, name: "Iso", startDate: "2026-01-01" });
    const [e] = await tx.insert(enrollments).values({ id: uuidv7(), tenantId, studentId: inv.studentId, batchId: batch.id, startDate: "2026-01-01" }).returning();
    return insertPack(tx, { tenantId, enrollmentId: e?.id ?? "", studentId: inv.studentId, invoiceId: inv.id, sessions: 5, validFrom: "2026-01-01", validUntil: "2026-01-30" });
  },
  invoice_lines: async (tx, tenantId) => insertLines(tx, [{ tenantId, invoiceId: (await invoice(tx, tenantId)).id, kind: "other", description: "Iso", unitPaise: 100n, amountPaise: 100n }]),
};
