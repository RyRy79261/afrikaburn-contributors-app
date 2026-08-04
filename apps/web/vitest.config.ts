import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // `json-summary` is what CI's PR comment reads; `text` is what you see
      // locally. Same reporter set as packages/core, so the two read alike.
      reporter: ["text", "json-summary", "json"],
      reportOnFailure: true,

      // ── WHY THE SCOPE IS `lib/`, AND NOT THE WHOLE APP ───────────────────
      //
      // `app/**` (route components, layouts, server pages) and `components/**`
      // (67 files, ~11.9k lines of TSX, 47 of them client components) are
      // exercised by the Playwright PERSONA SUITE — 165 tests across 8
      // personas, in a real browser — which contributes nothing to vitest.
      // Including them here produces a figure around 3%: a number that
      // describes the test RUNNER rather than the code. This repo measured
      // that number and deliberately rejected it. Scoped to `lib/`, the
      // percentage answers a question worth asking — how much of the SERVER
      // logic (the authorisation predicates, the refusals, the redaction, the
      // state transitions) has a test.
      //
      // Every file under `lib/` is counted, not only the ones a test happens
      // to import, so the figure describes the workspace and not the run.
      include: ["lib/**/*.{ts,tsx}"],
      exclude: [
        // Test files themselves — the convention in packages/core's config.
        "lib/**/__tests__/**",
        // Executing this file proves nothing, because its entire body is
        // `export const authClient = createAuthClient({ plugins: [...] })` —
        // a configuration literal handed to a third-party factory. There is no
        // branch, no input and no output of ours to assert; a test could only
        // check that better-auth's own constructor returned an object. It is
        // also the one module in lib/ that is browser-only.
        "lib/auth-client.ts",
      ],

      // COVERAGE RATCHET. `pnpm test:coverage` exits non-zero when any metric
      // falls below these floors. Raise them as coverage improves; never lower
      // one to make a build pass — the drop is the signal, and lowering the
      // floor deletes it.
      //
      // The globals sit a few points under what was measured when they were
      // written (87.3 / 86.7 / 87.8 / 80.0), following the packages/core
      // convention, so ordinary work has room without the gate going quiet.
      // `questionnaire-store.ts` and `project-registration-store.ts` are the
      // two files still at zero and are what the headroom is mostly made of —
      // they are deliberately IN the include, so their gap counts against
      // these numbers rather than being hidden by narrowing the scope.
      thresholds: {
        lines: 84,
        statements: 84,
        functions: 85,
        branches: 77,

        // THE TWO FILES THAT DECIDE WHO SEES A MEDICAL NOTE AND WHAT GETS
        // ERASED — held at what they achieve today, per-file, the way
        // packages/core holds its privacy core.
        //
        // `medical-access.ts` assembles the context the safety-visible
        // predicate judges, and every bug its own comments describe lives in
        // that assembly rather than in the predicate. `account-sanitize.ts` is
        // the only place application rows are erased, on a live product
        // holding real phone numbers, emergency contacts and medical notes. A
        // new uncovered branch in either should fail the build and be looked
        // at, which is what a floor at the ceiling is for.
        "lib/medical-access.ts": {
          lines: 98,
          statements: 98,
          functions: 100,
          branches: 94,
        },
        "lib/account-sanitize.ts": {
          lines: 98,
          statements: 98,
          functions: 100,
          branches: 94,
        },
      },
    },
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
