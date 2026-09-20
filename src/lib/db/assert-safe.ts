import type { Sql } from "postgres";
import { sql as runtimeSql } from "./client";
import { platformSql } from "./platform";

type RoleFacts = { rolname: string; rolsuper: boolean; rolbypassrls: boolean; owned_app_tables: number };

async function roleFacts(conn: Sql): Promise<RoleFacts> {
  const [row] = await conn<RoleFacts[]>`
    SELECT r.rolname, r.rolsuper, r.rolbypassrls,
           (SELECT count(*)::int FROM pg_tables t WHERE t.schemaname = 'app' AND t.tableowner = r.rolname) AS owned_app_tables
      FROM pg_roles r WHERE r.rolname = current_user`;
  if (!row) throw new Error("could not read the connection's role from pg_roles");
  return row;
}

// Called once at process start (Next instrumentation, later the worker). A wrong
// connection string turns RLS into decoration, so it is a crash, not a warning.
export async function assertDatabaseSafety(): Promise<void> {
  const runtime = await roleFacts(runtimeSql);
  if (runtime.rolsuper) throw new Error(`DATABASE_URL connects as superuser "${runtime.rolname}"; use the app_runtime role`);
  if (runtime.rolbypassrls) throw new Error(`DATABASE_URL role "${runtime.rolname}" can bypass RLS; use the app_runtime role`);
  if (runtime.owned_app_tables > 0) throw new Error(`DATABASE_URL role "${runtime.rolname}" owns tables in schema app; it must own nothing`);

  const platform = await roleFacts(platformSql);
  if (platform.rolsuper) throw new Error(`DATABASE_URL_PLATFORM connects as superuser "${platform.rolname}"; use the app_platform role`);
  if (!platform.rolbypassrls) throw new Error(`DATABASE_URL_PLATFORM role "${platform.rolname}" is not exempt from RLS; use the app_platform role`);
  if (platform.owned_app_tables > 0) throw new Error(`DATABASE_URL_PLATFORM role "${platform.rolname}" owns tables in schema app; it must own nothing`);
}
