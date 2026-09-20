import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

const alias = { "@": path.resolve(import.meta.dirname, "src") };
const dotenv = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};

// `unit` is the everyday suite and needs no database. `isolation` is the
// tenant-leak suite: it reads .env, needs the local stack, is run on its own,
// and must never pass by having no files.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.isolation.test.ts", "**/node_modules/**"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "isolation",
          include: ["src/**/*.isolation.test.ts"],
          env: dotenv,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
