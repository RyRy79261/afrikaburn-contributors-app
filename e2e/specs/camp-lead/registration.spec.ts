// specs/camp-lead/registration.spec.ts
//
// Persona: CAMP LEAD — the six-section theme-camp registration wizard.
//   • Happy path: fill all six sections and submit → the state machine lands on
//     `submitted` (asserted on the dashboard, not just a toast).
//   • Save & resume: a half-finished draft survives a brand-new browser session
//     (the autosave is real, server-side — not client state).
//   • Incomplete submit is refused: the submit gate stays locked until every
//     section is complete; the progress meter advances section-by-section but the
//     action never opens while anything is missing.
//
// The happy path runs on both projects (desktop + mobile-360) — the wizard's
// section navigator renders a desktop rail and a mobile strip from the same
// section list, so the role-based section buttons resolve on either viewport.

import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  signInAs,
  createCamp,
  submitRegistration,
  type Account,
} from "../../personas/factories";
import { uniqueName } from "../../lib/identity";

/** Go to a wizard section by its label (works on rail + strip; see wizard.tsx). */
async function goToSection(page: Page, label: RegExp) {
  await page.getByRole("button", { name: label }).first().click();
}

test.describe("camp lead — registration wizard", () => {
  test("all six sections complete → submit succeeds and lands on submitted", async ({
    webPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Chai at dawn." });

    // The shared factory drives every one of the six sections and submits.
    await submitRegistration(webPage, camp.slug);

    // The write persisted and the state machine advanced: the dashboard tile
    // reads a submitted status (not "Not started"/"Draft").
    await webPage.goto(`/camps/${camp.slug}`);
    await expect(
      webPage.getByText(/submitted|under review/i).first(),
    ).toBeVisible();
    // The locked post-submission view is what an admin now sees on the reg page.
    await webPage.goto(`/camps/${camp.slug}/registration`);
    await expect(
      webPage.getByText(/submitted — awaiting review|under review/i),
    ).toBeVisible();
  });

  test("a half-finished draft resumes in a brand-new session", async ({
    webPage,
    makeAppPage,
  }) => {
    const lead: Account = await signUpBurner(webPage, { onboard: true });
    // No description at creation, so the values we type below are unambiguously
    // the ones the autosave persisted.
    const camp = await createCamp(webPage);

    const email = `resume-${uniqueName("lead").replace(/\s+/g, "-")}@example.com`;
    const lntPlan =
      "Twice-daily MOOP sweeps; grey water evaporated off-playa. (resume-probe)";

    await webPage.goto(`/camps/${camp.slug}/registration`);
    // Section 1 (active by default).
    await webPage.getByLabel(/camp description/i).fill("Draft in progress.");
    await webPage.getByLabel("Contact email", { exact: true }).fill(email);
    // Section 2 — navigating commits section 1; fill one field to leave a partial.
    await goToSection(webPage, /leave no trace/i);
    await webPage.getByLabel(/leave no trace plan/i).fill(lntPlan);
    // Blur to flush, then wait for the SERVER save to confirm.
    await webPage.getByLabel(/lnt lead name/i).click();
    await expect(webPage.getByText(/saved just now/i)).toBeVisible();

    // Brand-new browser context (fresh cookies/session) as the same lead.
    const freshPage = await makeAppPage("web");
    await signInAs(freshPage, lead);
    await freshPage.goto(`/camps/${camp.slug}/registration`);

    // Section 1's value is restored (identity is the default-active section).
    await expect(
      freshPage.getByLabel("Contact email", { exact: true }),
    ).toHaveValue(email);
    // …and a value typed in a DIFFERENT section is restored too.
    await goToSection(freshPage, /leave no trace/i);
    await expect(freshPage.getByLabel(/leave no trace plan/i)).toHaveValue(
      lntPlan,
    );
  });

  test("submit stays refused until every section is complete", async ({
    webPage,
  }) => {
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage);
    await webPage.goto(`/camps/${camp.slug}/registration`);

    const submit = webPage.getByRole("button", {
      name: /submit registration/i,
    });

    // Nothing filled: the gate is explicitly locked and the meter reads 0 of 6.
    await expect(submit).toBeDisabled();
    await expect(
      webPage.getByText(/submit opens once all six sections are complete/i),
    ).toBeVisible();
    await expect(
      webPage.getByText(/0 of 6 sections complete/i),
    ).toBeVisible();
    await expect(webPage.getByText(/still needed/i)).toBeVisible();

    // Complete ONE section (identity = description + contact email). The meter
    // advances to 1 of 6 — but the submit gate is STILL refused, because five
    // sections remain. Partial completeness never opens the action.
    await webPage.getByLabel(/camp description/i).fill("A tea house on the playa.");
    await webPage
      .getByLabel("Contact email", { exact: true })
      .fill("lead@example.com");
    await goToSection(webPage, /leave no trace/i); // navigate → commits section 1
    await expect(
      webPage.getByText(/1 of 6 sections complete/i),
    ).toBeVisible();
    await expect(submit).toBeDisabled();
  });
});
