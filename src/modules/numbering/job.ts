import type { PgBoss } from "pg-boss";
import { forEachTenant, type TenantRun } from "@/lib/jobs/tenants";
import { currentFy, ensureSeries } from "./repo";

export const NUMBERS_OPEN_YEAR = "numbers.open_year";

// Runs daily; on the first day of a financial year it opens that year's series.
export function runOpenYear(opts: { now?: Date; tenantIds?: string[] } = {}): Promise<TenantRun> {
  return forEachTenant(NUMBERS_OPEN_YEAR, async (tx, tenantId) => ensureSeries(tx, tenantId, await currentFy(tx, opts.now)), opts.tenantIds);
}

export async function workOpenYear(boss: PgBoss): Promise<void> {
  await boss.createQueue(NUMBERS_OPEN_YEAR);
  await boss.work<{ tenantIds?: string[] } | null, TenantRun>(NUMBERS_OPEN_YEAR, async ([job]) => runOpenYear(job?.data?.tenantIds ? { tenantIds: job.data.tenantIds } : {}));
}
