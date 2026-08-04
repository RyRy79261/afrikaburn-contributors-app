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
      // A ratchet, not a target. Raise it as coverage improves; never lower it
      // to make a build pass — the drop is the signal.
      //
      // A third of this package is dark to vitest: the queries run inside the
      // apps, where the e2e personas exercise them and no coverage is
      // collected. The floor protects the pure helpers and the migration
      // logic, which is where a silent regression would not fail a browser
      // test loudly.
      thresholds: {
        lines: 26,
        statements: 25,
        functions: 4,
        branches: 22,
      },
    },
  },
});
