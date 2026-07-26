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
import { completeBio, signUpBurner } from "../../personas/factories";
import { uniqueName, uniqueUsername } from "../../lib/identity";
import { fillDetailedBio } from "./support";

test.describe("new burner · Burner Bio", () => {
  test("completes the bio and the profile renders the saved fields", async ({
    webPage,
  }) => {
    await signUpBurner(webPage);
    const username = uniqueUsername("dusty");
    const homeCity = uniqueName("Springbok");

    await fillDetailedBio(webPage, {
      username,
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
    await expect(webPage.getByText(username).first()).toBeVisible();
    await expect(webPage.getByText(homeCity).first()).toBeVisible();
    await expect(webPage.getByText("2019").first()).toBeVisible();
  });

  test("per-field privacy toggles flip public ↔ private", async ({
    webPage,
  }) => {
    await signUpBurner(webPage);
    await webPage.goto("/onboarding");
    await webPage.getByRole("button", { name: "Get started" }).click();
    await webPage
      .getByRole("textbox", { name: /username/i })
      .fill(uniqueUsername("toggler"));

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
    await webPage
      .getByRole("textbox", { name: /username/i })
      .fill(uniqueUsername("locked"));

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

// --- The username -----------------------------------------------------------
//
// The handle replaced the required "burner name". Three things have to hold at
// once and only a browser can prove the combination: it is genuinely OPTIONAL
// (the gate still releases without one), it is genuinely UNIQUE (a second
// burner cannot take it), and it is genuinely VALIDATED (a malformed one is
// refused with a sentence, not a regex). The gate change is the risky half —
// `isBioComplete` used to BE the username check, so an off-by-one here either
// locks every new burner out of the app or lets an unfinished bio through.

test.describe("new burner · username", () => {
  test("the bio completes with NO username and still releases the gate", async ({
    webPage,
  }) => {
    await signUpBurner(webPage);
    await completeBio(webPage, { username: null });

    // The gate is released: the app's own redirect proves it. A pending blocking
    // Burner Bio action would bounce /profile straight back to /onboarding.
    await webPage.goto("/profile");
    await expect(webPage).toHaveURL(/\/profile/);
    await expect(
      webPage.getByRole("heading", { name: /your profile/i }),
    ).toBeVisible();

    // …and the nameless burner renders as the neutral placeholder. (This is the
    // OWNER's own page, where seeing your own email is correct — the "never fall
    // back to an email or a legal name" half of the rule is proven on a
    // third-party surface, in privacy-projection.spec.ts.)
    await expect(webPage.getByText(/unnamed burner/i).first()).toBeVisible();
    await expect(webPage.getByText(/not set/i).first()).toBeVisible();
  });

  test("refuses a malformed username with a human message", async ({
    webPage,
  }) => {
    await signUpBurner(webPage);
    await webPage.goto("/onboarding");
    await webPage.getByRole("button", { name: "Get started" }).click();

    const field = webPage.getByRole("textbox", { name: /username/i });
    await field.fill("Dusty Prototype"); // spaces are not in the charset
    await webPage.getByRole("button", { name: "Save & continue" }).click();

    const message = webPage.getByText(/letters, numbers and underscores/i);
    await expect(message).toBeVisible();
    // A human sentence, not a character class dumped at the user.
    await expect(message).not.toHaveText(/\[a-z|\^|\$/);
    // Still on the details step — the malformed handle blocked the step.
    await expect(field).toBeVisible();

    // Fixing it lets the step through — proven by ARRIVING on the next step,
    // not by the presence of a button both steps share.
    await field.fill(uniqueUsername("dusty"));
    await webPage.getByRole("button", { name: "Save & continue" }).click();
    await expect(
      webPage.getByRole("heading", { name: /your burns & volunteering/i }),
    ).toBeVisible();
  });

  test("a second burner cannot take a username that is already held", async ({
    webPage,
    makeAppPage,
  }) => {
    const handle = uniqueUsername("twinned");
    await signUpBurner(webPage, { onboard: true, username: handle });

    // A different account, in its own context, tries the SAME handle — and the
    // case-insensitive index is what it is really up against, so try the
    // upper-cased variant rather than an identical string.
    const second = await makeAppPage("web");
    await signUpBurner(second);
    await second.goto("/onboarding");
    await second.getByRole("button", { name: "Get started" }).click();
    await second
      .getByRole("textbox", { name: /username/i })
      .fill(handle.toUpperCase());
    await second.getByRole("button", { name: "Save & continue" }).click();

    // Refused — and the refusal names no holder: no email, no camp, no profile
    // link. Being told a handle is TAKEN is inherent to unique handles; being
    // told WHO holds it is not.
    // The refusal is a bare verdict: no email, no camp, and no route to the
    // holder's profile. Being told a handle is TAKEN is inherent to unique
    // handles; being told WHO holds it is not.
    await expect(second.getByText(/already taken/i)).toBeVisible();
    await expect(second.locator('a[href^="/burners/"]')).toHaveCount(0);
    await expect(second.getByText(/@/)).toHaveCount(0);
  });
});
