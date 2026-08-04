// specs/supplier/claim-by-email.spec.ts — the email-overlap claim (M3-28,
// docs/supplier-spec.md; apps/suppliers/lib/session.ts resolveSupplierForUser).
//
// THE RULE: when a supplier signs in with a VERIFIED email that matches an
// accountless catalog row's free-text contact, the portal ATTACHES that user to
// the existing row (no duplicate). A fresh, non-overlapping email instead makes a
// brand-new row. The claim only fires for a *verified* email — an unverified
// address can never hijack an imported supplier — so this journey is inherently
// mail-dependent AND, because the accountless target row must be created by the
// org (the seed's real business contacts must never be hard-coded into a test —
// AGENTS.md), god-dependent. Hence: skipUnlessMail() + skipUnlessGod().
//
// The shared `registerSupplier` factory only provisions a readable mailbox when
// NO explicit email is passed, so the verified-claim path is hand-driven here
// (sign up with our mailbox, click the real verification link). This is the
// honest way to exercise a flow the factory does not cover; it drives the same
// real UI, no DB back door.
//
// NOTE (see report): this is the least-verifiable spec in the suite — it exercises
// the mail-ON branch, which is off by default, so it is written correct-by-
// construction from source and has never executed.

import type { Page } from "@playwright/test";
import { test, expect, skipUnlessMail, skipUnlessGod } from "../../fixtures";
import { elevateToGod } from "../../personas/factories";
import { requireMailbox } from "../../lib/mail";
import { TEST_PASSWORD, uniqueSupplierName } from "../../lib/identity";
import { orgAddSupplier, orgSetStanding } from "./support";

/**
 * Drive the portal /signup form with a specific (mailbox) address and click the
 * real verification link, leaving the page signed in. Verification is ON in this
 * spec, so sign-up holds the session pending the link, and the supplier PROFILE
 * is created later — by the claim on first authenticated portal load (overlap),
 * or by the register form (fresh). We therefore do NOT assert an onboarding
 * landing here.
 */
async function signUpSupplierAndVerify(
  page: Page,
  email: string,
  typedBusinessName: string,
): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel(/business name/i).fill(typedBusinessName);
  await page.getByLabel(/contact person/i).fill("Sam Supplier");
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(TEST_PASSWORD);
  await page.getByLabel(/service category/i).click();
  await page.getByRole("option", { name: "Transport" }).click();
  await page
    .getByRole("checkbox", { name: /read the supplier basics/i })
    .check();
  await page.getByRole("button", { name: /create account/i }).click();
}

test.describe("supplier claim-by-email", () => {
  test("a verified email overlapping a catalog row ATTACHES to it (no duplicate)", async ({
    suppliersPage,
    orgPage,
  }) => {
    skipUnlessMail();
    skipUnlessGod();

    const mailbox = await requireMailbox("claim");

    // The org creates the accountless target row: a distinctive business name and
    // a contact line carrying the mailbox address. Watch standing is a second,
    // independent signal that the portal attached to THIS row (a fresh row would
    // default to Good).
    const claimedName = uniqueSupplierName();
    await elevateToGod(orgPage);
    await orgAddSupplier(orgPage, {
      name: claimedName,
      contact: `Booking Desk ${mailbox.address}`,
    });
    await orgSetStanding(orgPage, claimedName, "Watch");

    // The supplier signs up with the overlapping mailbox — under a DIFFERENT
    // typed business name, so seeing the claimed name later proves an attach, not
    // a new row echoing what we typed.
    const typedName = uniqueSupplierName();
    await signUpSupplierAndVerify(suppliersPage, mailbox.address, typedName);
    const link = await mailbox.waitForLink(/verify|verification|token/i);
    await suppliersPage.goto(link);

    // First authenticated portal load claims the accountless row by overlap.
    await suppliersPage.goto("/onboarding");
    await expect(
      suppliersPage.getByRole("heading", {
        name: /your onboarding checklist/i,
      }),
    ).toBeVisible();
    // Attached to the org's row: its NAME shows, the typed one does not identify us.
    await expect(suppliersPage.getByText(claimedName).first()).toBeVisible();
    await expect(suppliersPage.getByText(typedName)).toHaveCount(0);

    // And its pre-set standing carried over — conclusive that we did not mint a
    // fresh (Good) row.
    await suppliersPage.goto("/standing");
    await expect(suppliersPage.getByText(/^watch$/i).first()).toBeVisible();
  });

  test("a fresh, non-overlapping email CREATES a new supplier row", async ({
    suppliersPage,
  }) => {
    skipUnlessMail();

    const mailbox = await requireMailbox("fresh");
    const typedName = uniqueSupplierName();
    await signUpSupplierAndVerify(suppliersPage, mailbox.address, typedName);
    const link = await mailbox.waitForLink(/verify|verification|token/i);
    await suppliersPage.goto(link);

    // No overlap → the portal has no row to attach, so it offers the register
    // form; completing it creates a brand-new supplier under the typed name.
    await suppliersPage.goto("/");
    const register = suppliersPage.getByRole("button", {
      name: /register & start onboarding/i,
    });
    await expect(register).toBeVisible();
    await suppliersPage.getByLabel(/business name/i).fill(typedName);
    await register.click();

    await expect(
      suppliersPage.getByRole("heading", {
        name: /your onboarding checklist/i,
      }),
    ).toBeVisible();
    await expect(suppliersPage.getByText(typedName).first()).toBeVisible();
    // A fresh row starts in Good standing.
    await suppliersPage.goto("/standing");
    await expect(
      suppliersPage.getByText(/good standing/i).first(),
    ).toBeVisible();
  });
});
