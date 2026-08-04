import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // `json-summary` is what CI's PR comment reads; `text` is what you see
      // locally.
      reporter: ["text", "json-summary", "json"],
      reportOnFailure: true,
      // Count every source file, not only the ones a test happens to import,
      // so the percentage describes the package rather than the test run.
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/__fixtures__/**", "src/index.ts"],

      // COVERAGE RATCHET. `pnpm test:coverage` exits non-zero when any metric
      // falls below these floors. Raise them as coverage improves; never lower
      // one to make a build pass — the drop is the signal, and lowering the
      // floor deletes it.
      //
      // The global floors sit a little under today's numbers so ordinary work
      // has room. The per-file floors do not: they cover the predicates that
      // decide who may see whose personal information, and each sits at what
      // that file achieves right now.
      thresholds: {
        lines: 90,
        statements: 89,
        functions: 92,
        branches: 82,

        // THE PRIVACY AND SAFETY CORE — 100%, deliberately.
        //
        // These decide whether somebody's medical note, phone number or ID
        // number reaches a screen it should not, and whether a stranger's
        // words reach a public issue unredacted. They are pure functions with
        // no I/O, so full coverage is achievable and staying there is cheap. A
        // new uncovered branch here should fail the build and be looked at,
        // which is what a floor at the ceiling is for.
        "src/report-sanitize.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "src/report-screen.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "src/medical-access.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "src/privacy.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "src/id-retention.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "src/entitlements.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },

        // THE AUTHZ PREDICATES — high, with a few points of headroom. These
        // carry more branches than the files above, and gain more as the role
        // model grows.
        "src/org-permissions.ts": {
          lines: 96,
          statements: 92,
          functions: 95,
          branches: 86,
        },
        "src/project-permissions.ts": {
          lines: 95,
          statements: 96,
          functions: 100,
          branches: 95,
        },
        "src/questionnaire-authz.ts": {
          lines: 98,
          statements: 94,
          functions: 100,
          branches: 88,
        },
        "src/account-security.ts": {
          lines: 95,
          statements: 94,
          functions: 100,
          branches: 92,
        },
        "src/org-roles.ts": {
          lines: 89,
          statements: 90,
          functions: 88,
          branches: 94,
        },
        "src/officers.ts": {
          lines: 90,
          statements: 90,
          functions: 100,
          branches: 79,
        },
        // The registration state machine: what a status may become, and who
        // may move it there.
        "src/registration-state.ts": {
          lines: 90,
          statements: 90,
          functions: 85,
          branches: 88,
        },
      },
    },
  },
});
