// specs/camp-member/camp-member-cross-camp-isolation.spec.ts
//
// Persona: CAMP MEMBER — cross-tenant boundaries. Being a member of camp A grants
// NOTHING on camp B: a member of A cannot read B's roster, B's registration, or
// B's questionnaires, and cannot reach a free camp they don't belong to. And no
// member can see a camp-mate's hard-locked private bio fields on any surface.
//
// Every refusal is the SERVER's (HTTP 404 / withheld projection), and each test
// pairs the refusal with a POSITIVE control (the member CAN reach their own camp)
// so the guard is proven discriminating, not blanket-deny. Counterparts are real
// (factory-built), never mocked.
//
// Registry ids proven here (personas/registry.ts): read-other-camp-registration,
// discover-free-camp, open-free-camp-page, see-hard-locked-field-public.

import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
  submitRegistration,
} from "../../personas/factories";
import { uniqueName, uniqueUsername } from "../../lib/identity";
import {
  authorCampQuestionnaire,
  setHardLockedBioData,
  expectServerNotFound,
} from "./support";

test.describe("camp member — cross-camp isolation", () => {
  test("a member of camp A cannot read camp B's dashboard, registration, or questionnaires", async ({
    makeAppPage,
  }) => {
    // Two camps + a submitted registration + a questionnaire in B make the
    // refusals non-vacuous: there is REAL B data behind each guard.
    test.setTimeout(180_000);

    const leadAPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web"); // the persona: member of A
    const leadBPage = await makeAppPage("web"); // the "other camp lead"

    // Camp A — the persona's own camp.
    await signUpBurner(leadAPage, { onboard: true });
    const campA = await createCamp(leadAPage, {
      name: uniqueName("Dust Bunnies A"),
    });
    const inviteA = await inviteToCamp(leadAPage, campA.slug, "member");
    await signUpBurner(memberPage, { onboard: true });
    await joinByInvite(memberPage, inviteA.url);

    // Camp B — a different tenant, with data worth protecting.
    await signUpBurner(leadBPage, { onboard: true });
    const campB = await createCamp(leadBPage, {
      name: uniqueName("Long Drop Inn B"),
    });
    await submitRegistration(leadBPage, campB.slug);
    const qB = await authorCampQuestionnaire(leadBPage, campB.slug, {
      title: uniqueName("B-only shift plan"),
      prompt: uniqueName("B-only prompt (camp-member-e2e)"),
      blocking: false,
    });

    // Positive control: the member CAN reach their own camp A.
    await memberPage.goto(`/camps/${campA.slug}`);
    await expect(
      memberPage.getByRole("heading", { name: campA.name }),
    ).toBeVisible();

    // B's dashboard/roster: B is a free (unregistered-for-approval) camp and the
    // member isn't in it → notFound. Guard: camps/[slug]/page.tsx
    // `!camp.registered && !camp.viewerRole → notFound()`. This is also the
    // "cannot reach a free camp you're not a member of" law.
    await expectServerNotFound(memberPage, `/camps/${campB.slug}`, [
      campB.name,
    ]);

    // B's registration: the member is refused before any registration data loads.
    // Guard: registration/page.tsx role check → redirect to B's dashboard →
    // which itself 404s the non-member.
    await expectServerNotFound(
      memberPage,
      `/camps/${campB.slug}/registration`,
      [campB.name],
    );

    // B's questionnaire management: getMemberPermissions(B, member) is null →
    // notFound. Guard: questionnaires/page.tsx `if (!canManage) notFound()`.
    await expectServerNotFound(
      memberPage,
      `/camps/${campB.slug}/questionnaires`,
      [campB.name],
    );

    // B's questionnaire FILL page: the member was never in B's audience, so no
    // required_actions row exists → getFillView returns null → notFound. Guard:
    // questionnaire-store.getFillView (targeting scope).
    await expectServerNotFound(
      memberPage,
      `/questionnaires/${qB.activationId}`,
    );
  });

  test("a stranger free camp is undiscoverable and unreachable to a member of another camp", async ({
    makeAppPage,
  }) => {
    // A tighter, faster restatement of the free-camp law, independent of the
    // registration-heavy test above.
    const ownerPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");

    // A free camp owned by someone else (invite-only, never registered).
    await signUpBurner(ownerPage, { onboard: true });
    const secret = await createCamp(ownerPage, {
      name: uniqueName("Vuurvlieg Collective"),
      joinability: "invite_only",
    });

    // The persona: an onboarded burner who is a member of their OWN camp.
    await signUpBurner(memberPage, { onboard: true });
    const own = await createCamp(memberPage);

    // Control: reaches their own camp.
    await memberPage.goto(`/camps/${own.slug}`);
    await expect(
      memberPage.getByRole("heading", { name: own.name }),
    ).toBeVisible();

    // Opening the stranger free camp directly by slug → 404 (not a redirect to a
    // teaser, not a members-list) even though signed in.
    await expectServerNotFound(memberPage, `/camps/${secret.slug}`, [
      secret.name,
    ]);
  });

  test("a member cannot see a camp-mate's hard-locked private bio fields on their profile", async ({
    makeAppPage,
  }) => {
    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");

    const leadName = uniqueUsername("lead_jabu");
    const onsiteContactName = uniqueName("EMERGENCYSENTINEL Contact");
    const medicalNotes = uniqueName("MEDICALSENTINEL peanut allergy");

    // The lead fills REAL hard-locked private data (emergency contact + medical).
    await signUpBurner(leadPage, { onboard: true, username: leadName });
    const camp = await createCamp(leadPage);
    await setHardLockedBioData(leadPage, { onsiteContactName, medicalNotes });
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    // A camp-mate joins and opens the lead's public burner profile from the roster.
    await signUpBurner(memberPage, { onboard: true });
    await joinByInvite(memberPage, invite.url);
    await memberPage.goto(`/camps/${camp.slug}`);
    await memberPage.getByRole("link", { name: leadName }).first().click();
    await expect(memberPage).toHaveURL(/\/burners\/[0-9a-f-]{36}/i);
    // The profile actually rendered (it's not a 404 masquerading as absence).
    await expect(memberPage.getByText(/we couldn['’]t find/i)).toHaveCount(0);

    // The hard-locked values are NEVER selected server-side (getPublicBurnerProfile
    // never reads phone/emergency/medical/ID columns), so they appear nowhere.
    await expect(memberPage.getByText(onsiteContactName)).toHaveCount(0);
    await expect(memberPage.getByText(medicalNotes)).toHaveCount(0);
  });
});
