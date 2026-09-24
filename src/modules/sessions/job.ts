import type { PgBoss } from "pg-boss";
import { forEachTenant, type TenantRun } from "@/lib/jobs/tenants";
import { reconcileSessions } from "./reconcile";

export const SESSIONS_GENERATE = "sessions.generate";

type GenerateSummary = TenantRun & { created: number; cancelled: number; restored: number; removed: number };

export async function runSessionsGenerate(opts: { now?: Date; tenantIds?: string[] } = {}): Promise<GenerateSummary> {
  const now = opts.now ?? new Date();
  const totals = { created: 0, cancelled: 0, restored: 0, removed: 0 };
  const run = await forEachTenant(
    SESSIONS_GENERATE,
    async (tx) => {
      const r = await reconcileSessions(tx, { now });
      for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r[k];
    },
    opts.tenantIds,
  );
  return { ...run, ...totals };
}

export async function workSessionsGenerate(boss: PgBoss): Promise<void> {
  await boss.createQueue(SESSIONS_GENERATE);
  await boss.work<{ tenantIds?: string[] } | null, GenerateSummary>(SESSIONS_GENERATE, async ([job]) =>
    runSessionsGenerate(job?.data?.tenantIds ? { tenantIds: job.data.tenantIds } : {}),
  );
}
