import type { Tx } from "@/lib/db/client";
import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { createHousehold, insertStudent } from "@/modules/students/repo";
import { createBranch } from "@/modules/tenancy/repo";
import { insertDiscount, insertInvoice, insertLines, insertPlan, insertStudentDiscount } from "./repo";

const stamp = () => Math.random().toString(36).slice(2, 8);

async function family(tx: Tx, tenantId: string) {
  const branch = await createBranch(tx, { tenantId, name: `Branch ${stamp()}` });
  const household = await createHousehold(tx, { tenantId, name: "Iso family" });
  const student = await insertStudent(tx, { tenantId, branchId: branch.id, householdId: household.id, fullName: "Iso Kid", code: `ISO/${stamp()}` });
  return { branch, household, student };
}

async function invoice(tx: Tx, tenantId: string) {
  const { branch, household } = await family(tx, tenantId);
  return insertInvoice(tx, { tenantId, branchId: branch.id, householdId: household.id, issueDate: "2026-01-01", dueDate: "2026-01-08" });
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
  invoice_lines: async (tx, tenantId) => insertLines(tx, [{ tenantId, invoiceId: (await invoice(tx, tenantId)).id, kind: "other", description: "Iso", unitPaise: 100n, amountPaise: 100n }]),
};
