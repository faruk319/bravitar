import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://app_runtime:x@127.0.0.1:54329/postgres",
  DATABASE_URL_MIGRATOR: "postgresql://postgres:x@127.0.0.1:54322/postgres",
};

describe("parseEnv", () => {
  it("accepts two distinct postgres URLs", () => {
    const env = parseEnv(valid);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.NODE_ENV).toBe("development");
  });

  it("refuses to boot when both URLs are the same connection", () => {
    expect(() =>
      parseEnv({ ...valid, DATABASE_URL: valid.DATABASE_URL_MIGRATOR }),
    ).toThrow(/must be different/);
  });

  it("refuses when a URL is missing", () => {
    expect(() => parseEnv({ DATABASE_URL: valid.DATABASE_URL })).toThrow(
      /DATABASE_URL_MIGRATOR/,
    );
  });

  it("refuses a non-postgres URL", () => {
    expect(() =>
      parseEnv({ ...valid, DATABASE_URL: "mysql://root@localhost/db" }),
    ).toThrow(/DATABASE_URL/);
  });
});
