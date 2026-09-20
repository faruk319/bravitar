import { z } from "zod";

// Two connection strings by design: migrations run as the table owner,
// the app runs as app_runtime (NOBYPASSRLS). They must never be the same.
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_URL_MIGRATOR: z.url({ protocol: /^postgres(ql)?$/ }),
  })
  .refine((e) => e.DATABASE_URL !== e.DATABASE_URL_MIGRATOR, {
    message: "DATABASE_URL and DATABASE_URL_MIGRATOR must be different connections",
    path: ["DATABASE_URL"],
  });

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${issues.join("\n")}`);
  }
  return result.data;
}

let cached: Env | undefined;

// Parsed on first use, so importing this module never needs a live environment.
export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}
