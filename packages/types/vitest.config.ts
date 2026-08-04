import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      reportOnFailure: true,
      // Count every source file, not only the ones a test imports. Nothing is
      // excluded beyond the tests themselves: src/index.ts is a pure barrel
      // re-export, but v8 reports it as 0/0 on all four metrics, so leaving it
      // in neither helps nor hurts and keeps this glob honest.
      include: ["src/**/*.ts"],
      exclude: ["**/__tests__/**", "**/*.d.ts"],
      // A ratchet, not a target. Raise these as coverage improves; never lower
      // one to make a build pass — the drop is the signal.
      // Measured at 100/100/100/100 (Aug 2026); floors sit ~3 points under so
      // ordinary refactoring has room without the gate going soft.
      thresholds: {
        lines: 97,
        statements: 97,
        functions: 97,
        branches: 97,
      },
    },
  },
});
