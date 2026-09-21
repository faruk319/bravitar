import { assertDatabaseSafety } from "@/lib/db/assert-safe";

// A failed safety check must take the process down: a server answering 500
// on every request would sit there unnoticed.
export async function assertSafeOrExit(): Promise<void> {
  try {
    await assertDatabaseSafety();
  } catch (err) {
    console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
