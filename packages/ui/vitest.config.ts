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
      // A ratchet, not a target. Raise these as coverage improves; never lower
      // one to make a build pass — the drop is the signal.
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
