import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";

// Platform-admin connection (app_platform role, exempt from RLS). The only way
// to touch data across tenants, and every call carries an audit entry.
export const platformSql = postgres(getEnv().DATABASE_URL_PLATFORM, { prepare: false });

export const platformDb = drizzle(platformSql);

export type PlatformTx = Parameters<Parameters<typeof platformDb.transaction>[0]>[0];

export type AuditEntry = {
  action: string; // 'tenant.create', 'tenant.suspend', ...
  actorType: "platform" | "system";
  actorId?: string;
  impersonatedBy?: string;
};

// TODO(slice-2): insert into app.audit_log once the table exists.
function recordAudit(entry: AuditEntry): void {
  console.info(`[audit] ${JSON.stringify(entry)}`);
}

export async function withPlatformAdmin<T>(entry: AuditEntry, fn: (tx: PlatformTx) => Promise<T>): Promise<T> {
  const result = await platformDb.transaction(fn);
  recordAudit(entry);
  return result;
}
