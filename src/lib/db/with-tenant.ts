import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "./client";

const tenantIdSchema = z.uuid();

// Every tenant-scoped query runs inside this. The tenant id is a bound parameter
// and the setting is transaction-local, so a pooled connection cannot carry one
// tenant's context into the next request. Fails closed when no context is set.
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const id = tenantIdSchema.parse(tenantId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${id}, true)`);
    return fn(tx);
  });
}
