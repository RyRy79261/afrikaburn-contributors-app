import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],

    // 5 SECONDS IS NOT A HANG DETECTOR FOR A JSDOM SUITE ON A 2-CORE RUNNER.
    //
    // Measured on run 30939995495 (4 Aug 2026): phone-input's typing case timed
    // out at the 5,000 ms default in the `ci` job — while the SAME suite passed
    // in its own `coverage · @quagga/ui` shard in the same push. That asymmetry
    // is the whole diagnosis: the coverage matrix gives each workspace a runner
    // to itself, and `ci` runs `turbo run test` across all eight at once. Under
    // that contention a case that renders a React tree ten times (one
    // fireEvent.change per typed character, through react-phone-number-input)
    // legitimately crosses five seconds.
    //
    // For scale: this suite spends 28 s in tests and 43 s in environment setup
    // locally, and 81 s / 102 s on the runner. A limit inside that noise fails
    // at random, and a gate that fails at random is a gate people learn to
    // re-run rather than read.
    testTimeout: 30_000,
    hookTimeout: 30_000,
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
      // NOTHING IS EXCLUDED beyond tests and type declarations, deliberately.
      // Narrowing `include` to the files a test happens to reach would shrink
      // the denominator rather than measure anything, and this package contains
      // no file in the legitimate "executing it proves nothing" category — no
      // barrel (package.json exports point at source files directly), no
      // generated code, no bare schema literal. The one config-literal file,
      // components/markdown-editor/extensions.ts, is already at 100% because
      // markdown.ts imports it, so removing it would only cost denominator.
      //
      // Measured 2026-08-04, whole package: statements 91.92 (967/1052),
      // branches 87.59 (819/935), functions 86.33 (278/322), lines 92.65
      // (908/980). Floors sit ~3 points under that so ordinary work has room.
      //
      // Still dark on purpose, and cheap to see in the report: accordion.tsx and
      // tabs.tsx are Radix re-exports whose forwardRefs only merge a className
      // (v8 records zero branches in either), and client-error-capture.tsx is a
      // one-line effect wrapper around lib/client-errors.ts, which is at 96%.
      thresholds: {
        lines: 89,
        statements: 88,
        functions: 83,
        branches: 84,
      },
    },
    setupFiles: ["./vitest.setup.ts"],
  },
});
