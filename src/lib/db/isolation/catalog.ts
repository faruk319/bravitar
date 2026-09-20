import type { Sql } from "postgres";

export type PolicyFacts = { policyname: string; roles: string[]; cmd: string; qual: string | null; with_check: string | null };

export type TableFacts = {
  table: string;
  hasTenantId: boolean;
  rlsEnabled: boolean;
  rlsForced: boolean;
  policies: PolicyFacts[];
};

// Reads the live catalog for schema `app`, so a table added by any migration is
// checked automatically whether or not anyone remembered to register it.
export async function readAppCatalog(conn: Sql): Promise<TableFacts[]> {
  const tables = await conn<{ table: string; rls_enabled: boolean; rls_forced: boolean; has_tenant_id: boolean }[]>`
    SELECT c.relname AS "table",
           c.relrowsecurity AS rls_enabled,
           c.relforcerowsecurity AS rls_forced,
           EXISTS (
             SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
           ) AS has_tenant_id
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p')
     ORDER BY c.relname`;

  const policies = await conn<{ tablename: string; policyname: string; roles: string[]; cmd: string; qual: string | null; with_check: string | null }[]>`
    SELECT tablename, policyname, roles::text[] AS roles, cmd, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'app'
     ORDER BY tablename, policyname`;

  return tables.map((t) => ({
    table: t.table,
    hasTenantId: t.has_tenant_id,
    rlsEnabled: t.rls_enabled,
    rlsForced: t.rls_forced,
    policies: policies
      .filter((p) => p.tablename === t.table)
      .map((p) => ({ policyname: p.policyname, roles: p.roles, cmd: p.cmd, qual: p.qual, with_check: p.with_check })),
  }));
}
