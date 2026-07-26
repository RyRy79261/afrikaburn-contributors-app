// specs/camp-lead/camp-lifecycle.spec.ts
//
// Persona: CAMP LEAD — the birth of a camp. Create it with the deliberately
// three-field form, become its structural lead automatically, and see the
// roster. Then the dedupe boundaries: an EXACT name collision is refused by the
// server; a NEAR-duplicate is soft-warned and can still be confirmed.
//
// This is the persona's PRIMARY journey, so it runs on BOTH Playwright projects
// (desktop-chromium + mobile-360 — playwright.config.ts): the required mobile
// coverage, driven through role/label selectors that reflow identically.

import { test, expect } from "../../fixtures";
import { signUpBurner, createCamp } from "../../personas/factories";
import { uniqueName } from "../../lib/identity";
import { attemptCreateCamp, confirmWarnedCreate } from "./support";

test.describe("camp lead — create & become lead", () => {
  test("creating a camp with the three-field form makes the creator its lead", async ({
    webPage,
  }) => {
    const leadName = uniqueName("Lead Alice");
    await signUpBurner(webPage, { onboard: true, displayName: leadName });

    // The whole form is three fields: name, description, joinability. Nothing
    // about kind, approval, or payment — created camps are free theme camps.
    const camp = await createCamp(webPage, {
      description: "A dusty tea house gifting chai at dawn.",
    });

    await webPage.goto(`/camps/${camp.slug}`);
    await expect(
      webPage.getByRole("heading", { name: camp.name }),
    ).toBeVisible();
    // Free-camp badge (never charged; not registered yet).
    await expect(webPage.getByText("Free camp")).toBeVisible();

    // Become-lead-automatically: the creator's own roster row reads "(you)" and
    // carries the structural Lead badge — proof the membership was written as
    // lead, not merely that a create link existed.
    await expect(webPage.getByText(leadName)).toBeVisible();
    await expect(webPage.getByText("(you)")).toBeVisible();
    await expect(webPage.getByText("Lead", { exact: true })).toBeVisible();

    // Lead-only surfaces are present for the lead (their counter-proof lives in
    // the camp-member forbidden suite): invites + role management + registration.
    await expect(webPage.getByText("Invite links")).toBeVisible();
    await expect(
      webPage.getByRole("link", { name: /manage roles/i }),
    ).toBeVisible();
    await expect(
      webPage.getByRole("link", { name: /begin registration/i }),
    ).toBeVisible();
  });

  test("an exact-name duplicate is REFUSED by the server", async ({
    webPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });

    // A distinctive, worker-unique base name so the only exact match in the
    // shared DB is our own first camp.
    const name = uniqueName("Karoo Kombuis Original");
    const first = await createCamp(webPage, { name });
    expect(first.slug).toBeTruthy();

    // Same normalized name again → hard refusal (checkCampName `exact`). This is
    // the SERVER rejecting, surfaced as the form's alert; the page never
    // navigates to a second camp.
    const second = await attemptCreateCamp(webPage, name);
    expect(second.outcome).toBe("error");
    expect(second.message ?? "").toMatch(/already uses that name/i);
    await expect(webPage).toHaveURL(/\/camps\/new$/);
  });

  test("a near-duplicate name is soft-warned, then confirmable", async ({
    webPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });

    const base = uniqueName("Vuurvlieg Collective Camp");
    await createCamp(webPage, { name: base });

    // Drop the last character: not an exact normalized match, but well above the
    // 0.55 trigram-similarity warn threshold — so the form warns rather than
    // refusing, and the lead can still proceed.
    const near = base.slice(0, -1);
    const attempt = await attemptCreateCamp(webPage, near);
    expect(attempt.outcome).toBe("warn");
    expect(attempt.message ?? "").toMatch(/similar to existing camp/i);

    // Confirming (clicking Create again) is honoured — near-duplicates are
    // allowed on purpose (two camps really can have similar names).
    const confirmed = await confirmWarnedCreate(webPage);
    await webPage.goto(`/camps/${confirmed.slug}`);
    await expect(
      webPage.getByRole("heading", { name: near }),
    ).toBeVisible();
  });
});
