// specs/new-burner/support.ts — helpers SPECIFIC to the new-burner suite.
//
// This is NOT a rebuild of the shared factories (personas/factories.ts): those
// deliberately fill only the ONE required Burner-Bio field (display name) and
// leave everything at defaults. The privacy-projection and bio journeys need the
// OPPOSITE — a bio with every class of field populated (public-eligible, flipped
// private, and all the hard-locked classes) so the suite can prove what does and
// does not cross the server's public-projection boundary. That richer form
// driving lives here, once, driven entirely through the real onboarding UI.
//
// It is a plain module (no `.spec`/`.test` suffix) so Playwright never collects
// it as a test file — only the shared runner imports it.
//
// Selector provenance (verified against source 2026-07-26):
//   onboarding flow ... apps/web/components/onboarding/bio-flow.tsx
//   details fields .... bio-flow.tsx DetailsStep (+ @quagga/ui phone-input, switch)
//   burns/about ....... apps/web/components/questionnaire/burns-step.tsx
//   privacy review .... apps/web/components/privacy-toggles.tsx

import { expect, type Page } from "@playwright/test";

/** A full Burner-Bio payload the suite can assert against on the public profile.
 * Every string is a caller-supplied sentinel so a leak is unambiguous. */
export interface DetailedBioInput {
  /** The account handle — the only name any public surface shows. */
  username: string;
  /** Public-eligible city sentinel. */
  homeCity: string;
  /** false ⇒ flip the (default-public) Home-city toggle to PRIVATE before saving. */
  homeCityPublic: boolean;
  /** Attended years to select (real burn years only — 2020/2021 are disabled). */
  attendedYears: number[];
  /** Default-public "for the burns" bio sentinel — should appear on the profile. */
  about: string;
  // Hard-locked classes — every one must be absent from every public surface,
  // regardless of any flag. Names/medical/id are plaintext or encrypted columns
  // the public projection never selects; phone is E.164-normalised on save.
  phoneNational: string;
  onsiteName: string;
  offsiteName: string;
  medical: string;
  idNumber: string;
}

/**
 * Drive the 5-step onboarding Burner Bio to completion with a fully-populated
 * payload, exercising the per-field privacy toggle and the hard-locked inputs.
 * Leaves the page on the "You're all set" done step (the bio is persisted final).
 */
export async function fillDetailedBio(
  page: Page,
  input: DetailedBioInput,
): Promise<void> {
  await page.goto("/onboarding");
  // A fresh burner lands on the bio flow, never bounced to sign-in or /profile.
  await expect(page).toHaveURL(/\/onboarding/);

  // Step 1 — Welcome.
  await page.getByRole("button", { name: "Get started" }).click();

  // Step 2 — Your details.
  await page.getByRole("textbox", { name: /username/i }).fill(input.username);
  await page.getByRole("textbox", { name: /home city/i }).fill(input.homeCity);

  for (const year of input.attendedYears) {
    await page.getByRole("button", { name: String(year), exact: true }).click();
  }

  // Per-field privacy: Home city defaults PUBLIC. Flip it to PRIVATE when asked,
  // and assert the control actually toggled (the switch is the real UI seam).
  const cityToggle = page.getByRole("switch", {
    name: /home city.*public or private/i,
  });
  await expect(cityToggle).toHaveAttribute("aria-checked", "true");
  if (!input.homeCityPublic) {
    await cityToggle.click();
    await expect(cityToggle).toHaveAttribute("aria-checked", "false");
  }

  // Hard-locked classes. Phone number input carries id="phone"; the emergency
  // NAME inputs carry aria-labels; medical + ID number carry ids (dotted → attr).
  await page.locator("#phone").fill(input.phoneNational);
  await page.getByLabel(/on-site contact name/i).fill(input.onsiteName);
  await page.getByLabel(/off-site contact name/i).fill(input.offsiteName);
  await page
    .getByRole("textbox", { name: /medical notes/i })
    .fill(input.medical);
  await page.getByRole("radio", { name: "Passport", exact: true }).click();
  await page.locator('[id="id.number"]').fill(input.idNumber);

  await page.getByRole("button", { name: "Save & continue" }).click();

  // Step 3 — Burns & volunteering: a default-public "about" sentinel.
  await page.getByLabel(/a bit about you/i).fill(input.about);
  await page.getByRole("button", { name: "Save & continue" }).click();

  // Step 4 — Privacy review → finalise.
  await page.getByRole("button", { name: "Complete my bio" }).click();

  // Step 5 — Done.
  await expect(page.getByText(/you['’]re all set/i)).toBeVisible();
}

/**
 * Read a burner's user id (a uuid) out of a camp roster the current page is
 * showing — the roster links each member to `/burners/<userId>`. This is the
 * app's own, real way a viewer reaches a third party's profile; there is no DB
 * back door for it. Requires the viewer to be a member (roster is member-gated).
 */
export async function readBurnerIdFromRoster(
  page: Page,
  username: string,
): Promise<string> {
  const link = page.getByRole("link", { name: username }).first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  const id = href?.split("/burners/").pop()?.trim();
  expect(id, `roster link for ${username} → ${href}`).toBeTruthy();
  return id as string;
}
