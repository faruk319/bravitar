// Runs once when the Next.js server starts. The Node-only body lives in a
// separate module so the edge bundle never sees process.exit.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertSafeOrExit } = await import("./instrumentation.node");
    await assertSafeOrExit();
  }
}
