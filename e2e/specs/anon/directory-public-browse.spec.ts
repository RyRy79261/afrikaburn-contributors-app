// specs/anon/directory-public-browse.spec.ts — the anon visitor CAN browse the
// directory of REGISTERED camps without a session. This spec proves the surface
// is publicly reachable (no auth redirect) and carries its public affordances.
//
// NOTE on scope: a *registered* camp only exists after the org approves a
// submission — a cross-persona chain owned by the org-review journey (M3-23) and
// gated on god credentials that are not self-service. So the "a registered camp
// is visible to a stranger" positive is proven, together with its negative twin
// (a free camp is NOT), in free-camp-undiscoverable.spec.ts via the member-vs-
// stranger discriminator, which needs no org approval. Here we assert the
// directory itself is anon-public and behaves as a directory, not a wall.
//
// Selectors verified in source (2026-07-26): apps/web/app/directory/page.tsx.

import { test, expect } from "../../fixtures";

test.describe("anonymous visitor — public directory", () => {
  test("the directory is reachable without a session", async ({ webPage }) => {
    await webPage.goto("/directory");
    // A gated route would bounce us to /auth/sign-in; the directory does not.
    await expect(webPage).toHaveURL(/\/directory/);
    await expect(webPage).not.toHaveURL(/\/auth\/sign-in/);

    await expect(
      webPage.getByRole("heading", { name: /^directory$/i }),
    ).toBeVisible();
  });

  test("the directory offers search and a create-a-camp entry point", async ({
    webPage,
  }) => {
    await webPage.goto("/directory");
    // The Input renders as a plain textbox (no type="search"); match by its label.
    await expect(webPage.getByLabel(/search the directory/i)).toBeVisible();
    await expect(
      webPage.getByRole("link", { name: /create a camp/i }),
    ).toBeVisible();
  });

  test("the app header shows the anon (signed-out) state, not member chrome", async ({
    webPage,
  }) => {
    await webPage.goto("/directory");
    // AppShell renders a "Sign in" header link for anon and Profile/Account only
    // when a session exists — a cheap proof that we are browsing signed-out.
    await expect(
      webPage.getByRole("link", { name: /^sign in$/i }).first(),
    ).toBeVisible();
    await expect(webPage.getByRole("link", { name: /^account$/i })).toHaveCount(
      0,
    );
  });

  test("a nonsense search term is handled without leaking anything or erroring", async ({
    webPage,
  }) => {
    // A term that can match nothing must yield the honest empty state, never a
    // 500 and never a stray card. (normalizeName strips punctuation, so the
    // random token is the only signal.)
    const nonsense = `zzq-${Date.now().toString(36)}-nomatch`;
    await webPage.goto(`/directory?q=${encodeURIComponent(nonsense)}`);
    await expect(webPage).toHaveURL(/\/directory/);
    await expect(
      webPage.getByText(/no camps match your filters|no registered camps yet/i),
    ).toBeVisible();
  });
});
