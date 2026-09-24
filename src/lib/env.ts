import { z } from "zod";

// Three connections by design: the migrator owns the tables, app_runtime cannot
// bypass RLS, app_platform is exempt and used only inside withPlatformAdmin().
const pgUrl = z.url({ protocol: /^postgres(ql)?$/ });

// The key in .env.example: fine on a laptop, in CI and for `next build`; src/lib/crypto
// refuses to seal or open with it in production.
export const DEV_ENCRYPTION_KEY = "A5LvtfaJNQU/QxUY21sSd81bAclD0fIUaNhDnXhjuF4=";
const base64Key = z
  .string()
  .refine((k) => /^[A-Za-z0-9+/]+={0,2}$/.test(k) && Buffer.from(k, "base64").length === 32, "must be 32 random bytes, base64");

const shape = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: pgUrl,
  DATABASE_URL_PLATFORM: pgUrl,
  DATABASE_URL_MIGRATOR: pgUrl.optional(),
  APP_RUNTIME_PASSWORD: z.string().optional(),
  APP_PLATFORM_PASSWORD: z.string().optional(),
  // Host tenants log in on: <slug>.<APP_DOMAIN>
  APP_DOMAIN: z.string().default("localhost:3000"),
  // Seals each academy's integration secrets (src/lib/crypto). Needed only once
  // someone connects Razorpay; the app starts without it.
  APP_ENCRYPTION_KEY: base64Key.optional(),
};

type UrlKeys = "DATABASE_URL" | "DATABASE_URL_PLATFORM" | "DATABASE_URL_MIGRATOR";

const distinctUrls = (e: { [K in UrlKeys]?: string | undefined }, ctx: z.RefinementCtx) => {
  const urls = [
    ["DATABASE_URL", e.DATABASE_URL],
    ["DATABASE_URL_PLATFORM", e.DATABASE_URL_PLATFORM],
    ["DATABASE_URL_MIGRATOR", e.DATABASE_URL_MIGRATOR],
  ].filter((pair): pair is [string, string] => typeof pair[1] === "string");
  for (let i = 0; i < urls.length; i++) {
    for (let j = i + 1; j < urls.length; j++) {
      const [a, b] = [urls[i], urls[j]];
      if (a && b && a[1] === b[1]) {
        ctx.addIssue({ code: "custom", path: [a[0]], message: `${a[0]} and ${b[0]} must be different connections` });
      }
    }
  }
};

const appSchema = z.object(shape).superRefine(distinctUrls);
const migratorSchema = z.object({ ...shape, DATABASE_URL_MIGRATOR: pgUrl }).superRefine(distinctUrls);

export type Env = z.infer<typeof appSchema>;
export type MigratorEnv = z.infer<typeof migratorSchema>;

// The Supabase service_role key bypasses RLS. It belongs to the migration runner's
// environment only; its mere presence here is a misconfiguration.
export function assertNoServiceRoleKey(source: Record<string, string | undefined>): void {
  const leaked = Object.keys(source).filter((k) => /SERVICE_ROLE/i.test(k));
  if (leaked.length) {
    throw new Error(`Refusing to start: ${leaked.join(", ")} must not be present in the application environment`);
  }
}

function parseWith<T>(schema: z.ZodType<T>, source: Record<string, string | undefined>): T {
  assertNoServiceRoleKey(source);
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${issues.join("\n")}`);
  }
  return result.data;
}

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  return parseWith(appSchema, source);
}

export function parseMigratorEnv(source: Record<string, string | undefined> = process.env): MigratorEnv {
  return parseWith(migratorSchema, source);
}

let cached: Env | undefined;

// Parsed on first use, so importing this module never needs a live environment.
export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}
