// e2e/playwright.config.ts — points at a DEPLOYED app (preview / localhost /
// prod), never spins one up. Env-driven base URLs (lib/env.ts); desktop + 360px
// mobile projects; traces/video/screenshot on failure; retries only in CI.

import { defineConfig, devices } from "@playwright/test";
import {
  APP_URLS,
  IS_CI,
  TIMEOUTS,
  assertNotProductionUnlessAllowed,
  protectionBypassHeaders,
} from "./lib/env";

// Fail fast if someone points the destructive suite at production by accident.
assertNotProductionUnlessAllowed();

export default defineConfig({
  // The harness's own demonstration specs live in `tests/`; the per-persona
  // journey suites (M3-18..M3-30) live under `specs/<persona>/`. Rooting the
  // testDir at the package lets Playwright discover both without each persona
  // owner editing this shared file. Playwright ignores `node_modules` by default,
  // and `testMatch` still limits collection to `*.spec.ts` / `*.test.ts`, so
  // helper modules (e.g. `specs/**/support.ts`) are never run as tests.
  testDir: ".",
  testIgnore: ["**/node_modules/**", "**/test-results/**", "**/playwright-report/**"],
  // Each spec creates its own accounts/data, so specs are fully parallel-safe.
  fullyParallel: true,
  // A stray `test.only` must fail CI, never silently narrow the run.
  forbidOnly: IS_CI,
  // Retries ONLY in CI (flaky third-party mail/preview cold starts), never local.
  retries: IS_CI ? 2 : 0,
  // Bounded workers in CI to protect the Neon branch's compute; unbounded locally.
  workers: IS_CI ? 4 : undefined,
  timeout: TIMEOUTS.test,
  expect: { timeout: TIMEOUTS.expect },
  reporter: IS_CI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    // Default base URL is the WEB app; org/suppliers pages override via fixtures.
    baseURL: APP_URLS.web,
    actionTimeout: TIMEOUTS.action,
    navigationTimeout: TIMEOUTS.action,
    // Diagnostics are kept only when a test fails or is retried — cheap green runs.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Vercel Deployment Protection bypass, when the preview needs it.
    extraHTTPHeaders: protectionBypassHeaders(),
  },

  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      // 360px is the design's mobile baseline (AGENTS.md mobile-360 pairing).
      name: "mobile-360",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 360, height: 780 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
