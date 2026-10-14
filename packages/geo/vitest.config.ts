import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      reportOnFailure: true,
      include: ["src/**/*.ts"],
      exclude: ["**/__tests__/**", "**/*.d.ts", "src/index.ts"],
      // A ratchet, not a target: pure geometry with no I/O, so it is held
      // high. Raise as coverage improves; never lower one to pass a build.
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 95,
        branches: 90,
      },
    },
  },
});
