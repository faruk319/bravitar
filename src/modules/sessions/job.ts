import { and, eq, inArray, isNull } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { platformRead } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { tenants } from "@/modules/tenancy/schema";
import { reconcileSessions } from "./reconcile";

export const SESSIONS_GENERATE = "sessions.generate";

type GenerateSummary = {
  tenants: number;
  ok: number;
  failed: { tenantId: string; slug: string; error: string }[];
  created: number;
  cancelled: number;
  restored: number;
  removed: number;
};

// docs/01 jobs: every tenant in its own withTenant; one failing tenant is
// reported and the rest carry on.
export async function runSessionsGenerate(opts: { now?: Date; tenantIds?: string[] } = {}): Promise<GenerateSummary> {
  const now = opts.now ?? new Date();
  const list = await platformRead((tx) =>
    tx
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(and(eq(tenants.status, "active"), isNull(tenants.deletedAt), opts.tenantIds ? inArray(tenants.id, opts.tenantIds) : undefined)),
  );
  const summary: GenerateSummary = { tenants: list.length, ok: 0, failed: [], created: 0, cancelled: 0, restored: 0, removed: 0 };
  for (const t of list) {
    try {
      const r = await withTenant(t.id, (tx) => reconcileSessions(tx, { now }));
      summary.ok++;
      summary.created += r.created;
      summary.cancelled += r.cancelled;
      summary.restored += r.restored;
      summary.removed += r.removed;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      summary.failed.push({ tenantId: t.id, slug: t.slug, error });
      console.error(`${SESSIONS_GENERATE}: ${t.slug} failed: ${error}`);
    }
  }
  return summary;
}

export async function workSessionsGenerate(boss: PgBoss): Promise<void> {
  await boss.createQueue(SESSIONS_GENERATE);
  await boss.work<{ tenantIds?: string[] } | null, GenerateSummary>(SESSIONS_GENERATE, async ([job]) =>
    runSessionsGenerate(job?.data?.tenantIds ? { tenantIds: job.data.tenantIds } : {}),
  );
}
