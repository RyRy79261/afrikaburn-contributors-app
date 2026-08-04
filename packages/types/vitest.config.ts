import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      reportOnFailure: true,
      // Count every source file, not only the ones a test imports.
      include: ["src/**/*.ts"],
      exclude: ["**/__tests__/**", "**/*.d.ts"],
      // A ratchet, not a target. Raise these as coverage improves; never lower
      // one to make a build pass — the drop is the signal.
      thresholds: {
        lines: 43,
        statements: 39,
        functions: 9,
        branches: 4,
      },
    },
  },
});
