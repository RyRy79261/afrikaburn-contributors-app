import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Without this, the node environment has no JSX-aware transform and v8 drops
  // `lib/gate.tsx` from coverage entirely rather than reporting it at 0 —
  // silently, and the file simply vanishes from the per-file table. Automatic
  // runtime is the key that works. `apps/org` carries the same line for the
  // same file; if gate.tsx disappears from the table again, this is what broke.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["lib/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      reportOnFailure: true,

      // SCOPED TO `lib/`, DELIBERATELY — not app/ and not components/.
      //
      // The route components under app/ and the React components under
      // components/ are exercised by the Playwright persona suite (165 tests,
      // 8 personas), which runs in a real browser and contributes nothing to a
      // vitest run. Counting them here produces a figure around 3% that
      // describes the test RUNNER rather than the code — a number this repo
      // measured and deliberately rejected, because a metric nobody believes
      // is a metric nobody acts on.
      //
      // Scoped to lib/, the percentage answers a question worth asking: how
      // much of the portal's SERVER logic — session resolution, the supplier
      // link/claim rules, onboarding transitions, document authz, the server
      // actions' refusals — has a test. A new server-side branch with no test
      // drops this number, which is the signal the floor exists to protect.
      include: ["lib/**/*.{ts,tsx}"],
      exclude: ["lib/**/__tests__/**"],

      // A ratchet, not a target. Raise it as coverage improves; never lower it
      // to make a build pass — the drop is the signal, and lowering the floor
      // deletes the signal.
      //
      // MEASURED, 4 Aug 2026, with the lib/ suite in place:
      //   98.00 lines / 97.78 statements / 98.86 functions / 94.35 branches.
      // Set two to three points under each, so an ordinary refactor does not
      // redden the gate while a genuinely untested new branch still does.
      //
      // The one real hole is `withTransaction` in `lib/db.ts` (20% statements):
      // it opens a pooled WebSocket to Postgres and calls `pool.end()`, and it
      // is left genuinely uncovered rather than mocked into a green number.
      // `apps/org` mocks `createPooledDb` and so reports its equivalent at
      // 100% — that 100% means the plumbing ran against a fake, not that a
      // partial failure rolls back. This 20% is the more honest of the two.
      // The SQL semantics these unit tests can only assert as intent
      // (ON CONFLICT, FOR UPDATE, ILIKE, the `suppliers.code` unique
      // constraint) belong to `pnpm e2e:local`, against a real Postgres.
      //
      // `lib/auth-client.ts` reports 100% and should not be read as tested: it
      // is one module-level `createAuthClient` call, so the 100% means a test
      // imported it. It is counted rather than excluded so the file stays
      // visible in the table.
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 96,
        branches: 92,
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
