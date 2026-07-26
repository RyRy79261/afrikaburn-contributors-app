// e2e/specs/officer/support.ts — the OFFICER persona's shared vocabulary.
//
// The officer journey is a five-party dance the base factories don't cover on
// their own, so this module composes them (never rebuilds them) and adds the two
// things the officer persona genuinely needs and the app is the only writer for:
//   1. a burner bio that carries a PHONE (the factory onboards without one, and
//      phone is the single field this whole persona is about) — set through the
//      real profile editor, not a DB back door; and
//   2. the officer assign / consent / org-review UI drivers.
//
// Selector provenance (verified against source on 2026-07-26):
//   profile phone .... apps/web/components/onboarding/bio-flow.tsx (Field "Phone"
//                      → PhoneInput id="phone"); persisted by saveBio on every
//                      save (apps/web/lib/bio-store.ts), final or not.
//   roles/officers ... apps/web/components/roles/{roles-settings,officer-row,
//                      role-row,new-role-card}.tsx
//   consent banner ... apps/web/components/roles/officer-consent-banner.tsx
//   inbox row ........ apps/web/components/notifications/notification-row.tsx
//   org review ....... apps/org/components/{registrations-table,registration-review}.tsx
//   org officer query. apps/org/lib/queries.ts getRegistrationOfficers
//                      (consent='accepted' AND org_visible=true — the sole gate)

import { expect } from "../../fixtures";
import type { Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
  submitRegistration,
  type Account,
} from "../../personas/factories";
import { uniqueName } from "../../lib/identity";

/** The fixed org catalog display names — camps may NOT alias these (officers.ts). */
export const OFFICER_NAMES = {
  lnt: "LNT Lead",
  safety: "Safety Officer",
  fireBaron: "Safety Baron",
  sound: "Sound Officer",
  monitor: "Safety Monitor",
} as const;

/**
 * A unique ZA phone. `national` is what a human types into the ZA-defaulted
 * PhoneInput; `marker` is the contiguous digit run that survives into the stored
 * E.164 ("+2782555XXXX") AND appears in the national form, so the same marker
 * asserts presence on the org page (where E.164 renders unspaced) without ever
 * colliding with the registration's LNT-lead phone (which renders WITH spaces).
 */
export function uniquePhone(): { national: string; marker: string } {
  // Four digits, never "0100" (the submitRegistration LNT-lead default tail).
  const pick = (): string =>
    (parseInt(randomBytes(2).toString("hex"), 16) % 10000)
      .toString()
      .padStart(4, "0");
  let tail = pick();
  while (tail === "0100") tail = pick();
  return { national: `082555${tail}`, marker: `82555${tail}` };
}

/**
 * Set the signed-in burner's bio phone through the real profile editor and
 * return its assertion marker. Advancing off the details step proves the server
 * write landed (saveBio persists phone even on a non-final save), so we don't
 * depend on completing every step.
 */
export async function setBioPhone(page: Page): Promise<{ marker: string }> {
  const phone = uniquePhone();
  await page.goto("/profile?edit=1");
  await expect(page).not.toHaveURL(/\/auth\/sign-in|\/onboarding/);

  const input = page.getByLabel("Phone", { exact: true });
  await input.click();
  await input.fill("");
  await input.pressSequentially(phone.national);

  // Save & continue persists the (non-final) bio; the flow advancing off the
  // details step — the Phone field leaving the DOM — confirms the round trip.
  await page.getByRole("button", { name: "Save & continue" }).click();
  await expect(page.getByLabel("Phone", { exact: true })).toHaveCount(0);
  return { marker: phone.marker };
}

export interface OfficerActor {
  account: Account;
  /** The burner-bio display name — what the member picker + org card show. */
  displayName: string;
  /** Digit run that appears in the org card only once the phone is shared. */
  phoneMarker: string;
}

/** Sign up + onboard a burner and give them a bio phone (a would-be officer). */
export async function onboardOfficerWithPhone(page: Page): Promise<OfficerActor> {
  const displayName = uniqueName("Officer");
  const account = await signUpBurner(page, { onboard: true, displayName });
  const { marker } = await setBioPhone(page);
  return { account, displayName, phoneMarker: marker };
}

export interface CampWithOfficer {
  slug: string;
  campName: string;
  leadDisplayName: string;
  officer: OfficerActor;
}

/**
 * The full precondition for an officer registration: a lead with a SUBMITTED
 * theme-camp registration (so the camp is org-visible and officer requirements
 * apply) and a second onboarded member who carries a phone. Uses two isolated
 * web contexts (leadPage / officerPage) — same origin, so they MUST be separate
 * contexts or they'd share a session.
 */
export async function setUpCampWithMember(
  leadPage: Page,
  officerPage: Page,
): Promise<CampWithOfficer> {
  const leadDisplayName = uniqueName("Lead");
  await signUpBurner(leadPage, { onboard: true, displayName: leadDisplayName });
  const { slug, name: campName } = await createCamp(leadPage);
  await submitRegistration(leadPage, slug);
  const { url } = await inviteToCamp(leadPage, slug, "member");

  const officer = await onboardOfficerWithPhone(officerPage);
  await joinByInvite(officerPage, url);

  return { slug, campName, leadDisplayName, officer };
}

/** Expand a roles/officers accordion row whose trigger contains `nameRe`. */
export async function expandRow(page: Page, nameRe: RegExp): Promise<void> {
  const trigger = page.getByRole("button", { name: nameRe }).first();
  await trigger.scrollIntoViewIfNeeded();
  // Only expand if it isn't already open (Radix mounts content only when open).
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
}

/**
 * As the lead: assign `memberDisplayName` to the officer role `officerName` and
 * confirm the PENDING officer registration was created (the row shows it is
 * awaiting acceptance — proof the write landed, not just that a toast fired).
 */
export async function assignOfficer(
  leadPage: Page,
  slug: string,
  officerName: string,
  memberDisplayName: string,
): Promise<void> {
  await leadPage.goto(`/camps/${slug}/settings/roles`);
  await expect(leadPage).not.toHaveURL(/\/auth\/sign-in|\/onboarding/);
  await expandRow(leadPage, new RegExp(officerName));

  const picker = leadPage
    .getByRole("combobox")
    .filter({ hasText: /choose a member/i });
  await picker.click();
  await leadPage
    .getByRole("option", { name: memberDisplayName, exact: true })
    .click();
  await leadPage.getByRole("button", { name: /ask them to accept/i }).click();

  await expect(
    leadPage.getByText(/awaiting acceptance/i).first(),
  ).toBeVisible();
}

/** As the assigned member: open the camp page and respond to the consent banner. */
export async function respondToConsent(
  officerPage: Page,
  slug: string,
  decision: "accept" | "decline",
): Promise<void> {
  await officerPage.goto(`/camps/${slug}`);
  const banner = officerPage.getByRole("heading", {
    name: /you've been asked to be a camp officer/i,
  });
  await expect(banner).toBeVisible();
  await officerPage
    .getByRole("button", { name: decision === "accept" ? "Accept" : "Decline" })
    .first()
    .click();
  // The banner clears once the pending consent is resolved (router.refresh).
  await expect(banner).toHaveCount(0);
}

/**
 * As god: page the registrations queue to the row for `campName` and open its
 * detail. The queue is ordered by updatedAt-desc and rows persist on the
 * throwaway CI branch, so we page defensively rather than assume page one.
 * Returns the detail URL so a later assertion can re-fetch it cheaply.
 */
export async function openOrgRegistration(
  orgPage: Page,
  campName: string,
): Promise<string> {
  const MAX_PAGES = 25;
  for (let p = 1; p <= MAX_PAGES; p++) {
    await orgPage.goto(`/registrations?page=${p}`);
    const link = orgPage.getByRole("link", { name: campName, exact: true });
    if (await link.count()) {
      await link.first().click();
      await orgPage.waitForURL(/\/registrations\/[0-9a-f-]+$/i);
      return orgPage.url();
    }
    if (await orgPage.getByText(/no registrations/i).count()) break;
  }
  throw new Error(
    `[e2e:officer] "${campName}" never appeared in the org registrations queue ` +
      `within ${MAX_PAGES} pages — expected a submitted registration to be listed.`,
  );
}
