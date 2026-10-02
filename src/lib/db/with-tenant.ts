import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "./client";

const idSchema = z.uuid();

// Every tenant-scoped query runs inside this. The tenant id is a bound parameter
// and the setting is transaction-local, so a pooled connection cannot carry one
// tenant's context into the next request. Fails closed when no context is set.
// impersonatedBy: audit rows written inside are tagged with it (migration 0033).
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>, opts: { impersonatedBy?: string | undefined } = {}): Promise<T> {
  const id = idSchema.parse(tenantId);
  const by = opts.impersonatedBy ? idSchema.parse(opts.impersonatedBy) : "";
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${id}, true), set_config('app.impersonated_by', ${by}, true)`);
    return fn(tx);
  });
}
