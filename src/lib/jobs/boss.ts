import { PgBoss } from "pg-boss";
import { getEnv } from "@/lib/env";

// Schema comes from migration 0009, so the app role never migrates it.
// reindex needs table ownership; LISTEN/NOTIFY (off by default) breaks under the pooler.
export function createBoss(): PgBoss {
  return new PgBoss({ connectionString: getEnv().DATABASE_URL, schema: "pgboss", migrate: false, reindex: false, max: 4, application_name: "bravitar-worker" });
}
