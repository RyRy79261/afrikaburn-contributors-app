// specs/org-staff/wrangler-assignment.spec.ts
//
// Persona: ORG STAFF — assigning a camp its "dusty guardian angel".
//
// Until migration 0026 the review screen carried a permanently DISABLED
// "Assign wrangler" button promising it "unlocks after approval". It never
// unlocked, for anyone, at any status, because nothing existed behind it. This
// walks what replaced it.
//
// ## The leak test is the point
//
// The roadmap requires an adversarial pass on this fan-out (M4-08): the
// notification must reach the assigned wrangler and that camp's leads, and
// NOBODY ELSE. A hook that resolved recipients from a role — "notify the org",
// "notify camp leads" — would satisfy every happy-path assertion here and send
// one camp's business to every other camp in the burn.
//
// So the room contains four accounts on purpose: the camp that gets a wrangler,
// the wrangler, ANOTHER camp's lead, and ANOTHER org member. The last two are
// the test. Everything else is setup.
//
// Needs a real org session, so it skips cleanly without E2E_GOD_EMAIL.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { uniqueUsername } from "../../lib/identity";
import {
  signUpBurner,
  createCamp,
  submitRegistration,
} from "../../personas/factories";
import { decide, openRegistrationInConsole } from "../camp-lead/support";
import { provisionOrgStaff, desktopOnly } from "./_helpers";

test.describe("org staff · wrangler assignment", () => {
  test.beforeEach(() => desktopOnly(test, test.info().project.name));

  test("assigns a wrangler after approval; the camp and the wrangler hear, nobody else does", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    test.setTimeout(300_000);

    // The camp that will get a wrangler.
    const campLead = await makeAppPage("web");
    await signUpBurner(campLead, { onboard: true });
    const camp = await createCamp(campLead, { description: "Chai at dawn." });
    await submitRegistration(campLead, camp.slug);

    // THE CONTROL CAMP — a different lead, whose own registration is in the
    // same queue. If they receive the other camp's wrangler news, the fan-out
    // is resolving an audience instead of a membership.
    const otherLead = await makeAppPage("web");
    await signUpBurner(otherLead, { onboard: true });
    const otherCamp = await createCamp(otherLead, { description: "Shade." });
    await submitRegistration(otherLead, otherCamp.slug);

    // The reviewer, and the person who will do the wrangling. Both are org
    // accounts; the second is also THE CONTROL for the org side — an org member
    // who is not the assignee must not be told either.
    //
    // NAMED, because the picker excludes org accounts without a username: the
    // console renders `publicMemberName`, so a bio-less account shows as the
    // literal "Unnamed burner" and a list of them is unusable. That exclusion is
    // the product's rule, and needing it here is the proof it was needed.
    const wranglerName = uniqueUsername("wrangler");
    const reviewerName = uniqueUsername("reviewer");
    const staff = await provisionOrgStaff(makeAppPage, {
      username: reviewerName,
    });
    const wrangler = await provisionOrgStaff(makeAppPage, {
      username: wranglerName,
    });
    const bystanderStaff = await provisionOrgStaff(makeAppPage, {
      username: uniqueUsername("bystander"),
    });

    // --- REFUSED BEFORE APPROVAL ------------------------------------------
    // The screen's promise, now true: the control is present and disabled, and
    // it says which of the two refusals applies.
    await openRegistrationInConsole(staff.org, camp.name);
    const picker = staff.org.getByRole("combobox", {
      name: /^assign wrangler/i,
    });
    await expect(picker).toBeVisible();
    await expect(picker).toBeDisabled();
    await expect(
      staff.org.getByText(
        /gets its wrangler when its registration is approved/i,
      ),
    ).toBeVisible();

    // --- APPROVE, THEN ASSIGN ---------------------------------------------
    await decide(staff.org, "Approve");
    await expect(staff.org.getByText(/approve applied/i)).toBeVisible();

    const picker2 = staff.org.getByRole("combobox", {
      name: "Assign wrangler",
    });
    await expect(picker2).toBeEnabled();
    await picker2.click();
    await staff.org.getByRole("option", { name: wranglerName }).click();
    await expect(staff.org.getByText(/wrangler assigned/i)).toBeVisible();

    // --- THE CAMP HEARS, AND ITS DASHBOARD AGREES -------------------------
    await campLead.goto("/notifications");
    await expect(
      campLead.getByText(/is now your wrangler/i).first(),
    ).toBeVisible();
    // The notification links to /camps/<slug>, so that page has to name them —
    // a notification pointing at a screen that has never heard of the person is
    // how a camp decides the app is lying to them.
    await campLead.goto(`/camps/${camp.slug}`);
    await expect(
      campLead.getByText(new RegExp(`${wranglerName}.*is your wrangler`, "i")),
    ).toBeVisible();

    // --- THE WRANGLER HEARS, IN THE CONSOLE -------------------------------
    await wrangler.org.goto("/notifications");
    await expect(
      wrangler.org.getByText(new RegExp(`wrangling ${camp.name}`, "i")),
    ).toBeVisible();

    // --- NOBODY ELSE ------------------------------------------------------
    // The other camp's lead: not a word, on the inbox or under its filter.
    for (const url of ["/notifications", "/notifications?filter=bulletins"]) {
      await otherLead.goto(url);
      await expect(otherLead.getByText(/is now your wrangler/i)).toHaveCount(0);
      await expect(otherLead.getByText(camp.name)).toHaveCount(0);
    }
    // …and their own camp still shows no wrangler.
    await otherLead.goto(`/camps/${otherCamp.slug}`);
    await expect(otherLead.getByText(/is your wrangler/i)).toHaveCount(0);

    // The org member who was not assigned.
    await bystanderStaff.org.goto("/notifications");
    await expect(
      bystanderStaff.org.getByText(new RegExp(`wrangling ${camp.name}`, "i")),
    ).toHaveCount(0);

    // --- THE BOARD --------------------------------------------------------
    await staff.org.goto("/wranglers");
    await expect(
      staff.org.getByRole("heading", { name: /wrangler board/i }),
    ).toBeVisible();
    // The assigned camp names its wrangler…
    await expect(
      staff.org.getByRole("combobox", {
        name: new RegExp(`Wrangler for ${camp.name}$`),
      }),
    ).toContainText(wranglerName);
    // …and the other approved camp is NOT on the board, because it was never
    // approved — a board listing camps nobody may be assigned to is a to-do
    // list of things you cannot do.
    await expect(staff.org.getByText(otherCamp.name)).toHaveCount(0);

    // --- REASSIGNMENT REPLACES, IT DOES NOT ADD ---------------------------
    // The unique index on (group, edition) is what makes a camp have ONE
    // guardian angel; a second row would make "who is my wrangler?"
    // unanswerable.
    await openRegistrationInConsole(staff.org, camp.name);
    await staff.org.getByRole("combobox", { name: "Assign wrangler" }).click();
    await staff.org.getByRole("option", { name: reviewerName }).click();
    await expect(staff.org.getByText(/wrangler assigned/i)).toBeVisible();

    await campLead.goto(`/camps/${camp.slug}`);
    await expect(
      campLead.getByText(new RegExp(`${reviewerName}.*is your wrangler`, "i")),
    ).toBeVisible();
    await expect(
      campLead.getByText(new RegExp(`${wranglerName}.*is your wrangler`, "i")),
    ).toHaveCount(0);
  });
});
