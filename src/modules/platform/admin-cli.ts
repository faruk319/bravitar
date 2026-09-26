import { pathToFileURL } from "node:url";
import { newToken } from "@/lib/auth/token";
import { otpauthUrl } from "@/lib/auth/totp";
import { sql as runtimeSql } from "@/lib/db/client";
import { platformSql } from "@/lib/db/platform";
import { createPlatformAdmin } from "./auth";

// pnpm platform:admin <email> "<name>": a /platform admin with a new password
// and authenticator key, both printed once. Add the key to Google
// Authenticator (or similar) as a setup key.
async function main(): Promise<void> {
  const [email = "", fullName = ""] = process.argv.slice(2);
  if (!email || !fullName) throw new Error('Usage: pnpm platform:admin <email> "<full name>"');
  const password = newToken().slice(0, 20);
  const { secret } = await createPlatformAdmin({ email, fullName, password });
  console.log(`platform admin: ${email}`);
  console.log(`password (shown once): ${password}`);
  console.log(`authenticator setup key (shown once): ${secret.replace(/(.{4})/g, "$1 ").trim()}`);
  console.log(`or open: ${otpauthUrl(secret, email)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await runtimeSql.end({ timeout: 5 });
      await platformSql.end({ timeout: 5 });
    });
}
