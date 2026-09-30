import postgres from "postgres";
import { getEnv } from "@/lib/env";
import { takeTestPlans } from "./academy";
import { readAppCatalog } from "./catalog";

// Test-only. audit_log is append-only for both app roles, so removing test
// tenants needs the owner connection. Deletes every tenant-scoped row for the
// given tenants, retrying tables until foreign keys allow it.
export async function deleteTenantsCompletely(tenantIds: string[]): Promise<void> {
  const url = getEnv().DATABASE_URL_MIGRATOR;
  if (!url) {
    console.warn("teardown skipped: DATABASE_URL_MIGRATOR is not set; test tenants were left in place");
    return;
  }
  const owner = postgres(url, { max: 1, onnotice: () => {} });
  try {
    let pending = (await readAppCatalog(owner)).filter((t) => t.hasTenantId).map((t) => t.table);
    for (let pass = 0; pending.length && pass < 10; pass++) {
      const failed: string[] = [];
      for (const table of pending) {
        try {
          await owner`DELETE FROM app.${owner(table)} WHERE tenant_id IN ${owner(tenantIds)}`;
        } catch {
          failed.push(table);
        }
      }
      pending = failed;
    }
    if (pending.length) throw new Error(`teardown could not clear: ${pending.join(", ")}`);
    await owner`DELETE FROM app.tenants WHERE id IN ${owner(tenantIds)}`;
    const planIds = await takeTestPlans();
    if (planIds.length) await owner`DELETE FROM app.activity_plans p WHERE p.id IN ${owner(planIds)} AND NOT EXISTS (SELECT 1 FROM app.activity_subscriptions s WHERE p.id IN (s.plan_id, s.next_plan_id))`;
    // Platform-level rows written by test setup carry no tenant_id.
    await owner`DELETE FROM app.audit_log WHERE action LIKE 'test.%'`;
  } finally {
    await owner.end({ timeout: 5 });
  }
}
