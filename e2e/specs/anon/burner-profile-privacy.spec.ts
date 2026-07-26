// specs/anon/burner-profile-privacy.spec.ts — two guarantees about a burner's
// public profile: (1) an ANONYMOUS visitor is refused it outright, and (2) the
// public projection strips the hard-locked PII columns even when the owner has
// flipped EVERY toggle to public — and even for a viewer who legitimately holds a
// session (a camp-mate). Registry: see-hard-locked-field-public; the canonical
// hard-lock list is packages/core HARD_LOCKED_PRIVATE_FIELDS (mirrored in
// personas/registry.ts). Guard: apps/web/lib/groups-store.ts
// getPublicBurnerProfile — it never SELECTs the sensitive columns and runs the
// rest through publicBioView.
//
// PRODUCT-vs-BRIEF DISCREPANCY (flagged in the report): the persona brief lists
// "open a public burner profile" under what an anon CAN do, but the route
// (apps/web/app/burners/[id]/page.tsx) redirects an unauthenticated visitor to
// sign-in. So the honest anon assertion is a REFUSAL, and the PII-projection
// guarantee is proven through a signed-in stranger (a camp-mate) — because the
// projection, NOT the auth gate, is what must strip the PII. A camp-mate is the
// realistic "closest" viewer, and the hard-lock must hold even for them.

import { type Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueName } from "../../lib/identity";

// Unique, free-text sentinels for the hard-locked fields. They are distinctive
// strings so their ABSENCE from the rendered profile is an unambiguous proof —
// not a formatting coincidence. (Phone is normalised to E.164, so we assert on
// the raw digit run, which survives normalisation.)
interface Sentinels {
  displayName: string;
  homeCity: string;
  phoneDigits: string;
  onsiteName: string;
  offsiteName: string;
  medical: string;
  idNumber: string;
}

function makeSentinels(): Sentinels {
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase();
  return {
    displayName: uniqueName("Dusty"),
    homeCity: `HomeCity${tag}`,
    phoneDigits: "825550137",
    onsiteName: `OnsiteName${tag}`,
    offsiteName: `OffsiteName${tag}`,
    medical: `MedicalNote${tag}`,
    idNumber: `IdNumber${tag}`,
  };
}

/**
 * Drive the full Burner Bio onboarding, filling the hard-locked PII fields with
 * sentinels AND flipping every public-eligible toggle to PUBLIC — the worst case
 * for the privacy projection. Not a shared factory: this is a deliberately
 * PII-heavy, all-public setup specific to this guarantee (factories keep bios
 * minimal). Selectors verified against apps/web/components/onboarding/bio-flow.tsx
 * + components/privacy-toggles.tsx.
 */
async function completePiiBioAllPublic(
  page: Page,
  s: Sentinels,
): Promise<void> {
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Get started" }).click();

  // Step 2 — Your details (public-eligible + hard-locked fields).
  await page.getByRole("textbox", { name: /burner name/i }).fill(s.displayName);
  await page.getByRole("textbox", { name: /home city/i }).fill(s.homeCity);
  await page.locator("#phone").fill(s.phoneDigits);
  await page.getByLabel("On-site contact name").fill(s.onsiteName);
  await page.getByLabel("Off-site contact name").fill(s.offsiteName);
  await page.getByRole("textbox", { name: /medical notes/i }).fill(s.medical);
  // The id number input carries a dotted id ("id.number"); escape it for CSS.
  await page.locator("#id\\.number").fill(s.idNumber);
  await page.getByRole("button", { name: "Save & continue" }).click();

  // Step 3 — Burns & volunteering (nothing required).
  await page.getByRole("button", { name: "Save & continue" }).click();

  // Step 4 — Privacy review: flip EVERY public-eligible switch to public. The
  // hard-locked rows render as static "Locked private" spans (no switch), so this
  // can only ever expose the fields that are legally exposable.
  const switches = page.getByRole("switch");
  const count = await switches.count();
  for (let i = 0; i < count; i++) {
    const sw = switches.nth(i);
    if ((await sw.getAttribute("aria-checked")) !== "true") {
      await sw.click();
    }
  }
  await page.getByRole("button", { name: "Complete my bio" }).click();
  await expect(page.getByText(/you're all set/i)).toBeVisible();
}

test.describe("anonymous visitor — burner profile privacy", () => {
  test("an anon visitor is refused a burner profile (server redirect to sign-in)", async ({
    webPage,
  }) => {
    // A syntactically valid but random user id: the route Zod-validates the uuid
    // and STILL requires a session before any lookup, so an anon is bounced
    // regardless of whether the id exists — no existence oracle, no data.
    const someUuid = "00000000-0000-4000-8000-000000000000";
    await webPage.goto(`/burners/${someUuid}`);
    await expect(webPage).toHaveURL(/\/auth\/sign-in/);
    await expect(webPage.getByLabel("Email", { exact: true })).toBeVisible();
  });

  test("hard-locked PII is structurally absent from the public profile even when every toggle is public", async ({
    webPage,
    makeAppPage,
  }) => {
    const s = makeSentinels();

    // OWNER: sign up, then complete a PII-loaded, all-public bio.
    await signUpBurner(webPage);
    await completePiiBioAllPublic(webPage, s);

    // OWNER also creates a FREE camp and a member invite so a stranger can become
    // a camp-mate (the only signed-in surface that links to the owner's profile).
    const camp = await createCamp(webPage);
    const invite = await inviteToCamp(webPage, camp.slug);

    // STRANGER: a separate onboarded burner who joins the camp via the invite.
    const strangerPage = await makeAppPage("web");
    await signUpBurner(strangerPage, { onboard: true });
    const joined = await joinByInvite(strangerPage, invite.url);
    expect(joined.slug).toBe(camp.slug);

    // From the roster, the camp-mate opens the owner's public profile. (Camp-mates
    // always see each other's display names, so we locate the owner by name.)
    await strangerPage.goto(`/camps/${camp.slug}`);
    const ownerLink = strangerPage.getByRole("link", { name: s.displayName });
    await expect(ownerLink).toBeVisible();
    const href = await ownerLink.getAttribute("href");
    expect(href).toMatch(/^\/burners\/[0-9a-f-]{36}$/);
    await strangerPage.goto(href!);

    // We are on the owner's profile (proves the surface rendered, so the absence
    // assertions below are meaningful — not an empty page passing by accident).
    await expect(
      strangerPage.getByRole("heading", { name: s.displayName }),
    ).toBeVisible();

    // POSITIVE control: a public-eligible field the owner set PUBLIC IS shown.
    await expect(strangerPage.getByText(s.homeCity)).toBeVisible();

    // THE GUARANTEE: none of the hard-locked values appear ANYWHERE on the page,
    // regardless of the all-public toggles. A leak here fails the spec.
    const body = strangerPage.locator("body");
    await expect(body).not.toContainText(s.phoneDigits);
    await expect(body).not.toContainText(s.onsiteName);
    await expect(body).not.toContainText(s.offsiteName);
    await expect(body).not.toContainText(s.medical);
    await expect(body).not.toContainText(s.idNumber);

    // And the owner's FREE camp membership is NOT broadcast on the profile —
    // public profiles list only registered camps (undiscoverability applied to
    // "profile camp lists").
    await expect(body).not.toContainText(camp.name);
  });
});
