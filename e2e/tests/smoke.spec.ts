// tests/smoke.spec.ts — the M3-16 barrier verifier: every app shell boots and
// renders its own branded auth UI against the deployment under test. Runs on
// both the desktop and 360px-mobile projects. Tagged @smoke so the PR gate can
// select the fast subset (`pnpm --filter @quagga/e2e e2e:smoke`).

import { test, expect } from "../fixtures";

test.describe("app shells load @smoke", () => {
  test("web sign-in renders", async ({ webPage }) => {
    await webPage.goto("/auth/sign-in");
    await expect(webPage.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(
      webPage.getByRole("button", { name: /^sign in$/i }),
    ).toBeVisible();
  });

  test("org sign-in renders", async ({ orgPage }) => {
    await orgPage.goto("/auth/sign-in");
    await expect(orgPage.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(
      orgPage.getByRole("button", { name: /^sign in$/i }),
    ).toBeVisible();
  });

  test("suppliers sign-up renders", async ({ suppliersPage }) => {
    await suppliersPage.goto("/signup");
    await expect(suppliersPage.getByLabel(/business name/i)).toBeVisible();
    await expect(
      suppliersPage.getByRole("button", { name: /create account/i }),
    ).toBeVisible();
  });
});
