// Persona: ORG STAFF — build a questionnaire (several question types + a branch),
// activate it to an audience, have a real recipient answer it, and see the
// results aggregate (roadmap M3-27, org half).
//
// SHARED-STATE SAFETY (repaired): the audience is org_OUTBOUND + NON-BLOCKING on
// purpose. It is NOT org_internal, and it is NOT blocking. Why that matters:
//   - An org_internal audience resolves to EVERY org member — which in a parallel
//     run is the single shared god account (E2E_GOD_EMAIL) plus every other
//     worker's freshly-elevated org_staff. A BLOCKING org_internal send would
//     trap all of them behind the console gate on their next load, cascading
//     failures across the whole suite. So org_internal-blocking is forbidden from
//     any spec that shares the org group (which is all of them).
//   - Only a blocking org_internal questionnaire has an in-console FILL surface
//     (the ConsoleGate). A non-blocking org_internal has none. So to answer an
//     org questionnaire without gating shared accounts, we send it OUTBOUND to a
//     DEDICATED, freshly-created onboarded burner and let them fill it in the
//     participant app. Nothing blocks anyone; the only account that answers is
//     one this test created.
//   - The blocking gate's trap-AND-release invariant is proven — self-contained
//     and camp-scoped, so it cannot poison anyone — by
//     specs/camp-member/camp-member-blocking-questionnaire.spec.ts. This spec
//     deliberately does not duplicate that with an org-scoped blocking send.
//
// Residual coupling (honest): `all_current_burners` resolves edition-wide, so
// every onboarded burner alive at send time also becomes a NON-blocking
// recipient (a dashboard card, never a gate). That is benign — no spec asserts
// the absence of an unrelated pending card — and it is the least-coupled outbound
// option, since no outbound selector resolves to exactly one user.
//
// Desktop project only — the builder is a three-column authoring grid.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { uniqueName } from "../../lib/identity";
import { signUpBurner } from "../../personas/factories";
import { provisionOrgStaff, desktopOnly } from "./_helpers";

/** Pull the activation uuid out of a `/questionnaires/<key>/<uuid>` href. */
function activationIdFrom(href: string | null): string | null {
  return href?.match(/questionnaires\/[^/]+\/([0-9a-f-]{36})/i)?.[1] ?? null;
}

test.describe("org staff · questionnaires", () => {
  test.beforeEach(() => desktopOnly(test, test.info().project.name));

  test("builds a branched questionnaire, sends it outbound, a burner answers it, and the aggregate is correct", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    const staff = await provisionOrgStaff(makeAppPage);
    const org = staff.org;

    // A DEDICATED recipient, onboarded BEFORE the send so the edition-wide
    // `all_current_burners` audience resolves to include them. This is the only
    // account that will actually answer — every assertion below keys on it.
    const recipientPage = await makeAppPage("web");
    await signUpBurner(recipientPage, { onboard: true });

    // --- Build (builder v2) ---------------------------------------------
    await org.goto("/questionnaires/new");
    const title = uniqueName("Shift Signup");
    await org.getByPlaceholder("e.g. Pre-event safety check-in").fill(title);
    await org
      .getByPlaceholder(/one line telling recipients/i)
      .fill("A quick check-in for the crew.");

    // Several question TYPES, added to section 1 via the palette rail.
    await org.getByRole("button", { name: "Multiple choice", exact: true }).click();
    await org.getByRole("button", { name: "Short answer", exact: true }).click();
    await org.getByRole("button", { name: "Yes / No", exact: true }).click();
    // A second section (branch target + a fourth type there).
    await org.getByRole("button", { name: "Add section", exact: true }).click();
    await org.getByRole("button", { name: "Paragraph", exact: true }).click();

    // Prompts, in DOM order: s1 choice, s1 short, s1 boolean, s2 paragraph.
    const prompts = org.getByRole("textbox", { name: "Question prompt" });
    await prompts.nth(0).fill("Which shift do you prefer?");
    await prompts.nth(1).fill("Any dietary needs?");
    await prompts.nth(2).fill("Can you lift 20kg?");
    await prompts.nth(3).fill("Anything else to add?");

    // Options for the multiple-choice question.
    await org.getByRole("textbox", { name: "Option 1 label" }).fill("Morning");
    await org.getByRole("textbox", { name: "Option 2 label" }).fill("Evening");

    // A BRANCH (M3-27 requires one in the build): choosing "Morning" (option 1)
    // jumps straight to submit, skipping section 2 (forward-only). The recipient
    // below deliberately answers "Evening" so it walks the FULL linear path —
    // exercising both sections deterministically, without depending on the
    // runtime branch-resolution to decide where the fill ends.
    await org.getByRole("combobox", { name: "Where option 1 goes" }).click();
    await org
      .getByRole("option", { name: /submit the questionnaire/i })
      .click();

    // Publish → the app routes to the activation screen for this new key.
    await org
      .getByRole("button", { name: /publish & choose audience/i })
      .click();
    await org.waitForURL(/\/questionnaires\/[^/]+\/activate/);
    const key = org.url().split("/questionnaires/")[1]!.split("/")[0]!;

    // --- Activate (OUTBOUND, NON-blocking — no shared account is gated) ---
    // The audience-mode card's accessible name is its title + caption, so match
    // the title as a substring, not exact. The selector chip below is a plain
    // label button.
    await org.getByRole("button", { name: /^outbound/i }).click();
    await org
      .getByRole("button", { name: /all current burners/i })
      .click();
    // Blocking stays OFF (default). Assert it, so a future default flip can't
    // silently turn this into a shared-account-poisoning blocking send.
    await expect(org.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await org.getByRole("button", { name: /send questionnaire/i }).click();

    // Send lands back on the list; the outbound activation row carries the id.
    await org.waitForURL(/\/questionnaires$/);
    // EXCLUDE the card's own Edit and Send links. Three href shapes share the
    // `/questionnaires/<key>/` prefix on this page — `…/edit`, `…/activate`
    // and the activation row `…/<uuid>` — so `.first()` picked whichever the
    // card rendered first and the id regex then found nothing in "/edit".
    const outboundRow = org
      .locator(
        `a[href^="/questionnaires/${key}/"]:not([href$="/edit"]):not([href$="/activate"])`,
      )
      .first();
    await expect(outboundRow).toBeVisible();
    const activationId = activationIdFrom(await outboundRow.getAttribute("href"));
    if (!activationId) {
      throw new Error(
        `[org-staff] Could not read the activation id from the outbound row href.`,
      );
    }

    // --- The dedicated burner answers it in the participant app ----------
    // Non-blocking, so this is a normal navigable fill page (submitLabel
    // "Submit"). Choosing "Evening" avoids the Morning→submit branch, so the
    // paragraph in section 2 IS reached — proving the second section renders.
    await recipientPage.goto(`/questionnaires/${activationId}`);
    await expect(
      recipientPage.getByRole("heading", { name: title }),
    ).toBeVisible();
    await recipientPage.getByRole("radio", { name: "Evening" }).click();
    await recipientPage.getByLabel("Any dietary needs?").fill("None");
    await recipientPage.getByRole("button", { name: "Yes", exact: true }).click();
    await recipientPage.getByRole("button", { name: /^next$/i }).click();
    await recipientPage
      .getByLabel("Anything else to add?")
      .fill("Looking forward to it.");
    await recipientPage.getByRole("button", { name: "Submit", exact: true }).click();
    // The fill page confirms completion (redirects to the directory or shows the
    // "Already submitted" state on a re-open).
    await recipientPage.goto(`/questionnaires/${activationId}`);
    await expect(
      recipientPage.getByText(/already submitted/i),
    ).toBeVisible();

    // --- Results aggregate ----------------------------------------------
    await org.goto(`/questionnaires/${key}/${activationId}`);
    await org.waitForURL(
      new RegExp(`/questionnaires/${key}/[0-9a-f-]{36}`),
    );

    // Exactly one completed response (our recipient) out of however many the
    // edition-wide audience resolved to.
    await expect(org.getByText(/1 of \d+ completed/)).toBeVisible();
    await expect(
      org.getByRole("heading", { name: "Which shift do you prefer?" }),
    ).toBeVisible();
    // The one respondent chose Evening → that option's bar reads 1 · 100% (100%
    // of the single response to this question), and the paragraph they typed is
    // summarised, proving section 2 was reached and recorded.
    await expect(org.getByText("Evening").first()).toBeVisible();
    await expect(org.getByText("1 · 100%").first()).toBeVisible();
    await expect(org.getByText("Looking forward to it.")).toBeVisible();
  });
});
