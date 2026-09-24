import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseEnv as parseDotenv } from "node:util";
import { assertNoServiceRoleKey, DEV_ENCRYPTION_KEY, parseEnv, parseMigratorEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://app_runtime.pooler-dev:x@127.0.0.1:54329/postgres",
  DATABASE_URL_PLATFORM: "postgresql://app_platform.pooler-dev:x@127.0.0.1:54329/postgres",
  DATABASE_URL_MIGRATOR: "postgresql://postgres:x@127.0.0.1:54322/postgres",
};

describe("parseEnv (application)", () => {
  it("accepts three distinct postgres URLs", () => {
    const env = parseEnv(valid);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.NODE_ENV).toBe("development");
  });

  it("does not require the migrator URL (least privilege in production)", () => {
    const rest = { DATABASE_URL: valid.DATABASE_URL, DATABASE_URL_PLATFORM: valid.DATABASE_URL_PLATFORM };
    expect(parseEnv(rest).DATABASE_URL_MIGRATOR).toBeUndefined();
  });

  it("refuses when the runtime URL equals the migrator URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: valid.DATABASE_URL_MIGRATOR })).toThrow(
      /DATABASE_URL and DATABASE_URL_MIGRATOR must be different/,
    );
  });

  it("refuses when the runtime URL equals the platform URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL_PLATFORM: valid.DATABASE_URL })).toThrow(
      /DATABASE_URL and DATABASE_URL_PLATFORM must be different/,
    );
  });

  it("refuses when a required URL is missing", () => {
    expect(() => parseEnv({ DATABASE_URL: valid.DATABASE_URL })).toThrow(/DATABASE_URL_PLATFORM/);
  });

  it("refuses a non-postgres URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://root@localhost/db" })).toThrow(/DATABASE_URL/);
  });

  it("refuses to start if a service_role key is present at all", () => {
    expect(() => parseEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: "eyJ..." })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY must not be present/,
    );
    expect(() => assertNoServiceRoleKey({ service_role: "x" })).toThrow(/service_role/);
    expect(() => assertNoServiceRoleKey({ SUPABASE_ANON_KEY: "x" })).not.toThrow();
  });
});

describe("parseMigratorEnv", () => {
  it("requires the migrator URL", () => {
    const rest = { DATABASE_URL: valid.DATABASE_URL, DATABASE_URL_PLATFORM: valid.DATABASE_URL_PLATFORM };
    expect(() => parseMigratorEnv(rest)).toThrow(/DATABASE_URL_MIGRATOR/);
  });

  it("passes role passwords through", () => {
    const env = parseMigratorEnv({ ...valid, APP_RUNTIME_PASSWORD: "a", APP_PLATFORM_PASSWORD: "b" });
    expect(env.APP_RUNTIME_PASSWORD).toBe("a");
    expect(env.APP_PLATFORM_PASSWORD).toBe("b");
  });
});

describe("APP_ENCRYPTION_KEY", () => {
  const key = Buffer.alloc(32, 7).toString("base64");

  it("is optional, and when given must be 32 bytes of base64", () => {
    expect(parseEnv(valid).APP_ENCRYPTION_KEY).toBeUndefined();
    expect(parseEnv({ ...valid, APP_ENCRYPTION_KEY: key }).APP_ENCRYPTION_KEY).toBe(key);
    expect(() => parseEnv({ ...valid, APP_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/APP_ENCRYPTION_KEY/);
    expect(() => parseEnv({ ...valid, APP_ENCRYPTION_KEY: "not base64!" })).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it("the development key from .env.example is refused in production", () => {
    const example = parseDotenv(readFileSync(".env.example", "utf8"));
    expect(example.APP_ENCRYPTION_KEY).toBe(DEV_ENCRYPTION_KEY);
    expect(parseEnv({ ...valid, APP_ENCRYPTION_KEY: DEV_ENCRYPTION_KEY }).APP_ENCRYPTION_KEY).toBe(DEV_ENCRYPTION_KEY);
    expect(() => parseEnv({ ...valid, NODE_ENV: "production", APP_ENCRYPTION_KEY: DEV_ENCRYPTION_KEY })).toThrow(/development key/);
    expect(parseEnv({ ...valid, NODE_ENV: "production", APP_ENCRYPTION_KEY: key }).APP_ENCRYPTION_KEY).toBe(key);
  });
});
