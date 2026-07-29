// specs/org-staff/bulletins-audience-reach.spec.ts
//
// Persona: ORG STAFF — bulletin fan-out beyond the one audience anyone tested.
//
// bulletins-targeting.spec.ts proves the machinery works for "Theme camp
// leads": a targeted burner receives, an untargeted burner does not. That is
// one selector out of eleven, and it is the FRIENDLIEST one — a resolver that
// simply returned "every burner with a bio" would pass it, because the
// untargeted account in that spec is a plain burner who leads nothing.
//
// Two harder cases, each of which a broken resolver fails differently:
//
//   1. ARTWORK LEADS — same account kind, different GROUP KIND. `art_leads`
//      resolves leads/admins of `artwork` groups; `camp_leads` resolves the
//      same relationship over `theme_camp`. A resolver that ignored kind would
//      send an artwork bulletin to every camp lead in the burn, and the only
//      way to see that is to have a real camp lead in the room and check they
//      did NOT get it. That control is what makes this non-vacuous.
//
//   2. SUPPLIERS — a different ACCOUNT KIND, on a THIRD APP. `org_suppliers`
//      reaches supplier-linked accounts, whose notifications live in the
//      supplier portal (:3002), not the participant app. Nothing in the suite
//      had ever published from the console and read the result in the supplier
//      portal, so the whole org→suppliers hop was unproven — and it is the one
//      AfrikaBurn will use to tell vendors anything.
//
// Both need a real org session, so both skip cleanly without E2E_GOD_EMAIL.

import type { Page } from "@playwright/test";
import { test, expect, skipUnlessGod } from "../../fixtures";
import { uniqueName } from "../../lib/identity";
import {
  signUpBurner,
  createCamp,
  createArtProject,
  registerSupplier,
} from "../../personas/factories";
import { provisionOrgStaff, desktopOnly } from "./_helpers";

/** Compose and publish one bulletin to `audience`, returning its title. */
async function publishBulletin(
  org: Page,
  audience: string,
  label: string,
): Promise<{ title: string; marker: string }> {
  const title = uniqueName(label);
  const marker = uniqueName("body");

  await org.goto("/bulletins/new");
  await org.getByPlaceholder(/ticket resale window/i).fill(title);
  const body = org.getByRole("textbox", { name: /bulletin body/i });
  await body.click();
  await org.keyboard.type(marker);

  // The audience picker is SINGLE-CHOICE by design (audience-options.ts: "a
  // bulletin targets ONE audience"), so there is no union case to drive here.
  await org.locator("#bulletin-audience").click();
  await org.getByRole("option", { name: audience, exact: true }).click();

  await org.getByRole("button", { name: /publish bulletin/i }).click();
  await expect(org.getByText(/bulletin published/i)).toBeVisible();
  return { title, marker };
}

test.describe("org staff · a bulletin reaches its audience and nobody else", () => {
  test.beforeEach(() => desktopOnly(test, test.info().project.name));

  test("an artwork bulletin reaches art leads and not camp leads", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    test.setTimeout(240_000);

    // TARGETED: a burner who registered an art project (a draft is enough — the
    // group exists the moment it is saved, which is what `art_leads` reads).
    const artist = await makeAppPage("web");
    await signUpBurner(artist, { onboard: true });
    await createArtProject(artist);

    // THE CONTROL THAT MATTERS: a THEME CAMP lead. Same account kind, same
    // lead relationship, different group kind. If this account receives the
    // bulletin, the resolver is not discriminating on kind and every artwork
    // notice goes to the whole burn.
    const campLead = await makeAppPage("web");
    await signUpBurner(campLead, { onboard: true });
    await createCamp(campLead);

    // And a burner who leads nothing at all.
    const bystander = await makeAppPage("web");
    await signUpBurner(bystander, { onboard: true });

    const staff = await provisionOrgStaff(makeAppPage);
    const { title, marker } = await publishBulletin(
      staff.org,
      "Artwork leads",
      "Binnekring build slots",
    );

    // Received, and the body came with it.
    await artist.goto("/notifications");
    await expect(artist.getByText(title)).toBeVisible();
    await artist.getByText(title).first().click();
    await expect(artist.getByText(marker)).toBeVisible();

    // Not received — by the camp lead OR the bystander. Checked on the
    // bulletins filter too, because a leak that only shows under a filter is
    // still a leak.
    for (const other of [campLead, bystander]) {
      await other.goto("/notifications");
      await expect(other.getByText(title)).toHaveCount(0);
      await other.goto("/notifications?filter=bulletins");
      await expect(other.getByText(title)).toHaveCount(0);
    }
  });

  test("a suppliers bulletin crosses into the supplier portal, and not to burners", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    test.setTimeout(240_000);

    // TARGETED: a real supplier account, registered through the portal's own
    // sign-up. `org_suppliers` reaches supplier-LINKED accounts, so a seeded
    // catalogue row with nobody behind it would not do.
    const supplierPortal = await makeAppPage("suppliers");
    await registerSupplier(supplierPortal);

    // THE CONTROL: a burner who leads a camp. Suppliers and participants are
    // different account kinds on different apps; a bulletin for vendors landing
    // in a camp lead's inbox is the failure this catches.
    const burner = await makeAppPage("web");
    await signUpBurner(burner, { onboard: true });
    await createCamp(burner);

    const staff = await provisionOrgStaff(makeAppPage);
    const { title, marker } = await publishBulletin(
      staff.org,
      "Suppliers",
      "Gate access for deliveries",
    );

    // THE CROSS-APP HOP. Published on :3001, read on :3002.
    await supplierPortal.goto("/notifications");
    await expect(supplierPortal.getByText(title)).toBeVisible();
    await supplierPortal.getByText(title).first().click();
    await expect(supplierPortal.getByText(marker)).toBeVisible();

    await burner.goto("/notifications");
    await expect(burner.getByText(title)).toHaveCount(0);
    await burner.goto("/notifications?filter=bulletins");
    await expect(burner.getByText(title)).toHaveCount(0);
  });
});
