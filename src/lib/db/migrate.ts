import postgres from "postgres";
import { getEnv } from "@/lib/env";
import { loadMigrations } from "./migration-files";

// Runs as the table owner (DATABASE_URL_MIGRATOR), never as app_runtime.
// Bookkeeping lives in app.schema_migrations; each migration runs in its own
// transaction so a failed one leaves nothing behind.
const LOCK_KEY = 7_231_001;

async function main(command: string | undefined): Promise<void> {
  if (command !== "up" && command !== "down") {
    console.error("usage: migrate.ts <up|down>");
    process.exit(2);
  }

  const sql = postgres(getEnv().DATABASE_URL_MIGRATOR, { max: 1, onnotice: () => {} });
  try {
    await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;
    await sql`CREATE SCHEMA IF NOT EXISTS app`;
    await sql`
      CREATE TABLE IF NOT EXISTS app.schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`;

    const files = await loadMigrations();
    const byName = new Map(files.map((f) => [f.name, f]));
    const applied = (await sql<{ name: string }[]>`SELECT name FROM app.schema_migrations ORDER BY name`).map((r) => r.name);

    const missing = applied.filter((name) => !byName.has(name));
    if (missing.length) {
      throw new Error(`applied migrations missing from disk (migrations are append-only): ${missing.join(", ")}`);
    }

    if (command === "up") {
      const pending = files.filter((f) => !applied.includes(f.name));
      for (const m of pending) {
        await sql.begin(async (tx) => {
          await tx.unsafe(m.up);
          await tx`INSERT INTO app.schema_migrations (name) VALUES (${m.name})`;
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
      await tx.unsafe(m.down);
      await tx`DELETE FROM app.schema_migrations WHERE name = ${m.name}`;
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
