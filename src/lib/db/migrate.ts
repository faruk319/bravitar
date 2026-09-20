import postgres from "postgres";
import { parseMigratorEnv } from "@/lib/env";
import { loadMigrations } from "./migration-files";

// Runs as the table owner (DATABASE_URL_MIGRATOR), never as app_runtime.
// Bookkeeping lives in migrations.applied, outside `app`, so `app` holds product
// tables only. Each migration runs in its own transaction.
const LOCK_KEY = 7_231_001;

async function main(command: string | undefined): Promise<void> {
  if (command !== "up" && command !== "down") {
    console.error("usage: migrate.ts <up|down>");
    process.exit(2);
  }

  const env = parseMigratorEnv();
  const sql = postgres(env.DATABASE_URL_MIGRATOR, { max: 1, onnotice: () => {} });
  try {
    await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;
    await sql`CREATE SCHEMA IF NOT EXISTS migrations`;
    await sql`
      CREATE TABLE IF NOT EXISTS migrations.applied (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`;
    // Role passwords reach migration 0001 as session settings, bound here, never
    // interpolated into SQL text.
    if (env.APP_RUNTIME_PASSWORD) await sql`SELECT set_config('app.runtime_password', ${env.APP_RUNTIME_PASSWORD}, false)`;
    if (env.APP_PLATFORM_PASSWORD) await sql`SELECT set_config('app.platform_password', ${env.APP_PLATFORM_PASSWORD}, false)`;

    const files = await loadMigrations();
    const byName = new Map(files.map((f) => [f.name, f]));
    const applied = (await sql<{ name: string }[]>`SELECT name FROM migrations.applied ORDER BY name`).map((r) => r.name);

    const missing = applied.filter((name) => !byName.has(name));
    if (missing.length) {
      throw new Error(`applied migrations missing from disk (migrations are append-only): ${missing.join(", ")}`);
    }

    if (command === "up") {
      const pending = files.filter((f) => !applied.includes(f.name));
      for (const m of pending) {
        await sql.begin(async (tx) => {
          await tx`SET LOCAL search_path = app, extensions, public`;
          await tx.unsafe(m.up);
          await tx`INSERT INTO migrations.applied (name) VALUES (${m.name})`;
        });
        console.log(`applied   ${m.name}`);
      }
      console.log(`migrate up: ${pending.length} applied, ${applied.length + pending.length}/${files.length} total`);
      return;
    }

    const last = applied.at(-1);
    if (!last) {
      console.log("migrate down: nothing applied");
      return;
    }
    const m = byName.get(last);
    if (!m) throw new Error(`unreachable: ${last} not on disk`);
    await sql.begin(async (tx) => {
      await tx`SET LOCAL search_path = app, extensions, public`;
      await tx.unsafe(m.down);
      await tx`DELETE FROM migrations.applied WHERE name = ${m.name}`;
    });
    console.log(`reverted  ${m.name}`);
    console.log(`migrate down: ${applied.length - 1}/${files.length} remain`);
  } finally {
    await sql.end();
  }
}

main(process.argv[2]).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
