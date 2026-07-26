// specs/anon/gated-web-surfaces-refused.spec.ts — every authed participant-app
// surface refuses an anonymous visitor at the SERVER (a redirect emitted before
// any data is fetched), not merely by hiding a nav link. Each protected page
// starts with `getAuthenticatedUser()` → `redirect("/auth/sign-in")`, so an anon
// GET lands on the auth wall with none of the page's content.
//
// The camp-scoped routes are exercised against a REAL camp slug (created by a
// lead via the factories) so the refusal is proven on a route that genuinely
// exists — not on a 404 that would refuse for the wrong reason.
//
// Guards verified in source (2026-07-26): apps/web/app/{camps/new,profile,
// account,onboarding,notifications}/page.tsx and camps/[slug]/{registration,
// questionnaires}/page.tsx.

import { type Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import { signUpBurner, createCamp } from "../../personas/factories";

/** Assert an anon GET of `path` was refused server-side onto the sign-in wall. */
async function expectBouncedToSignIn(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page, `anon GET ${path} must redirect to sign-in`).toHaveURL(
    /\/auth\/sign-in/,
  );
  // Positive proof we landed on the auth wall (not a blank/again-redirecting page).
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
}

// Routes that need no data — an anon simply cannot reach them.
const SESSION_ONLY_ROUTES = [
  "/camps/new",
  "/profile",
  "/account",
  "/onboarding",
  "/notifications",
] as const;

test.describe("anonymous visitor — gated participant surfaces refuse", () => {
  for (const path of SESSION_ONLY_ROUTES) {
    test(`GET ${path} redirects an anon to sign-in`, async ({ webPage }) => {
      await expectBouncedToSignIn(webPage, path);
      // The page's own content never rendered (we are on the auth form).
      await expect(
        webPage.getByRole("button", { name: /^sign in$/i }),
      ).toBeVisible();
    });
  }

  test("camp registration + questionnaires refuse an anon on a REAL camp slug", async ({
    webPage,
    makeAppPage,
  }) => {
    // A lead creates a genuine camp so the slug resolves — the refusal is the
    // auth gate, not a missing-camp 404.
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage);

    const anon = await makeAppPage("web");
    await expectBouncedToSignIn(anon, `/camps/${camp.slug}/registration`);
    await expectBouncedToSignIn(anon, `/camps/${camp.slug}/questionnaires`);
  });
});
