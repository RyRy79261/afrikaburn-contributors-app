// specs/new-burner/creative-project-parity.spec.ts
//
// Persona: NEW BURNER — epic #52, creative-project parity (App Spec §18
// CREATIVE-007, -014, -017).
//
// Artworks and mutant vehicles register through their own forms and store
// their answers in the questionnaire spine, so everything built onto the camp
// registration skipped them. What this walks, in a real browser:
//
//   1. WAP + SAFETY DOCUMENTS round-trip. A new artwork requests Work Access
//      Passes and attaches a safety document (pasted https link — the local
//      stack has no Blob token, and the paste path is the one every deployment
//      has) with an expiry. Reopening the form shows both.
//   2. THE DOCUMENTS ARE PRIVATE. They are not on the project's own dashboard,
//      and a signed-in stranger sent to the edit route never sees the form.
//   3. PROJECT-SCOPED QUESTIONNAIRES live on the kind's own route:
//      /artworks/<slug>/questionnaires renders for the lead, the old
//      /camps/<slug>/questionnaires URL redirects there, and a vehicle URL with
//      an artwork's slug is a 404 rather than someone else's questionnaires.
//
// Not walked here: previous-year duplication. It needs a registration in an
// EARLIER edition, and editions are seed data with exactly one row — there is
// no in-app way to create a prior year, and seeding one would break the
// "seeds are reference data only" law. The policy and the store decisions are
// unit-tested (packages/core project-registration, apps/web
// project-registration-store).

import { test, expect } from "../../fixtures";
import { signUpBurner } from "../../personas/factories";
import { uniqueName } from "../../lib/identity";
import type { Page } from "@playwright/test";

/**
 * Save the artwork form as a draft and land on its dashboard.
 *
 * The form SOFT-WARNS on a near-duplicate name ("Similar to the existing
 * project … Submit again to keep this name") and needs a second, confirming
 * click. `uniqueName` varies a suffix, not the stem, so once the other
 * browser project or an earlier run has saved one, a near-match is likely —
 * a single click then leaves the page on the form and the redirect never
 * comes (seen in CI on 26 Sep). Same handling as the camp factory
 * (personas/factories.ts); the warning itself is asserted by
 * art-and-vehicle-registration.spec.ts.
 */
async function saveDraft(page: Page): Promise<string> {
  const save = page.getByRole("button", { name: /^save draft$/i });
  const dashboard = /\/camps\/[^/]+$/;
  await save.click();
  const warning = page.getByText(/similar to the existing project/i);
  await Promise.race([
    page.waitForURL(dashboard).catch(() => undefined),
    warning.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined),
  ]);
  if (await warning.count()) await save.click();
  await page.waitForURL(dashboard);
  return page.url().split("/").pop() ?? "";
}

test.describe("new burner — creative projects reach camp parity", () => {
  test("an artwork requests WAPs and keeps a private safety document", async ({
    webPage,
    makeAppPage,
  }) => {
    test.setTimeout(240_000);
    await signUpBurner(webPage, { onboard: true });

    const artworkName = uniqueName("Kalkoentjie Totem");
    const docTitle = uniqueName("Structural sign-off");

    await webPage.goto("/artworks/new");
    await expect(
      webPage.getByRole("heading", { name: /register an art project/i }),
    ).toBeVisible();

    await webPage.getByLabel("Artwork name").fill(artworkName);
    await webPage.getByLabel(/^work access passes/i).fill("4");

    await webPage.getByLabel("Document name").fill(docTitle);
    await webPage.getByLabel("Expires on").fill("2099-12-31");
    await webPage
      .getByLabel("Document link")
      .fill("https://example.com/structural-sign-off.pdf");
    await webPage.getByRole("button", { name: /^add document$/i }).click();
    await expect(webPage.getByRole("link", { name: docTitle })).toBeVisible();

    const slug = await saveDraft(webPage);
    expect(slug.length).toBeGreaterThan(0);

    // PRIVATE: the dashboard rendered (present), and the document is not on it.
    await expect(
      webPage.getByRole("heading", { name: artworkName }),
    ).toBeVisible();
    await expect(webPage.getByText(docTitle)).toHaveCount(0);

    // Round trip: the WAP request and the document came back with the draft.
    await webPage.goto(`/artworks/${slug}/edit`);
    await expect(webPage.getByLabel("Artwork name")).toHaveValue(artworkName);
    await expect(webPage.getByLabel(/^work access passes/i)).toHaveValue("4");
    await expect(webPage.getByRole("link", { name: docTitle })).toHaveAttribute(
      "href",
      "https://example.com/structural-sign-off.pdf",
    );
    await expect(webPage.getByText(/covers the event/i).first()).toBeVisible();

    // A signed-in stranger is bounced off the edit route onto the dashboard,
    // which a free (unregistered) project hides from non-members.
    const stranger = await makeAppPage("web");
    await signUpBurner(stranger, { onboard: true });
    await stranger.goto(`/artworks/${slug}/edit`);
    await expect(
      stranger.getByRole("heading", { name: /we couldn['’]t find that camp/i }),
    ).toBeVisible();
    await expect(stranger.getByText(docTitle)).toHaveCount(0);
  });

  test("an artwork's questionnaires live on the artwork route", async ({
    webPage,
  }) => {
    test.setTimeout(240_000);
    await signUpBurner(webPage, { onboard: true });

    const artworkName = uniqueName("Dust Lantern");
    await webPage.goto("/artworks/new");
    await webPage.getByLabel("Artwork name").fill(artworkName);
    const slug = await saveDraft(webPage);

    // The dashboard's CTA points at the artwork route, not the camp one.
    await expect(
      webPage.getByRole("link", { name: /manage questionnaires/i }),
    ).toHaveAttribute("href", `/artworks/${slug}/questionnaires`);

    await webPage.goto(`/artworks/${slug}/questionnaires`);
    await expect(
      webPage.getByRole("heading", { name: /^questionnaires$/i }),
    ).toBeVisible();
    await expect(
      webPage.getByRole("link", { name: /new questionnaire/i }),
    ).toHaveAttribute("href", `/artworks/${slug}/questionnaires/new`);

    // Old camp-shaped URL: redirected to the artwork's own route.
    await webPage.goto(`/camps/${slug}/questionnaires/new`);
    await webPage.waitForURL(
      new RegExp(`/artworks/${slug}/questionnaires/new$`),
    );
    await expect(
      webPage.getByRole("heading", { level: 1, name: /new questionnaire/i }),
    ).toBeVisible();

    // A vehicle URL with an artwork's slug is a 404, never its questionnaires.
    await webPage.goto(`/vehicles/${slug}/questionnaires`);
    await expect(
      webPage.getByRole("heading", { name: /we couldn['’]t find that/i }),
    ).toBeVisible();
    await expect(
      webPage.getByRole("link", { name: /new questionnaire/i }),
    ).toHaveCount(0);
  });
});
