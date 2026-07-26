// Persona: ORG STAFF — compose a markdown bulletin, target one audience,
// publish, and prove the fan-out is EXACTLY the audience: a targeted account
// receives it and a non-targeted account provably does not.
//
// Audience = "Theme camp leads" (camp_leads): resolves to leads/admins of any
// theme_camp. So a burner who created a camp is IN it; a plain burner is OUT.
// This is a real cross-app assertion — org publishes, the participant inboxes
// are checked on the web app. Desktop project only (compose is a wide editor;
// the receipt half is what matters and is asserted plainly).

import { test, expect, skipUnlessGod } from "../../fixtures";
import { uniqueName } from "../../lib/identity";
import { signUpBurner, createCamp } from "../../personas/factories";
import { provisionOrgStaff, desktopOnly } from "./_helpers";

test.describe("org staff · bulletins", () => {
  test.beforeEach(() => desktopOnly(test, test.info().project.name));

  test("a published bulletin reaches its audience and no one else", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();

    // Targeted: a burner who leads a theme camp. Non-targeted: a plain burner.
    const targeted = await makeAppPage("web");
    await signUpBurner(targeted, { onboard: true });
    await createCamp(targeted);

    const nonTargeted = await makeAppPage("web");
    await signUpBurner(nonTargeted, { onboard: true });

    const staff = await provisionOrgStaff(makeAppPage);

    // --- Compose (with markdown) + target camp_leads + publish ----------
    await staff.org.goto("/bulletins/new");
    const title = uniqueName("Build week notice");
    const marker = `Bring closed shoes ${Date.now().toString(36)}`;
    await staff.org
      .getByPlaceholder(/ticket resale window/i)
      .fill(title);

    // The body is a tiptap markdown editor (contenteditable, aria-labelled).
    const body = staff.org.getByRole("textbox", { name: /bulletin body/i });
    await body.click();
    await staff.org.keyboard.type(`**Heads up** — ${marker}`);

    // Audience picker (the AudienceSelect trigger carries id="bulletin-audience").
    await staff.org.locator("#bulletin-audience").click();
    await staff.org
      .getByRole("option", { name: "Theme camp leads" })
      .click();

    await staff.org.getByRole("button", { name: /publish bulletin/i }).click();
    await expect(staff.org.getByText(/bulletin published/i)).toBeVisible();

    // --- Targeted burner RECEIVES it -----------------------------------
    await targeted.goto("/notifications");
    await expect(targeted.getByText(title)).toBeVisible();
    // Open it and confirm the markdown body persisted + rendered.
    await targeted.getByText(title).first().click();
    await expect(targeted.getByText(marker)).toBeVisible();

    // --- Non-targeted burner provably does NOT ------------------------
    await nonTargeted.goto("/notifications");
    await expect(nonTargeted.getByText(title)).toHaveCount(0);
    // And its bulletins filter is empty (no over-broadcast leak).
    await nonTargeted.goto("/notifications?filter=bulletins");
    await expect(nonTargeted.getByText(title)).toHaveCount(0);
  });
});
