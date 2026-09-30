import { and, count, inArray, isNull } from "drizzle-orm";
import type { PlatformTx } from "@/lib/db/platform";
import { students } from "@/modules/students/schema";

// Active and paused students by home branch.
export async function studentsByBranch(tx: PlatformTx, tenantIds: string[]): Promise<Map<string, number>> {
  const rows = await tx
    .select({ branchId: students.branchId, n: count() })
    .from(students)
    .where(and(isNull(students.deletedAt), inArray(students.status, ["active", "paused"]), inArray(students.tenantId, tenantIds)))
    .groupBy(students.branchId);
  return new Map(rows.map((r) => [r.branchId, r.n]));
}
