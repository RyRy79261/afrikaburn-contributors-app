import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      reportOnFailure: true,
      // Count every source file, not only the ones a test imports.
      include: ["lib/**/*.ts"],
      exclude: ["**/__tests__/**", "**/*.d.ts"],
      // APPS ARE UNIT-TESTED IN `lib/` ONLY, and the number says so.
      //
      // Routes, pages and components in this app are covered by the Playwright
      // persona suite (`pnpm e2e:local`), not by vitest. Counting `app/**` here
      // would report a percentage that means "we do not unit-test pages",
      // which is already known and true by design. What this floor protects is
      // the server actions, queries and stores under `lib/` — the code where a
      // silent regression would not fail a browser test loudly.
      thresholds: {
        lines: 12,
        statements: 12,
        functions: 16,
        branches: 15,
      },
    },
  },
});
