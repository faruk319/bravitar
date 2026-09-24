import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import type { PlatformTx } from "@/lib/db/platform";
import { todayIn } from "@/lib/dates";
import { financialYear } from "@/lib/money/fy";
import { getOwnTenant } from "@/modules/tenancy/repo";
import { DOC_KINDS, type DocKind, numberSeries } from "./schema";

const PREFIX: Record<DocKind, string> = { invoice: "INV", receipt: "RCT" };

// Both series for a financial year; safe to repeat.
export async function ensureSeries(tx: Tx | PlatformTx, tenantId: string, fy: string): Promise<void> {
  await tx
    .insert(numberSeries)
    .values(DOC_KINDS.map((kind) => ({ tenantId, kind, fy, prefix: `${PREFIX[kind]}/${fy}/` })))
    .onConflictDoNothing();
}

// The tenant's financial year today, in its own timezone.
export async function currentFy(tx: Tx, now = new Date()): Promise<string> {
  const t = await getOwnTenant(tx);
  if (!t) throw new Error("currentFy: no tenant on this transaction");
  return financialYear(todayIn(t.timezone, now), t.fyStartMonth);
}

// docs/01 "Document numbering": gapless because it lives in the caller's
// transaction (a rollback gives the number back), unique because the UPDATE
// holds the row lock until commit. INV/2026-27/0042.
export async function allocateNumber(tx: Tx, tenantId: string, kind: DocKind, fy: string): Promise<string> {
  await ensureSeries(tx, tenantId, fy);
  const [row] = await tx
    .update(numberSeries)
    .set({ nextValue: sql`${numberSeries.nextValue} + 1` })
    .where(and(eq(numberSeries.tenantId, tenantId), eq(numberSeries.kind, kind), eq(numberSeries.fy, fy)))
    .returning({ prefix: numberSeries.prefix, assigned: sql<number>`${numberSeries.nextValue} - 1` });
  if (!row) throw new Error("allocateNumber: series row missing");
  return `${row.prefix}${String(row.assigned).padStart(4, "0")}`;
}
