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
      exclude: [
        "**/__tests__/**",
        "**/*.d.ts",
        // schema.ts is DECLARATION, not logic, and executing it proves nothing:
        // v8 measures ZERO branches across all ~2000 lines — the tool itself
        // reporting there is nothing here to choose between — and its 109
        // "functions" are drizzle column and index builder callbacks whose only
        // failure mode is a type error `tsc --noEmit` already catches. The file
        // runs on ANY import of the package whether or not a test asserts
        // anything, so counting it measures imports, not tests.
        //
        // MEASURED, and it cuts AGAINST us: schema-invariants.test.ts sweeps
        // getTableConfig() over all 44 exported tables, which invokes the
        // column and index callbacks, so counting this file would move the
        // package to 84.72 lines / 78.16 branches / 88.51 functions / 84.90
        // statements — eight points better than what we report. We exclude it
        // anyway. Those points are earned by importing a file, not by testing
        // behaviour, and a number that flatters us for an import is the kind
        // this repo has already thrown away once.
        //
        // The half of it worth asserting is asserted — see
        // src/__tests__/schema-invariants.test.ts, which pins the encrypted
        // columns, the two partial unique indexes from migration 0028 and the
        // foreign-key sweep. That test deliberately moves no number.
        "src/schema.ts",
      ],
      // A ratchet, not a target. Raise it as coverage improves; never lower it
      // to make a build pass — the drop is the signal.
      //
      // Set from a MEASURED run (lines 76.44, statements 76.76, functions
      // 66.66, branches 78.16), less about three points so ordinary work does
      // not breach them on the next commit.
      //
      // NOTE ON `functions`: the denominator here is only 39, so ONE untested
      // function moves the metric by about 2.5 points. That sensitivity is the
      // point — but it also means this floor is the one to think about before
      // adding a function, not to nudge afterwards.
      //
      // What remains dark is honest: seed.ts's upsert sequences, whose
      // correctness IS the round trip (that the ON CONFLICT target matches a
      // real unique constraint, that the slug-collision loop terminates against
      // real rows). A fake driver returns whatever the test tells it to, so a
      // unit test of those would assert its own fixture. They belong to
      // `pnpm e2e:local`, against a real Postgres.
      thresholds: {
        lines: 73,
        statements: 74,
        functions: 63,
        branches: 75,
      },
    },
  },
});
