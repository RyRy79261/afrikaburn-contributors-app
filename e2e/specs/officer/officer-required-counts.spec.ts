// Outstanding required-officer counts reflect reality (M3-26; questionnaire-spec
// §"Outstanding-officers indicator" + §"Free camps: officers are entirely
// optional"). The badge is a live count of unassigned REQUIRED officers, and it
// exists ONLY for a camp with a registration in flight — a free camp shows no
// requirement at all. Assigning a required officer must decrement the count.
//
// Single-account journey: the lead is themselves a member, so they can self-
// assign to prove the count moves — no second burner needed.

import { test, expect } from "../../fixtures";
import type { Page } from "@playwright/test";
import {
  signUpBurner,
  createCamp,
  submitRegistration,
} from "../../personas/factories";
import { uniqueUsername } from "../../lib/identity";
import { OFFICER_NAMES, assignOfficer } from "./support";

/** Parse the "{n} outstanding" figure from the officers-section badge. */
async function outstandingCount(page: Page): Promise<number> {
  const text = await page
    .getByText(/\d+ outstanding/)
    .first()
    .textContent();
  const n = Number(/(\d+)\s+outstanding/.exec(text ?? "")?.[1]);
  expect(Number.isFinite(n)).toBe(true);
  return n;
}

test.describe("required-officer counts", () => {
  test("free camp shows no requirement; registering raises it; assigning lowers it", async ({
    webPage,
  }) => {
    test.slow();

    const leadName = uniqueUsername("lead");
    await signUpBurner(webPage, { onboard: true, username: leadName });
    const { slug } = await createCamp(webPage);

    // --- Free camp: officers are optional — no requirement, no count ---------
    await webPage.goto(`/camps/${slug}/settings/roles`);
    await expect(webPage).not.toHaveURL(/\/auth\/sign-in|\/onboarding/);
    await expect(
      webPage.getByText(/free camps don['’]t have required officers/i),
    ).toBeVisible();
    await expect(webPage.getByText(/\d+ outstanding/)).toHaveCount(0);
    await expect(
      webPage.getByText(/all required officers assigned/i),
    ).toHaveCount(0);

    // --- Register: requirements switch on -----------------------------------
    await submitRegistration(webPage, slug);
    await webPage.goto(`/camps/${slug}/settings/roles`);

    // The always-required officers are now tagged "required" on their rows.
    await expect(
      webPage.getByRole("button", { name: new RegExp(OFFICER_NAMES.lnt) }),
    ).toContainText(/required/i);
    await expect(
      webPage.getByRole("button", {
        name: new RegExp(OFFICER_NAMES.fireBaron),
      }),
    ).toContainText(/required/i);

    const before = await outstandingCount(webPage);
    expect(before).toBeGreaterThanOrEqual(2); // LNT Lead + Safety Baron, always

    // --- Assign a required officer: the count drops by exactly one -----------
    await assignOfficer(webPage, slug, OFFICER_NAMES.lnt, leadName);

    await webPage.goto(`/camps/${slug}/settings/roles`);
    await expect(
      webPage.getByText(new RegExp(`\\b${before - 1} outstanding`)),
    ).toBeVisible();
    // The LNT slot is now filled (pending counts as filled) — its row is no
    // longer in the "not yet assigned" outstanding state.
    await expect(
      webPage.getByRole("button", { name: new RegExp(OFFICER_NAMES.lnt) }),
    ).toContainText(/awaiting acceptance/i);
  });
});
