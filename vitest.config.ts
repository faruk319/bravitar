import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = { "@": path.resolve(import.meta.dirname, "src") };

// `unit` is the everyday suite. `isolation` is the tenant-leak suite and needs
// a database; it is run on its own and must never pass by having no files.
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
        test: { name: "isolation", include: ["src/**/*.isolation.test.ts"] },
      },
    ],
  },
});
