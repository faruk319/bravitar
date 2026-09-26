import { and, count, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import type { PlatformTx } from "@/lib/db/platform";
import { staffUsers } from "@/modules/staff/schema";
import { students } from "@/modules/students/schema";
import { branches } from "@/modules/tenancy/schema";

// What counts against a plan's limits (agreed 2026-09-26): active and paused
// students, active staff (not yet signed in too) and branches. In an academy's
// own context its policies narrow this to that academy.
export type Usage = { students: number; staff: number; branches: number };
export const NO_USAGE: Usage = { students: 0, staff: 0, branches: 0 };

export async function usageByTenant(tx: Tx | PlatformTx, tenantIds?: string[]): Promise<Map<string, Usage>> {
  const [s, st, b] = [
    await tx
      .select({ tenantId: students.tenantId, n: count() })
      .from(students)
      .where(and(isNull(students.deletedAt), inArray(students.status, ["active", "paused"]), tenantIds ? inArray(students.tenantId, tenantIds) : undefined))
      .groupBy(students.tenantId),
    await tx
      .select({ tenantId: staffUsers.tenantId, n: count() })
      .from(staffUsers)
      .where(and(isNull(staffUsers.deletedAt), eq(staffUsers.isActive, true), tenantIds ? inArray(staffUsers.tenantId, tenantIds) : undefined))
      .groupBy(staffUsers.tenantId),
    await tx
      .select({ tenantId: branches.tenantId, n: count() })
      .from(branches)
      .where(and(isNull(branches.deletedAt), tenantIds ? inArray(branches.tenantId, tenantIds) : undefined))
      .groupBy(branches.tenantId),
  ];
  const out = new Map<string, Usage>();
  const add = (rows: { tenantId: string; n: number }[], key: keyof Usage) => {
    for (const r of rows) out.set(r.tenantId, { ...(out.get(r.tenantId) ?? NO_USAGE), [key]: r.n });
  };
  add(s, "students");
  add(st, "staff");
  add(b, "branches");
  return out;
}
