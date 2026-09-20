import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import { type AuditEntry, writeAudit } from "./audit";

// Platform-admin connection (app_platform role, exempt from RLS). The only way
// to touch data across tenants.
export const platformSql = postgres(getEnv().DATABASE_URL_PLATFORM, { prepare: false });

export const platformDb = drizzle(platformSql);

export type PlatformTx = Parameters<Parameters<typeof platformDb.transaction>[0]>[0];

export type { AuditEntry };

// Every write goes through here. The audit row commits with the work or not at
// all; the callback may fill in ids it only learns mid-transaction.
export async function withPlatformAdmin<T>(entry: AuditEntry, fn: (tx: PlatformTx, audit: AuditEntry) => Promise<T>): Promise<T> {
  return platformDb.transaction(async (tx) => {
    const audit: AuditEntry = { ...entry };
    const result = await fn(tx, audit);
    await writeAudit(tx, audit);
    return result;
  });
}

// Cross-tenant reads (tenant lists, slug checks). Postgres rejects any write
// inside, so this cannot become an unaudited write path.
export async function platformRead<T>(fn: (tx: PlatformTx) => Promise<T>): Promise<T> {
  return platformDb.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return fn(tx);
  });
}
