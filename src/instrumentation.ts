// Runs once when the Next.js server starts. A failed safety check must take
// the process down (a 500-on-every-request server would sit there unnoticed).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { assertDatabaseSafety } = await import("@/lib/db/assert-safe");
    await assertDatabaseSafety();
  } catch (err) {
    console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
