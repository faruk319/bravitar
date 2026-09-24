import { assertDatabaseSafety } from "@/lib/db/assert-safe";
import { createBoss } from "@/lib/jobs/boss";
import { NUMBERS_OPEN_YEAR, workOpenYear } from "@/modules/numbering/job";
import { SESSIONS_GENERATE, workSessionsGenerate } from "@/modules/sessions/job";

// Background jobs: `pnpm worker`.
async function main(): Promise<void> {
  await assertDatabaseSafety();
  const boss = createBoss();
  boss.on("error", (err) => console.error("pg-boss:", err));
  await boss.start();
  await workSessionsGenerate(boss);
  await boss.schedule(SESSIONS_GENERATE, "30 1 * * *", null, { tz: "Asia/Kolkata" });
  await boss.send(SESSIONS_GENERATE); // catch up after downtime or a deploy
  await workOpenYear(boss);
  await boss.schedule(NUMBERS_OPEN_YEAR, "5 0 * * *", null, { tz: "Asia/Kolkata" });
  await boss.send(NUMBERS_OPEN_YEAR);
  console.log(`worker: ${SESSIONS_GENERATE} nightly at 01:30, ${NUMBERS_OPEN_YEAR} daily at 00:05 (Asia/Kolkata)`);
  const stop = () => void boss.stop().then(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((err: unknown) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
