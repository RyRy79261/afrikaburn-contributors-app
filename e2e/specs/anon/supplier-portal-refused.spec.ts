// specs/anon/supplier-portal-refused.spec.ts — the supplier portal refuses an
// anonymous visitor at the SERVER. The (portal) layout resolves the supplier
// session and, when it is not "ok", renders the full-screen GateScreen instead
// of the portal — so onboarding steps and standing never render for an anon.
// (The anon CAN reach /signin and /signup — the portal's public entry points —
// but not the portal itself.)
//
// Guards verified in source (2026-07-26): apps/suppliers/app/(portal)/layout.tsx
// + lib/gate.tsx (guardPortal) + components/gate-screen.tsx.

import { test, expect } from "../../fixtures";

test.describe("anonymous visitor — supplier portal refuses", () => {
  test("onboarding is replaced by the supplier gate", async ({
    suppliersPage,
  }) => {
    await suppliersPage.goto("/onboarding");

    // Unauthenticated gate: the portal name + both auth CTAs.
    await expect(
      suppliersPage.getByRole("heading", { name: /^supplier portal$/i }),
    ).toBeVisible();
    await expect(
      suppliersPage.getByRole("link", { name: /^sign in$/i }),
    ).toBeVisible();
    await expect(
      suppliersPage.getByRole("link", { name: /create an account/i }),
    ).toBeVisible();

    // The onboarding checklist itself never rendered.
    await expect(
      suppliersPage.getByRole("heading", {
        name: /your onboarding checklist/i,
      }),
    ).toHaveCount(0);
  });

  test("standing is refused to an anon", async ({ suppliersPage }) => {
    await suppliersPage.goto("/standing");
    await expect(
      suppliersPage.getByRole("link", { name: /^sign in$/i }),
    ).toBeVisible();
    await expect(
      suppliersPage.getByRole("heading", { name: /standing with afrikaburn/i }),
    ).toHaveCount(0);
  });

  test("the portal's public entry points ARE reachable", async ({
    suppliersPage,
  }) => {
    // The refusal is scoped to the portal, not the whole app: an anon can still
    // reach the sign-in and sign-up screens to become a supplier.
    await suppliersPage.goto("/signin");
    await expect(suppliersPage.getByLabel(/^Email/)).toBeVisible();

    await suppliersPage.goto("/signup");
    await expect(suppliersPage.getByLabel(/business name/i)).toBeVisible();
  });
});
