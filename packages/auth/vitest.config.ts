import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      reportOnFailure: true,
      // Count every source file, not only the ones a test imports. NOTHING in
      // this workspace is excluded from the denominator: src/index.ts is a pure
      // barrel re-export and would be the textbook legitimate exclusion, but v8
      // reports it as 0/0/0/0, so excluding it would change no number and would
      // only read as scope-narrowing.
      include: ["src/**/*.ts"],
      exclude: ["**/__tests__/**", "**/*.d.ts"],
      // A ratchet, not a target. Raise these as coverage improves; never lower
      // one to make a build pass — the drop is the signal.
      //
      // Measured 4 Aug 2026 after the account/email/hook suites landed:
      // statements 99.19, branches 99.13, functions 100, lines 100. Set a few
      // points under that so ordinary work does not breach them on the first
      // new branch, and so a real regression still shows up as a drop.
      //
      // The one uncovered statement is account.ts's `!name` guard in
      // parseSetCookies, which a real Headers object cannot reach: a
      // whitespace-only cookie name is trimmed to `=value` before the parser
      // sees it, so the earlier `eq <= 0` guard takes it first. Its sibling
      // `!first` IS reachable (a header starting with `;`) and is covered.
      thresholds: {
        lines: 97,
        statements: 96,
        functions: 97,
        branches: 96,
      },
    },
  },
});
