// specs/new-burner/burner-bio.spec.ts — the Burner Bio, filled and constrained.
//
// The bio is the new burner's real onboarding. This covers completing it and the
// mechanics that carry privacy weight: per-field public/private toggles flip in
// both directions, the years-attended grid offers real years and DISABLES the
// no-burn years (2020/2021), and the hard-locked classes (phone, both emergency
// contacts, medical, ID) can NEVER be toggled public in the UI. The server-side
// half of the hard-lock (nothing leaks onto a public surface) is proven in
// privacy-projection.spec.ts.
//
// Primary journey → runs on desktop AND 360px mobile via the config's projects.

import { test, expect } from "../../fixtures";
import { signUpBurner } from "../../personas/factories";
import { uniqueName } from "../../lib/identity";
import { fillDetailedBio } from "./support";

test.describe("new burner · Burner Bio", () => {
  test("completes the bio and the profile renders the saved fields", async ({
    webPage,
  }) => {
    await signUpBurner(webPage);
    const displayName = uniqueName("Dusty");
    const homeCity = uniqueName("Springbok");

    await fillDetailedBio(webPage, {
      displayName,
      homeCity,
      homeCityPublic: true,
      attendedYears: [2019, 2022],
      about: uniqueName("chai at dawn"),
      phoneNational: "825550101",
      onsiteName: uniqueName("Onsite"),
      offsiteName: uniqueName("Offsite"),
      medical: uniqueName("Medical"),
      idNumber: uniqueName("ID"),
    });

    // The owner's own profile reflects the saved bio (proves the write landed).
    await webPage.goto("/profile");
    await expect(
      webPage.getByRole("heading", { name: /your profile/i }),
    ).toBeVisible();
    await expect(webPage.getByText(displayName).first()).toBeVisible();
    await expect(webPage.getByText(homeCity).first()).toBeVisible();
    await expect(webPage.getByText("2019").first()).toBeVisible();
  });

  test("per-field privacy toggles flip public ↔ private", async ({
    webPage,
  }) => {
    await signUpBurner(webPage);
    await webPage.goto("/onboarding");
    await webPage.getByRole("button", { name: "Get started" }).click();
    await webPage.getByLabel(/burner name/i).fill(uniqueName("Toggler"));

    // Home city defaults PUBLIC; a click makes it private.
    const city = webPage.getByRole("switch", {
      name: /home city.*public or private/i,
    });
    await expect(city).toHaveAttribute("aria-checked", "true");
    await city.click();
    await expect(city).toHaveAttribute("aria-checked", "false");

    // Legal ("real") name defaults PRIVATE; a click makes it public.
    const legal = webPage.getByRole("switch", {
      name: /legal name.*public or private/i,
    });
    await expect(legal).toHaveAttribute("aria-checked", "false");
    await legal.click();
    await expect(legal).toHaveAttribute("aria-checked", "true");
  });

  test("years-attended offers real years and disables the no-burn years", async ({
    webPage,
  }) => {
    await signUpBurner(webPage);
    await webPage.goto("/onboarding");
    await webPage.getByRole("button", { name: "Get started" }).click();

    // Real burn years are selectable…
    await expect(
      webPage.getByRole("button", { name: "2026", exact: true }),
    ).toBeEnabled();
    await expect(
      webPage.getByRole("button", { name: "2019", exact: true }),
    ).toBeEnabled();

    // …and 2020 / 2021 (no burn was held) are present but DISABLED — the domain
    // fact is encoded in the control, not just documented.
    await expect(
      webPage.getByRole("button", { name: /2020 .*no burn/i }),
    ).toBeDisabled();
    await expect(
      webPage.getByRole("button", { name: /2021 .*no burn/i }),
    ).toBeDisabled();
  });

  test("hard-locked fields cannot be toggled public in the UI", async ({
    webPage,
  }) => {
    await signUpBurner(webPage);
    await webPage.goto("/onboarding");
    await webPage.getByRole("button", { name: "Get started" }).click();
    await webPage.getByLabel(/burner name/i).fill(uniqueName("Locked"));

    // On the details step every hard-locked class renders an "always private"
    // switch that is DISABLED — it cannot be flipped on.
    for (const name of [
      /phone.*always private/i,
      /on-site emergency contact.*always private/i,
      /off-site emergency contact.*always private/i,
      /medical notes.*always private/i,
      /identity document.*always private/i,
    ]) {
      await expect(webPage.getByRole("switch", { name })).toBeDisabled();
    }

    // Advance to the Privacy review step, where the hard-lock is even starker:
    // the locked classes have NO switch at all, just a "Locked private" chip,
    // while a public-eligible field (home city) still has a working switch.
    await webPage.getByRole("button", { name: "Save & continue" }).click(); // → burns
    await webPage.getByRole("button", { name: "Save & continue" }).click(); // → privacy
    await expect(webPage.getByText(/locked private/i).first()).toBeVisible();
    await expect(webPage.getByRole("switch", { name: /phone/i })).toHaveCount(0);
    await expect(
      webPage.getByRole("switch", { name: /home city/i }),
    ).toHaveCount(1);
  });
});
