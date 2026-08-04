// specs/supplier/standing.spec.ts — the supplier sees its OWN standing in plain
// language, and nothing more (docs/supplier-spec.md §Surfaces; M3-28).
//
// A fresh supplier starts in "Good standing" — no god needed. The org-driven
// transitions (watch / suspended) need a pre-provisioned god account, so those
// two cases skipUnlessGod and use the org counterpart helper to change standing.
// Either way, the assertion is the PLAIN-LANGUAGE verdict the supplier reads —
// and, as a permanent fixture of this page, the "private notes stay private"
// promise (the notes trail itself is proven absent in isolation.spec.ts).

import { test, expect, skipUnlessGod } from "../../fixtures";
import {
  registerSupplier,
  signInAs,
  signOut,
  elevateToGod,
} from "../../personas/factories";
import { orgSetStanding } from "./support";

test.describe("supplier standing visibility", () => {
  test("a fresh supplier sees Good standing, explained in plain language", async ({
    suppliersPage,
  }) => {
    await registerSupplier(suppliersPage, { category: "Transport" });
    await suppliersPage.goto("/standing");

    await expect(
      suppliersPage.getByRole("heading", { name: /standing with afrikaburn/i }),
    ).toBeVisible();
    await expect(
      suppliersPage.getByText(/good standing/i).first(),
    ).toBeVisible();
    await expect(
      suppliersPage.getByText(/you['’]re in good standing with afrikaburn/i),
    ).toBeVisible();
    // The legend marks the supplier's current band.
    await expect(suppliersPage.getByText(/you['’]re here/i)).toBeVisible();

    // The privacy promise is always on this page (the #56 law made visible).
    await expect(
      suppliersPage.getByText(/private notes stay private/i),
    ).toBeVisible();
    await expect(
      suppliersPage.getByText(/those notes are for the supplier team only/i),
    ).toBeVisible();
  });

  test("org moves the supplier to Watch, then Suspended, and the supplier reads each verdict", async ({
    suppliersPage,
    orgPage,
  }) => {
    skipUnlessGod();

    const account = await registerSupplier(suppliersPage, {
      category: "Transport",
    });
    await elevateToGod(orgPage);

    // Watch.
    await orgSetStanding(orgPage, account.name, "Watch");
    await suppliersPage.goto("/standing");
    await expect(suppliersPage.getByText(/^watch$/i).first()).toBeVisible();
    await expect(
      suppliersPage.getByText(/flagged your account for attention/i),
    ).toBeVisible();

    // Suspended.
    await orgSetStanding(orgPage, account.name, "Suspended");
    await suppliersPage.goto("/standing");
    // "Your account is suspended." is unique to the supplier's own verdict copy
    // (the legend's suspended band opens with different wording), so this is an
    // unambiguous proof the suspended standing reached the supplier.
    await expect(
      suppliersPage.getByText(/your account is suspended/i),
    ).toBeVisible();

    // The verdict survives a fresh session — it is a real stored value, not
    // client state.
    await signOut(suppliersPage);
    await signInAs(suppliersPage, account, "suppliers");
    await suppliersPage.goto("/standing");
    await expect(
      suppliersPage.getByText(/your account is suspended/i),
    ).toBeVisible();
  });
});
