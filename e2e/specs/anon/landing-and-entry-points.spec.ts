// specs/anon/landing-and-entry-points.spec.ts — the ANONYMOUS VISITOR happy path.
//
// Persona: no session. What a stranger legitimately reaches BEFORE signing in —
// the marketing landing, the two auth entry points, and the wiring between them.
// These are the only fully-public web surfaces; everything else is proven refused
// in the sibling specs. Runs on BOTH projects, so the primary journey is covered
// at the 360px mobile baseline as well as desktop (task: mobile for the primary
// journey; playwright.config drives every spec through mobile-360 too).
//
// Selectors verified in source (2026-07-26):
//   landing ....... apps/web/app/page.tsx
//   auth form ..... apps/web/components/auth/auth-form.tsx
//   auth page ..... apps/web/app/auth/[...path]/page.tsx

import { test, expect } from "../../fixtures";

test.describe("anonymous visitor — landing & auth entry points", () => {
  test("the landing page renders its public marketing shell @smoke", async ({
    webPage,
  }) => {
    await webPage.goto("/");
    // An anon visitor is NOT redirected off the marketing page (signed-in users
    // are — page.tsx redirect). Staying on "/" proves we hold no session.
    await expect(webPage).toHaveURL(/\/$/);

    // Hero + the product's honest money-law footer copy (a load-bearing law).
    await expect(
      webPage.getByRole("heading", { name: /your camp, one place/i }),
    ).toBeVisible();
    await expect(
      webPage.getByText(/the platform never holds funds/i),
    ).toBeVisible();

    // The two hero CTAs an anon can follow, and both auth entry points in the nav.
    await expect(
      webPage.getByRole("link", { name: /create your camp/i }),
    ).toBeVisible();
    await expect(
      webPage.getByRole("link", { name: /browse the directory/i }),
    ).toBeVisible();
    await expect(
      webPage.getByRole("link", { name: /^sign in$/i }).first(),
    ).toBeVisible();
    await expect(
      webPage.getByRole("link", { name: /^sign up$/i }).first(),
    ).toBeVisible();
  });

  test("sign-in is reachable and shows the branded email/password form", async ({
    webPage,
  }) => {
    await webPage.goto("/");
    await webPage.getByRole("link", { name: /^sign in$/i }).first().click();
    await expect(webPage).toHaveURL(/\/auth\/sign-in/);

    await expect(
      webPage.getByRole("heading", { name: /welcome, burner/i }),
    ).toBeVisible();
    await expect(webPage.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(webPage.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(
      webPage.getByRole("button", { name: /^sign in$/i }),
    ).toBeVisible();
    // The forgot-password affordance exists on sign-in (not on sign-up).
    await expect(
      webPage.getByRole("link", { name: /forgot your password/i }),
    ).toBeVisible();
  });

  test("sign-up is reachable and shows the create-account form", async ({
    webPage,
  }) => {
    await webPage.goto("/auth/sign-up");
    await expect(webPage).toHaveURL(/\/auth\/sign-up/);
    await expect(webPage.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(webPage.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(
      webPage.getByRole("button", { name: /create account/i }),
    ).toBeVisible();
  });

  test("the auth form links sign-in and sign-up to each other", async ({
    webPage,
  }) => {
    await webPage.goto("/auth/sign-in");
    await webPage.getByRole("link", { name: /create an account/i }).click();
    await expect(webPage).toHaveURL(/\/auth\/sign-up/);

    await webPage.getByRole("link", { name: /^sign in$/i }).first().click();
    await expect(webPage).toHaveURL(/\/auth\/sign-in/);
  });

  test("the forgot-password entry point is reachable from sign-in", async ({
    webPage,
  }) => {
    await webPage.goto("/auth/sign-in");
    await webPage.getByRole("link", { name: /forgot your password/i }).click();
    await expect(webPage).toHaveURL(/\/auth\/forgot-password/);
  });

  // The "Continue with Google" button is PRESENT and WIRED, but a full Google
  // OAuth round trip is deliberately OUT of automated scope: real Google sign-in
  // cannot be driven headlessly (bot detection / consent / 2FA) and mocking the
  // callback would be a product-code side-door the harness refuses to ship
  // (e2e/README.md "Google & god access"). We assert the button exists — the
  // wiring — and go no further, rather than imply coverage we do not have.
  test("the Google sign-in button is present (round trip intentionally untested)", async ({
    webPage,
  }) => {
    await webPage.goto("/auth/sign-in");
    await expect(
      webPage.getByRole("button", { name: /continue with google/i }),
    ).toBeVisible();
  });
});
