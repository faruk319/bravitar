import type { IsolationFixtures } from "@/lib/db/isolation/types";
import { uuidv7 } from "@/lib/ids";
import { createProgram, insertBatch } from "@/modules/batches/repo";
import { sessions } from "@/modules/sessions/schema";
import { createHousehold, insertStudent } from "@/modules/students/repo";
import { createBranch } from "@/modules/tenancy/repo";
import { attendance } from "./schema";

const stamp = () => Math.random().toString(36).slice(2, 8);

export const attendanceFixtures: IsolationFixtures = {
  attendance: async (tx, tenantId) => {
    const program = await createProgram(tx, { tenantId, name: `Program ${stamp()}` });
    const branch = await createBranch(tx, { tenantId, name: `Branch ${stamp()}` });
    const batch = await insertBatch(tx, { tenantId, branchId: branch.id, programId: program.id, name: "Iso", startDate: "2026-01-01" });
    const [session] = await tx
      .insert(sessions)
      .values({ id: uuidv7(), tenantId, branchId: branch.id, batchId: batch.id, startsAt: new Date("2026-10-05T12:30:00Z"), endsAt: new Date("2026-10-05T13:30:00Z"), sessionDate: "2026-10-05" })
      .returning();
    const household = await createHousehold(tx, { tenantId, name: "Iso family" });
    const student = await insertStudent(tx, { tenantId, branchId: branch.id, householdId: household.id, fullName: "Iso Kid", code: `ISO/${stamp()}` });
    return tx.insert(attendance).values({ id: uuidv7(), tenantId, sessionId: session?.id ?? "", studentId: student.id, status: "present" });
  },
};
