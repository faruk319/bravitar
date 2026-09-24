import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { platformRead } from "@/lib/db/platform";
import { withTenant } from "@/lib/db/with-tenant";
import { tenants } from "@/modules/tenancy/schema";

export type TenantRun = { tenants: number; ok: number; failed: { tenantId: string; slug: string; error: string }[] };

// docs/01 jobs: every active tenant in its own withTenant; one failing tenant
// is reported and the rest carry on.
export async function forEachTenant(job: string, fn: (tx: Tx, tenantId: string) => Promise<void>, tenantIds?: string[]): Promise<TenantRun> {
  const list = await platformRead((tx) =>
    tx
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(and(eq(tenants.status, "active"), isNull(tenants.deletedAt), tenantIds ? inArray(tenants.id, tenantIds) : undefined)),
  );
  const run: TenantRun = { tenants: list.length, ok: 0, failed: [] };
  for (const t of list) {
    try {
      await withTenant(t.id, (tx) => fn(tx, t.id));
      run.ok++;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      run.failed.push({ tenantId: t.id, slug: t.slug, error });
      console.error(`${job}: ${t.slug} failed: ${error}`);
    }
  }
  return run;
}
