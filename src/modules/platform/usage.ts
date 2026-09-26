import { and, count, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import type { PlatformTx } from "@/lib/db/platform";
import { staffUsers } from "@/modules/staff/schema";
import { students } from "@/modules/students/schema";

// A branch's plan limits its students (agreed 2026-09-26): active and paused
// students whose home branch it is. In an academy's own context its policies
// narrow this to that academy.
export async function studentsByBranch(tx: Tx | PlatformTx, opts: { tenantIds?: string[]; branchIds?: string[] } = {}): Promise<Map<string, number>> {
  const rows = await tx
    .select({ branchId: students.branchId, n: count() })
    .from(students)
    .where(
      and(
        isNull(students.deletedAt),
        inArray(students.status, ["active", "paused"]),
        opts.tenantIds ? inArray(students.tenantId, opts.tenantIds) : undefined,
        opts.branchIds ? inArray(students.branchId, opts.branchIds) : undefined,
      ),
    )
    .groupBy(students.branchId);
  return new Map(rows.map((r) => [r.branchId, r.n]));
}

// Active staff, those who haven't signed in yet included; not limited.
export async function staffByTenant(tx: PlatformTx, tenantIds: string[]): Promise<Map<string, number>> {
  const rows = await tx
    .select({ tenantId: staffUsers.tenantId, n: count() })
    .from(staffUsers)
    .where(and(isNull(staffUsers.deletedAt), eq(staffUsers.isActive, true), inArray(staffUsers.tenantId, tenantIds)))
    .groupBy(staffUsers.tenantId);
  return new Map(rows.map((r) => [r.tenantId, r.n]));
}
