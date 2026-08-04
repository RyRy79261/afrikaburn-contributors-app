import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // `lib/gate.tsx` is a server component, and the app's tsconfig sets
  // `jsx: "preserve"` because Next.js compiles it. Vite honours that, so an
  // import of gate.tsx dies with "Failed to parse source for import analysis"
  // unless a JSX runtime is named here. Worse, when the file is only listed in
  // coverage.include and never imported, v8 prints "Failed to parse … Excluding
  // it from coverage" as a WARNING, the run stays green, and the file quietly
  // leaves the denominator — a config that claims to measure `.tsx` while
  // measuring only `.ts`. Vite 8 ignores the old `esbuild.jsx` option; this is
  // the key that works. If gate.tsx ever vanishes from the per-file table,
  // this is what broke.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["lib/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // `json-summary` is what CI's PR comment reads; `text` is what you see
      // locally. Same reporter set as packages/core and apps/web, so the
      // workspaces read alike.
      reporter: ["text", "json-summary", "json"],
      reportOnFailure: true,

      // ── WHY THE SCOPE IS `lib/`, AND NOT THE WHOLE APP ───────────────────
      //
      // `app/**` (every route, layout and page) and `components/**` (client
      // components with hooks, Radix portals and event handlers) are rendered
      // by the Playwright PERSONA SUITE — 165 tests across 8 personas, in a
      // real browser — which contributes nothing to vitest. Including them here
      // produces a figure around 3%: a number that describes the test RUNNER
      // rather than the code. This repo measured that number and deliberately
      // rejected it. Scoped to `lib/`, the percentage answers a question worth
      // asking — how much of the SERVER logic (the authorisation predicates,
      // the refusals, the redaction, the state transitions) has a test. This
      // app carries the repo's largest authorisation surface — org ranks, the
      // god anchor, medical-note audit, per-domain personal-information gating
      // — and all of it lives under `lib/`.
      //
      // Every file under `lib/` is counted, not only the ones a test happens to
      // import, so the figure describes the workspace and not the run. Nothing
      // is excluded for being hard to test.
      //
      // READ THE 100%s WITH CARE, though — three of them are weaker than they
      // look, and v8 cannot tell you so:
      //   - `lib/auth-client.ts` reports 100% off two module-level statements
      //     that run on import. It means the file was imported, not tested.
      //   - `withTransaction` in `lib/db.ts` reports 100% because its body runs
      //     against a mocked `createPooledDb`. That proves the pool is opened
      //     and always closed; it does NOT prove a partial failure rolls back,
      //     which is the property the function exists for and which needs a
      //     real Postgres.
      //   - `auth.ts`'s session read is the same shape: the wiring is exercised,
      //     the live better-auth round trip is not.
      // Those three belong to `pnpm e2e:local`. They are left in the
      // denominator rather than excluded, because a reader deserves to see the
      // file listed.
      include: ["lib/**/*.{ts,tsx}"],
      exclude: [
        // Executing a test file proves nothing about the app, and it is by
        // definition 100% executed — counting it only inflates the number.
        "lib/**/__tests__/**",
        // Type-only declarations; they emit no runtime code at all.
        "**/*.d.ts",
      ],

      // COVERAGE RATCHET. `pnpm test:coverage` exits non-zero when any metric
      // falls below these floors. Raise them as coverage improves; never lower
      // one to make a build pass — the drop is the signal, and lowering the
      // floor deletes it.
      //
      // Set from a MEASURED run (97.78 lines / 96.98 statements / 96.76
      // functions / 87.39 branches), a couple of points under, so an ordinary
      // refactor does not redden the gate but a new uncovered module does.
      // Branches sits lowest and is the binding metric: the uncovered remainder
      // is mostly `?? fallback` arms on rows a real database would never return
      // both ways. The paths that need a live Postgres or a live better-auth
      // session are a separate problem — they report as covered because their
      // fakes run, and the note above `include` says which ones and why.
      thresholds: {
        lines: 95,
        statements: 94,
        functions: 94,
        branches: 84,
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
