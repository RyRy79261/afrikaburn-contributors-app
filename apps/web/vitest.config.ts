import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Modules under test are marked `server-only`, which throws when resolved
      // outside a server context. Aliased to a no-op so the real module can be
      // executed here; the bundler still sees the real package in a build.
      "server-only": path.join(dir, "test/stubs/server-only.ts"),
      "@": dir,
    },
  },
});
