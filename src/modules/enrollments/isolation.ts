import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { uuidv7 } from "@/lib/ids";
import { createProgram, insertBatch } from "@/modules/batches/repo";
import { createHousehold, insertStudent } from "@/modules/students/repo";
import { createBranch } from "@/modules/tenancy/repo";
import { enrollments } from "./schema";

const stamp = () => Math.random().toString(36).slice(2, 8);

export const enrollmentFixtures: IsolationFixtures = {
  enrollments: async (tx, tenantId) => {
    const program = await createProgram(tx, { tenantId, name: `Program ${stamp()}`, activityKey: "general" });
    const branch = await createBranch(tx, { tenantId, name: `Branch ${stamp()}` });
    const batch = await insertBatch(tx, { tenantId, branchId: branch.id, programId: program.id, name: "Iso", startDate: "2026-01-01" });
    const household = await createHousehold(tx, { tenantId, name: "Iso family" });
    const student = await insertStudent(tx, { tenantId, branchId: branch.id, householdId: household.id, fullName: "Iso Kid", code: `ISO/${stamp()}` });
    return tx.insert(enrollments).values({ id: uuidv7(), tenantId, studentId: student.id, batchId: batch.id, startDate: "2026-01-01" });
  },
};
