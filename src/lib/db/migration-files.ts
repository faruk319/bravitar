import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// A migration is `NNNN_snake_name.sql` with an `-- up` section followed by
// a `-- down` section. Files are append-only; numbers are contiguous from 0001.
export const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export type MigrationFile = {
  number: number;
  name: string;
  up: string;
  down: string;
};

export function splitMigration(source: string, name = "<migration>"): { up: string; down: string } {
  const lines = source.split(/\r?\n/);
  const marker = (word: string) => (line: string) => new RegExp(`^--\\s*${word}\\s*$`, "i").test(line.trim());
  const upAt = lines.findIndex(marker("up"));
  const downAt = lines.findIndex(marker("down"));
  if (upAt === -1) throw new Error(`${name}: missing "-- up" marker`);
  if (downAt === -1) throw new Error(`${name}: missing "-- down" marker`);
  if (downAt < upAt) throw new Error(`${name}: "-- down" must come after "-- up"`);
  const up = lines.slice(upAt + 1, downAt).join("\n").trim();
  const down = lines.slice(downAt + 1).join("\n").trim();
  if (!up) throw new Error(`${name}: empty "-- up" section`);
  if (!down) throw new Error(`${name}: empty "-- down" section`);
  return { up, down };
}

// Names must be 0001, 0002, ... with no gaps and no duplicates.
export function validateSequence(names: string[]): string[] {
  const parsed = names.map((n) => {
    const m = FILE_RE.exec(n);
    if (!m) throw new Error(`${n}: expected NNNN_snake_name.sql`);
    return { name: n, number: Number(m[1]) };
  });
  parsed.sort((a, b) => a.number - b.number);
  parsed.forEach((p, i) => {
    const expected = i + 1;
    if (p.number === expected) return;
    if (p.number < expected) throw new Error(`${p.name}: duplicate migration number`);
    throw new Error(`${p.name}: gap in migration numbers, expected ${String(expected).padStart(4, "0")}`);
  });
  return parsed.map((p) => p.name);
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const names = validateSequence(entries.filter((f) => f.endsWith(".sql")));
  return Promise.all(
    names.map(async (name) => {
      const source = await readFile(path.join(dir, name), "utf8");
      const m = FILE_RE.exec(name);
      if (!m) throw new Error(`${name}: expected NNNN_snake_name.sql`);
      return { number: Number(m[1]), name, ...splitMigration(source, name) };
    }),
  );
}
