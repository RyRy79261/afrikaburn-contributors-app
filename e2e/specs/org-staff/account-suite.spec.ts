// specs/org-staff/account-suite.spec.ts
//
// Persona: ORG STAFF — looking after their OWN account, in the console.
//
// Roadmap M4-21. Until now the account suite existed only on the participant
// app, which meant the accounts with the most power in this deployment — the
// ones that approve registrations, read medical notes and grant org roles — had
// no way to switch two-factor on where they work. Self-hosting Better Auth was
// done FOR 2FA, and two of the three account kinds could not reach it.
//
// ## The gate reversal is the thing worth testing
//
// Every other page in the console requires an org role, and the console layout
// additionally replaces itself with a blocking questionnaire when one is
// pending. The account suite deliberately does neither: the account outlives the
// role, and somebody stuck behind a questionnaire is exactly who might need to
// end a stolen session. `signed-in-but-refused-by-the-console can still reach
// /account` is therefore a REQUIREMENT, not an oversight — and it is the test a
// future "tidy up the route groups" change would break silently.
//
// That test needs no god, so it runs everywhere. The org-staff journey below it
// needs a real elevation and skips cleanly without E2E_GOD_EMAIL.

import { test, expect, skipUnlessGod } from "../../fixtures";
import { signInAs, signUpBurner } from "../../personas/factories";
import { TEST_PASSWORD } from "../../lib/identity";
import { provisionOrgStaff, desktopOnly } from "./_helpers";

const ROTATED = "console-rotation-passphrase-for-e2e";

test.describe("org staff · the account suite", () => {
  test.beforeEach(() => desktopOnly(test, test.info().project.name));

  test("an account the console refuses can still manage its own security", async ({
    makeAppPage,
  }) => {
    // A real burner who has never been given any org role. The console is
    // closed to them, and that is correct.
    const web = await makeAppPage("web");
    const account = await signUpBurner(web);

    const org = await makeAppPage("org");
    await signInAs(org, account, "org");
    await expect(
      org.getByText(/this side is for afrikaburn staff/i),
    ).toBeVisible();

    // …and the account suite is open to them anyway. If this ever redirects to
    // the gate, somebody has moved these routes back under `(console)` and
    // quietly taken away the only way an ex-organiser can sign out a lost
    // laptop.
    await org.goto("/account");
    await expect(org.getByRole("heading", { name: "Account" })).toBeVisible();
    await expect(
      org.getByText(/this side is for afrikaburn staff/i),
    ).toHaveCount(0);
    // The page says so out loud rather than leaving a blank where a rank would be.
    await expect(
      org.getByText(/no console access on this account/i),
    ).toBeVisible();

    // Security is reachable too, with the real controls on it.
    await org.goto("/account/security");
    await expect(
      org.getByRole("heading", { name: /two-factor authentication/i }),
    ).toBeVisible();
    await expect(
      org.getByRole("heading", { name: /active sessions/i }),
    ).toBeVisible();
    await expect(org.getByText(/this device/i)).toBeVisible();
  });

  test("org staff can rotate their password and see it in their own security log", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    test.slow();

    const staff = await provisionOrgStaff(makeAppPage);

    // Reachable from the console chrome — a suite nobody can find is a suite
    // nobody uses, and this is the only door to 2FA for an organiser.
    await staff.org.goto("/registrations");
    await staff.org.getByRole("link", { name: /your account/i }).click();
    await expect(
      staff.org.getByRole("heading", { name: "Account" }),
    ).toBeVisible();

    // The page names the door this account came in by.
    await expect(staff.org.getByText(/org staff/i).first()).toBeVisible();

    // Another signed-in session, so "sign out my other devices" has something
    // to do and its effect is observable.
    //
    // Counted, not assumed. Provisioning this persona already leaves TWO live
    // sessions — the participant sign-up and the console sign-in — and the
    // account suite lists every session on the ACCOUNT, not on this app, which
    // is the whole point of one account behind three doors. Asserting a literal
    // "1" here would be asserting that the list is app-scoped.
    const secondDevice = await makeAppPage("org");
    await signInAs(secondDevice, staff.account, "org");
    await staff.org.goto("/account/security");
    const revokable = staff.org.getByRole("button", { name: /^revoke$/i });
    expect(await revokable.count()).toBeGreaterThan(0);

    // Rotate it, with the default "sign out my other devices" left ON.
    await staff.org.goto("/account");
    await staff.org
      .getByRole("button", { name: "Change", exact: true })
      .click();
    await staff.org
      .getByLabel("Current password", { exact: true })
      .fill(TEST_PASSWORD);
    await staff.org.getByLabel(/new password/i).fill(ROTATED);
    await expect(
      staff.org.getByRole("switch", { name: /sign out my other devices/i }),
    ).toBeChecked();
    await staff.org
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(staff.org.getByText(/password changed/i)).toBeVisible();

    // Server-side proof #1: the other sessions are gone, and the page can still
    // see which row is this device. The second half is the regression guard for
    // the dropped session cookie — see the participant app's account-management
    // spec, where the same defect lived and was measured.
    await staff.org.goto("/account/security");
    await expect(
      staff.org.getByRole("button", { name: /^revoke$/i }),
    ).toHaveCount(0);
    await expect(staff.org.getByText(/this device/i)).toBeVisible();

    // Server-side proof #2: the security LOG recorded it. This is what makes
    // the feed a record rather than decoration — and the row is written by the
    // console's own action, against the same `security_events` table the
    // participant app writes to.
    await expect(
      staff.org.getByText(/password changed/i).first(),
    ).toBeVisible();

    // Server-side proof #3: the credential genuinely rotated. A cold context
    // refuses the old password and accepts the new one.
    const fresh = await makeAppPage("org");
    await signInAs(
      fresh,
      { email: staff.account.email, password: ROTATED },
      "org",
    );
    await fresh.goto("/account");
    await expect(fresh.getByRole("heading", { name: "Account" })).toBeVisible();
  });

  test("the Delete tab explains itself and hands over — it never deletes here", async ({
    makeAppPage,
  }) => {
    const web = await makeAppPage("web");
    const account = await signUpBurner(web);
    const org = await makeAppPage("org");
    await signInAs(org, account, "org");

    await org.goto("/account/delete");
    await expect(
      org.getByRole("heading", { name: /delete your account/i }).first(),
    ).toBeVisible();

    // It hands over rather than acting. There is no destructive control on this
    // page at all — the whole point is that deletion has ONE implementation,
    // with the eligibility checks and the grace period, and it is not here.
    await expect(
      org.getByRole("button", { name: /delete my account/i }),
    ).toHaveCount(0);
    const handover = org.getByRole("link", {
      name: /delete on the participant app/i,
    });
    await expect(handover).toBeVisible();
    await expect(handover).toHaveAttribute("href", /\/account\/delete$/);

    // And it says what the ORG loses, which is the part the participant app's
    // generic copy cannot know.
    await expect(org.getByText(/what deleting it means here/i)).toBeVisible();
  });
});
