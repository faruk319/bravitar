import { eq } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { ConflictError } from "@/lib/errors";
import { branches } from "@/modules/tenancy/schema";
import { branchSubscriptions, platformPlans } from "./schema";
import { studentsByBranch } from "./usage";

// A branch's plan caps its students (agreed 2026-09-26): active and paused,
// by home branch. No plan, or no cap, means no check.
export async function assertStudentRoom(tx: Tx, branchId: string): Promise<void> {
  const [row] = await tx
    .select({ max: platformPlans.maxStudents, name: branches.name })
    .from(branchSubscriptions)
    .innerJoin(platformPlans, eq(platformPlans.code, branchSubscriptions.planCode))
    .innerJoin(branches, eq(branches.id, branchSubscriptions.branchId))
    .where(eq(branchSubscriptions.branchId, branchId));
  if (row?.max === null || row?.max === undefined) return;
  const used = (await studentsByBranch(tx, { branchIds: [branchId] })).get(branchId) ?? 0;
  if (used >= row.max) throw new ConflictError(`${row.name}'s plan allows ${row.max} students. Ask Bravitar to upgrade it.`);
}
