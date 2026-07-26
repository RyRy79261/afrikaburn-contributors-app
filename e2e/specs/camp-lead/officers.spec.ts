// specs/camp-lead/officers.spec.ts
//
// Persona: CAMP LEAD — naming officers. Officers are the ONE sanctioned path
// that shares a member's contact details with AfrikaBurn, so assignment is a
// CONSENT REQUEST, not a fait accompli:
//   • Assigning an officer creates a PENDING request; the member is asked to
//     accept, and nothing is shared until they do.
//   • The member's phone becomes visible to the org ONLY after acceptance — the
//     single sanctioned phone-sharing path (POPIA consent). Before acceptance,
//     the org's registration view has no trace of it. (Needs a god session to
//     read the org console — skips cleanly without E2E_GOD_EMAIL.)
//
// The counterpart org reviewer is created through the harness's elevateToGod
// factory, never mocked (task rule).

import { test, expect, skipUnlessGod } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
  submitRegistration,
  elevateToGod,
} from "../../personas/factories";
import { uniqueName } from "../../lib/identity";
import {
  acceptOfficerRequest,
  assignOfficer,
  completeBioWithPhone,
  openRegistrationInConsole,
} from "./support";

test.describe("camp lead — officers are consent requests", () => {
  test("assigning an officer is a PENDING request the member must accept", async ({
    makeAppPage,
  }) => {
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const memberName = uniqueName("Officer Ren");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage);
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    await signUpBurner(memberPage, { onboard: true, displayName: memberName });
    await joinByInvite(memberPage, invite.url);

    // Lead names the member as Safety Officer. `assignOfficer` asserts the row
    // lands in the awaiting-acceptance (pending) state — not active.
    await assignOfficer(leadPage, camp.slug, "Safety Officer", memberName);

    // The member is ASKED (the consent moment) — the request surfaces to them,
    // and it is still pending until they act.
    await memberPage.goto(`/camps/${camp.slug}`);
    await expect(
      memberPage.getByRole("heading", { name: /asked to be a camp officer/i }),
    ).toBeVisible();

    // Accepting completes the registration; the lead's view flips to accepted.
    await acceptOfficerRequest(memberPage, camp.slug);
    await leadPage.goto(`/camps/${camp.slug}/settings/roles`);
    await leadPage
      .getByRole("button", { name: /safety officer/i })
      .filter({ visible: true })
      .first()
      .click();
    await expect(
      leadPage.getByText(/shared with afrikaburn/i).first(),
    ).toBeVisible();
  });

  test("the officer's phone reaches the org ONLY after acceptance", async ({
    makeAppPage,
    orgPage,
  }) => {
    skipUnlessGod();

    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");
    const memberName = uniqueName("Safety Sam");
    // A distinctive number so its last four digits are an unambiguous probe.
    const phone = "+27825550147";
    const phoneProbe = /0147/;

    // A camp with a submitted registration, so it appears in the org queue and
    // its officers section is reviewable.
    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage, { description: "Chai at dawn." });
    const invite = await inviteToCamp(leadPage, camp.slug, "member");
    await submitRegistration(leadPage, camp.slug);

    // The member onboards WITH a phone (hard-locked private for everyone else).
    await signUpBurner(memberPage, { onboard: true });
    await completeBioWithPhone(memberPage, { displayName: memberName, phone });
    await joinByInvite(memberPage, invite.url);

    // Assigned but NOT yet accepted → pending.
    await assignOfficer(leadPage, camp.slug, "Safety Officer", memberName);

    // Org opens the registration. Pre-consent: the officer's phone is nowhere on
    // the reviewer's page — the consent gate withholds it server-side (the query
    // filters to accepted + org-visible), not merely hides a field.
    await elevateToGod(orgPage);
    await openRegistrationInConsole(orgPage, camp.name);
    await expect(orgPage.getByText(phoneProbe)).toHaveCount(0);

    // The member accepts — the single sanctioned phone-sharing consent.
    await acceptOfficerRequest(memberPage, camp.slug);

    // Post-consent: the same reviewer page now shows the officer with their phone.
    await orgPage.reload();
    await expect(orgPage.getByText(memberName).first()).toBeVisible();
    await expect(orgPage.getByText(phoneProbe).first()).toBeVisible();
  });
});
