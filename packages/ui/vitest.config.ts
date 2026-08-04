import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      reportOnFailure: true,
      // Count every source file, not only the ones a test imports.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/__tests__/**", "**/*.d.ts"],
      // A ratchet, not a target. Raise it as coverage improves; never lower it
      // to make a build pass — the drop is the signal.
      //
      // About half this package is dark to vitest: components are also rendered
      // by the browser in the e2e personas, which contribute nothing here. What
      // the floor is good for is the direction of travel — a new component
      // without a DOM test drops the number, which is the correct signal.
      thresholds: {
        lines: 36,
        statements: 35,
        functions: 33,
        branches: 32,
      },
    },
    setupFiles: ["./vitest.setup.ts"],
  },
});
