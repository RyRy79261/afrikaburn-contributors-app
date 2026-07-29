// specs/new-burner/art-and-vehicle-registration.spec.ts
//
// Persona: NEW BURNER — the two project kinds that are not theme camps.
//
// `/artworks/new`, `/artworks/[slug]/edit`, `/vehicles/new` and
// `/vehicles/[slug]/edit` are four live routes with their own forms, their own
// server actions, their own similar-name guard, and their own draft/submit
// split — and not one spec had ever loaded any of them. Everything the suite
// proved about registration was theme-camp shaped, which is exactly the class
// of code where a shared mistake hides: the camp dashboard has to route these
// two kinds to their OWN edit route, because following the camp CTA would open
// the six-section wizard whose columns and predicates all assume a theme camp
// and would overwrite an artwork's dimensions with camp answers.
//
// What each test walks:
//   1. Register from the real form, saving a DRAFT with only the name filled —
//      "your project exists the moment you save, and nothing goes to the crew
//      until you submit". A draft deliberately skips the submit gate.
//   2. Land on the project's dashboard and find the kind's OWN edit route
//      offered, never `/camps/<slug>/registration`.
//   3. Reopen that form: the answers are still there, and submitting THE SAME
//      incomplete draft is REFUSED by the kind's own gate, in its own words.
//   4. Complete what the gate asked for, and submit for real.
//
// Step 3 is the one that needed a browser. `artworkSubmitGate` /
// `vehicleSubmitGate` are pure and unit-tested, but whether the EDIT route runs
// them — as opposed to the create route only — is a wiring question, and a
// resubmit that skipped the gate would send the Art crew or the DMV a
// registration missing the fields their whole job depends on.
//
// No org session is needed for any of it, so nothing here skips.

import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import { signUpBurner } from "../../personas/factories";
import { uniqueName } from "../../lib/identity";

/** A YesNoField (field-kit.tsx) — a labelled group of two toggle buttons. */
async function answerYesNo(page: Page, label: string, answer: "Yes" | "No") {
  await page
    .getByRole("group", { name: label })
    .getByRole("button", { name: answer, exact: true })
    .click();
}

test.describe("new burner — art projects and mutant vehicles register on their own forms", () => {
  test("an art project drafts, is refused an incomplete submit, then submits", async ({
    webPage,
  }) => {
    test.setTimeout(240_000);
    await signUpBurner(webPage, { onboard: true });

    const artworkName = uniqueName("The Whispering Baobab");
    const placement = uniqueName("Near the Binnekring edge (artwork-e2e)");

    await webPage.goto("/artworks/new");
    await expect(
      webPage.getByRole("heading", { name: /register an art project/i }),
    ).toBeVisible();

    await webPage.getByLabel("Artwork name").fill(artworkName);
    await webPage.getByLabel("Placement notes").fill(placement);

    // SAVE DRAFT, not submit — the page promises the project exists either way,
    // and the gate does not run.
    await webPage.getByRole("button", { name: /^save draft$/i }).click();
    await webPage.waitForURL(/\/camps\/[^/]+$/);
    const slug = webPage.url().split("/").pop() ?? "";
    expect(slug.length).toBeGreaterThan(0);

    // The project's dashboard, and the CTA that routes it to ITS OWN form. A
    // link to `/camps/<slug>/registration` here would be the bug this exists to
    // catch — the camp wizard would happily overwrite the artwork's fields.
    await expect(
      webPage.getByRole("heading", { name: artworkName }),
    ).toBeVisible();
    await expect(
      webPage.getByRole("link", { name: /registration/i }).first(),
    ).toHaveAttribute("href", new RegExp(`/artworks/${slug}/edit$`));
    await expect(
      webPage.getByRole("link", { name: /begin registration/i }),
    ).toHaveCount(0);

    // Reopen: the draft's answers survived the round trip, and the name is
    // locked (renaming a project would orphan its slug).
    await webPage.goto(`/artworks/${slug}/edit`);
    await expect(webPage.getByLabel("Artwork name")).toHaveValue(artworkName);
    await expect(webPage.getByLabel("Artwork name")).toHaveAttribute(
      "readonly",
      "",
    );
    await expect(webPage.getByLabel("Placement notes")).toHaveValue(placement);

    // THE GATE, ON THE EDIT ROUTE. Submitting the same incomplete draft is
    // refused, and the refusal names the first thing missing rather than a
    // generic failure.
    await webPage.getByRole("button", { name: /^submit project$/i }).click();
    await expect(
      webPage.getByText(/who['’]s making it\? name the artist or collective/i),
    ).toBeVisible();
    await expect(webPage).toHaveURL(new RegExp(`/artworks/${slug}/edit$`));

    // Give the gate everything it asks for (shared.ts `artworkSubmitGate`).
    await webPage.getByLabel("Artist or collective").fill("Karoo Collective");
    await webPage
      .getByLabel("Description")
      .fill("A steel baobab whose branches whisper recordings of the Karoo.");
    await webPage.getByLabel("Width (m)").fill("6");
    await webPage.getByLabel("Depth (m)").fill("6");
    await webPage.getByLabel("Height (m)").fill("9");
    await answerYesNo(webPage, "Will this artwork be burned?", "No");
    await webPage
      .getByLabel("Build plan")
      .fill("Prefabricated in Cape Town, bolted together over three days.");
    await webPage
      .getByLabel("Strike & Leave No Trace plan")
      .fill("Unbolted and trucked out; the site is raked and MOOP-swept.");

    await webPage.getByRole("button", { name: /^submit project$/i }).click();
    await webPage.waitForURL(/\/camps\/[^/]+$/);
    await expect(webPage.getByText(/submitted/i).first()).toBeVisible();
  });

  test("a mutant vehicle drafts, is refused an incomplete submit, then submits", async ({
    webPage,
  }) => {
    test.setTimeout(240_000);
    await signUpBurner(webPage, { onboard: true });

    const vehicleName = uniqueName("Dust Kraken");

    await webPage.goto("/vehicles/new");
    await expect(
      webPage.getByRole("heading", { name: /mutant vehicle/i }).first(),
    ).toBeVisible();

    await webPage.getByLabel("Vehicle name").fill(vehicleName);
    await webPage.getByRole("button", { name: /^save draft$/i }).click();
    await webPage.waitForURL(/\/camps\/[^/]+$/);
    const slug = webPage.url().split("/").pop() ?? "";
    expect(slug.length).toBeGreaterThan(0);

    await expect(
      webPage.getByRole("heading", { name: vehicleName }),
    ).toBeVisible();
    await expect(
      webPage.getByRole("link", { name: /registration/i }).first(),
    ).toHaveAttribute("href", new RegExp(`/vehicles/${slug}/edit$`));

    await webPage.goto(`/vehicles/${slug}/edit`);
    await expect(webPage.getByLabel("Vehicle name")).toHaveValue(vehicleName);

    // Refused, with the DMV's own first question.
    await webPage.getByRole("button", { name: /submit to dmv/i }).click();
    await expect(
      webPage.getByText(/tell the dmv what you['’]re mutating/i),
    ).toBeVisible();

    // Everything `vehicleSubmitGate` asks for, including all three
    // acknowledgements — the gate checks the SET, so ticking one three times
    // would not do.
    await webPage.getByLabel("Base vehicle").fill("1987 Toyota Hilux");
    await webPage
      .getByLabel("Mutation description")
      .fill(
        "A trawler hull welded over the bakkie chassis, complete with mast.",
      );
    await webPage.getByRole("radio", { name: /level 1 — car stereo/i }).click();
    await answerYesNo(webPage, "Does your mutant carry flame effects?", "No");
    await answerYesNo(webPage, "Will you drive it after dark?", "Yes");
    for (const ack of await webPage.getByRole("checkbox").all()) {
      if (!(await ack.isChecked())) await ack.check();
    }

    await webPage.getByRole("button", { name: /submit to dmv/i }).click();
    await webPage.waitForURL(/\/camps\/[^/]+$/);
    await expect(webPage.getByText(/submitted/i).first()).toBeVisible();
  });
});
