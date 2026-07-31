// specs/camp-lead/review-loop.spec.ts
//
// Persona: CAMP LEAD — the changes-requested loop, end to end across two apps.
// Org requests changes with per-section feedback → the lead SEES that feedback
// on the flagged section → edits it → resubmits → the org sees it back in the
// queue as submitted. The org counterpart is a real god session (elevateToGod),
// never mocked; the whole spec skips cleanly without E2E_GOD_EMAIL.
//
// THE REPLY HALF USED TO BE A `test.fixme` HERE, on the grounds that "the
// camp-side reply affordance is NOT yet built" and "the wizard and summary
// render org feedback READ-ONLY". Both statements stopped being true at some
// point and nobody came back: `SectionReplyThread` is mounted in BOTH surfaces
// (registration-summary.tsx and registration-wizard.tsx) and posts through
// `replyToSectionReviewAction`.
//
// A skipped test claiming a feature is unbuilt, about a feature that is built,
// is worse than no test — it is a standing invitation to build it twice, and it
// makes the suite's own "1 skipped" a lie about coverage. Same defect the five
// stubs in tests/negative-paths.spec.ts had. It is a real test now.

import type { Page } from "@playwright/test";
import { test, expect, skipUnlessGod } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  submitRegistration,
  elevateToGod,
} from "../../personas/factories";
import { uniqueName } from "../../lib/identity";
import {
  addSectionComment,
  decide,
  openRegistrationInConsole,
} from "./support";

/** Go to a wizard section by its label (rail + strip; see wizard.tsx). */
async function goToSection(page: Page, label: RegExp) {
  await page.getByRole("button", { name: label }).first().click();
}

test.describe("camp lead — org review loop", () => {
  test("org requests changes on a section; the lead sees it, edits, and resubmits", async ({
    webPage,
    orgPage,
  }) => {
    skipUnlessGod();

    // A camp with a submitted registration.
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Chai at dawn." });
    await submitRegistration(webPage, camp.slug);

    // Org opens it and requests changes with a section-specific comment on LNT.
    const feedback = uniqueName(
      "Please add your grey-water evaporation plan (review-loop-probe)",
    );
    await elevateToGod(orgPage);
    await openRegistrationInConsole(orgPage, camp.name);
    await addSectionComment(orgPage, "lnt", feedback);
    await decide(
      orgPage,
      "Request changes",
      "The Leave No Trace section needs more detail before this can be approved.",
    );
    // Org side reflects the new state.
    await expect(orgPage.getByText(/changes requested/i).first()).toBeVisible();

    // Lead side: the registration reopens as an editable wizard, banners the
    // request, and shows the org's feedback on the flagged section.
    await webPage.goto(`/camps/${camp.slug}/registration`);
    await expect(
      webPage.getByText(/afrikaburn asked for changes/i),
    ).toBeVisible();
    await goToSection(webPage, /leave no trace/i);
    await expect(webPage.getByText(/org feedback/i)).toBeVisible();
    await expect(webPage.getByText(feedback)).toBeVisible();

    // The lead edits the flagged section and resubmits.
    await webPage
      .getByLabel(/leave no trace plan/i)
      .fill(
        "MOOP sweeps twice daily; grey water evaporated in lined trays off-playa; " +
          "all waste packed out. (updated after AB feedback)",
      );
    await webPage
      .getByRole("button", { name: /resubmit registration/i })
      .click();

    // Resubmitting moves the state back to submitted → the locked summary shows.
    await expect(
      webPage.getByText(/submitted — awaiting review|under review/i),
    ).toBeVisible();

    // Org sees it back in the pipeline as submitted (no longer changes-requested).
    await orgPage.reload();
    await expect(orgPage.getByText(/changes requested/i)).toHaveCount(0);
    await expect(orgPage.getByText(/^submitted$/i).first()).toBeVisible();
  });

  // The camp-side reply UI is not yet built (see file header). This is the
  // assertion it exists to hold, parked as fixme rather than dropped: once a
  test("the lead replies on a section thread, and the reviewer sees it", async ({
    webPage,
    orgPage,
  }) => {
    skipUnlessGod();
    test.setTimeout(240_000);

    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Chai at dawn." });
    await submitRegistration(webPage, camp.slug);

    const ask = uniqueName("Tell us more about grey water (reply-loop-probe)");
    await elevateToGod(orgPage);
    // Hold the URL — the reviewer comes back to this page at the end, and
    // walking the queue a second time is a hop this test does not need.
    const detailUrl = await openRegistrationInConsole(orgPage, camp.name);
    await addSectionComment(orgPage, "lnt", ask);
    await decide(orgPage, "Request changes", "Needs LNT detail.");

    // The lead opens the flagged section and finds the org's comment plus a way
    // to answer it. `changes_requested` reopens the wizard, so this is the
    // editable surface.
    await webPage.goto(`/camps/${camp.slug}/registration`);
    await goToSection(webPage, /leave no trace/i);
    await expect(webPage.getByText(ask)).toBeVisible();

    const answer = uniqueName(
      "Grey water is evaporated in lined trays (reply-loop-probe)",
    );
    await webPage
      .getByRole("button", { name: /^reply$/i })
      .first()
      .click();
    await webPage.getByRole("textbox", { name: "Your reply" }).fill(answer);
    await webPage.getByRole("button", { name: /^send reply$/i }).click();
    await expect(webPage.getByText(answer)).toBeVisible();

    // IT SURVIVES A RELOAD, so it reached `section_review_replies` rather than
    // component state.
    await webPage.reload();
    await goToSection(webPage, /leave no trace/i);
    await expect(webPage.getByText(answer)).toBeVisible();

    // THE HALF NOBODY HAS EVER CHECKED. A reply the reviewer cannot read is a
    // camp talking to itself — and this is a two-way conversation or it is
    // nothing. The org's own thread on that section must carry it.
    await orgPage.goto(detailUrl);
    await expect(orgPage.locator("#lnt").getByText(answer)).toBeVisible();
  });
});
