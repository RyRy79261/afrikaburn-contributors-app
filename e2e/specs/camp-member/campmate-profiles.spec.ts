// specs/camp-member/campmate-profiles.spec.ts
//
// Persona: CAMP MEMBER — camp-mate profiles (epic #68). Three levels per bio
// field (Only me / Camp mates / Public), an opt-in "people in my camp" view,
// and a private profile photo served only through an authorised proxy.
//
// Every refusal here is the SERVER's, and each is paired with a POSITIVE
// control on the same data so the guard is proven discriminating rather than
// blanket-deny:
//
//   · a camp_mates field is shown to a camp-mate and NOT to a lead of another
//     camp (@quagga/core `campmateBioView`, via lib/campmates-store);
//   · the people view lists an opted-in camp-mate to a member, and is a
//     not-found for a non-member (`buildCampPeopleView`) — medical and the
//     hard-locked fields never appear on it;
//   · the upload refuses an SVG by its bytes even when it is labelled
//     image/png (positive control: a real PNG gets past the byte check).
//
// HONEST SCOPE: the local e2e stack has no BLOB_READ_WRITE_TOKEN (see
// camp-lead/layout-uploads.spec.ts for why), so a real photo is never stored
// here — a PNG upload answers 501, and the photo PROXY answers 404 to everyone
// before it reaches any authorisation (storage unconfigured). A "stranger gets
// 404" check here would therefore pass even if the visibility predicate let
// everyone through, so this spec deliberately makes NO claim about who may see
// a photo. That decision — stranger refused a camp_mates photo, camp-mate
// served it (the positive control) — is proven against a stored photo, with
// the token stubbed, in apps/web lib/__tests__/avatar-routes.test.ts and
// campmates-store.test.ts.
//
// Selectors: apps/web/components/privacy-toggles.tsx (radios named
// "<field>: <level>"), components/campmate-settings-fields.tsx (the people-list
// switch), app/(app)/camps/[slug]/people/page.tsx.

import { type Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  completeBio,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueName, uniqueUsername } from "../../lib/identity";
import { expectServerNotFound, setHardLockedBioData } from "./support";

/** `EDIT_STEPS` in bio-flow.tsx: details, burns, privacy. */
const EDIT_STEP_COUNT = 3;

/**
 * Set one bio field's audience from the profile editor's Privacy step, then
 * save. `field` is the registry label (BIO_PRIVACY_FIELDS), `level` the
 * toggle's label.
 */
async function setFieldLevel(
  page: Page,
  field: string,
  level: "Only me" | "Camp mates" | "Public",
): Promise<void> {
  await expect(async () => {
    await page.goto("/profile?edit=1");
    await expect(
      page.getByRole("heading", { name: /edit your bio/i }),
    ).toBeVisible({ timeout: 10_000 });
    for (let step = 1; step < EDIT_STEP_COUNT; step += 1) {
      await expect(
        page.getByText(`Step ${step} of ${EDIT_STEP_COUNT}`),
      ).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: "Save & continue" }).click();
    }
    await expect(
      page.getByText(`Step ${EDIT_STEP_COUNT} of ${EDIT_STEP_COUNT}`),
    ).toBeVisible({ timeout: 10_000 });
    const radio = page.getByRole("radio", { name: `${field}: ${level}` });
    await radio.click();
    await expect(radio).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(/\/profile(\?.*)?$/, { timeout: 15_000 });
  }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 4_000] });
}

/** Turn on "Show me in my camp's people list" from the profile card, and
 * prove it persisted by reloading. */
async function optIntoPeopleList(page: Page): Promise<void> {
  await page.goto("/profile");
  const toggle = page.getByRole("switch", {
    name: /show me in my camp['’]s people list/i,
  });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(async () => {
    await page.reload();
    await expect(
      page.getByRole("switch", {
        name: /show me in my camp['’]s people list/i,
      }),
    ).toHaveAttribute("aria-checked", "true", { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
}

/** Read a burner's id from their roster link on a camp page. */
async function burnerIdFromRoster(
  page: Page,
  slug: string,
  username: string,
): Promise<string> {
  await page.goto(`/camps/${slug}`);
  const link = page.getByRole("link", { name: username }).first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  const id = href?.match(/\/burners\/([0-9a-f-]{36})/i)?.[1];
  if (!id) throw new Error(`[campmates] no burner link for ${username}`);
  return id;
}

test.describe("camp member — camp-mate profiles", () => {
  test("a camp_mates field reaches the camp-mate and not a lead of another camp", async ({
    makeAppPage,
  }) => {
    test.setTimeout(240_000);
    const ownerPage = await makeAppPage("web");
    const matePage = await makeAppPage("web");
    const outsiderPage = await makeAppPage("web");

    const ownerName = uniqueUsername("alice_hatter");
    const city = uniqueName("CAMPMATECITY Stofpad");

    // OWNER: a bio with a home city, shared with CAMP MATES only.
    await signUpBurner(ownerPage);
    await completeBio(ownerPage, { username: ownerName, homeCity: city });
    const camp = await createCamp(ownerPage);
    await setFieldLevel(ownerPage, "Home city", "Camp mates");
    const invite = await inviteToCamp(ownerPage, camp.slug, "member");

    // CAMP-MATE: joins the owner's camp.
    await signUpBurner(matePage, { onboard: true });
    await joinByInvite(matePage, invite.url);
    const ownerId = await burnerIdFromRoster(matePage, camp.slug, ownerName);

    // OUTSIDER: the lead of a DIFFERENT camp — seniority elsewhere is not a
    // shared camp.
    await signUpBurner(outsiderPage, { onboard: true });
    await createCamp(outsiderPage, { name: uniqueName("Long Drop Inn") });

    // Positive control: the camp-mate sees the camp_mates field.
    await matePage.goto(`/burners/${ownerId}`);
    await expect(
      matePage.getByRole("heading", { name: ownerName }),
    ).toBeVisible();
    await expect(matePage.getByText(/camp-mate profile/i)).toBeVisible();
    await expect(matePage.getByText(city)).toBeVisible();

    // The refusal: same profile, same field, a viewer from another camp.
    await outsiderPage.goto(`/burners/${ownerId}`);
    await expect(
      outsiderPage.getByRole("heading", { name: ownerName }),
    ).toBeVisible();
    await expect(outsiderPage.getByText(/public profile/i)).toBeVisible();
    await expect(outsiderPage.getByText(city)).toHaveCount(0);
  });

  test("the people view is opt-in, members-only, and never carries medical or hard-locked fields", async ({
    makeAppPage,
  }) => {
    test.setTimeout(240_000);
    const ownerPage = await makeAppPage("web");
    const matePage = await makeAppPage("web");
    const outsiderPage = await makeAppPage("web");

    const ownerName = uniqueUsername("ren_notfound");
    const medicalNotes = uniqueName("MEDICALSENTINEL bee sting");
    const onsiteContactName = uniqueName("EMERGENCYSENTINEL Jabu");

    await signUpBurner(ownerPage, { onboard: true, username: ownerName });
    const camp = await createCamp(ownerPage, {
      name: uniqueName("Karoo Kombuis"),
    });
    await setHardLockedBioData(ownerPage, { onsiteContactName, medicalNotes });
    const invite = await inviteToCamp(ownerPage, camp.slug, "member");

    await signUpBurner(matePage, { onboard: true });
    await joinByInvite(matePage, invite.url);

    // OFF BY DEFAULT: the page renders for a member, and lists nobody.
    await matePage.goto(`/camps/${camp.slug}/people`);
    await expect(
      matePage.getByRole("heading", { name: `People in ${camp.name}` }),
    ).toBeVisible();
    await expect(matePage.getByText(/nobody['’]s listed yet/i)).toBeVisible();
    await expect(matePage.getByRole("link", { name: ownerName })).toHaveCount(
      0,
    );

    // The owner opts in; now the camp-mate sees them.
    await optIntoPeopleList(ownerPage);
    await matePage.reload();
    await expect(matePage.getByRole("link", { name: ownerName })).toBeVisible();
    // Lists never carry medical notes or a hard-locked field.
    const body = matePage.locator("body");
    await expect(body).not.toContainText(medicalNotes);
    await expect(body).not.toContainText(onsiteContactName);

    // A non-member is refused the page outright — the same not-found as a
    // camp that does not exist, so a free camp's people stay undiscoverable.
    await signUpBurner(outsiderPage, { onboard: true });
    await expectServerNotFound(outsiderPage, `/camps/${camp.slug}/people`, [
      camp.name,
      ownerName,
    ]);
  });

  test("the photo upload refuses an SVG by its bytes", async ({
    makeAppPage,
  }) => {
    const ownerPage = await makeAppPage("web");
    await signUpBurner(ownerPage, { onboard: true });

    // An SVG labelled as a PNG: refused by the sniffed bytes (415), before the
    // deployment's storage is even consulted.
    const svg = await ownerPage.request.post("/api/avatar", {
      multipart: {
        file: {
          name: "me.png",
          mimeType: "image/png",
          buffer: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
          ),
        },
      },
    });
    expect(svg.status()).toBe(415);

    // Positive control for the upload route: a real PNG is ACCEPTED as a
    // photo and only then refused for storage (501 here, no blob token) — so
    // the 415 above is about the bytes, not a blanket refusal.
    const png = await ownerPage.request.post("/api/avatar", {
      multipart: {
        file: {
          name: "me.png",
          mimeType: "image/png",
          buffer: Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
          ]),
        },
      },
    });
    expect([200, 501]).toContain(png.status());
    // No proxy assertion here on purpose — see HONEST SCOPE in the header.
  });
});
