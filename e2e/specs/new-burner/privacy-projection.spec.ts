// specs/new-burner/privacy-projection.spec.ts — the privacy boundary, end to end.
//
// The single most important new-burner invariant (AGENTS.md Product laws; core
// privacy.ts; roadmap M3-20): a third party sees a burner's PUBLIC fields, never
// their PRIVATE ones, and NEVER — under any flag — the hard-locked classes
// (phone, both emergency contacts, ID/passport).
//
// This drives it through the real app with two separate accounts: burner B fills
// a fully-populated bio (one field flipped private, all locked classes set to
// unique sentinels); burner A — a camp-mate, the app's only real path to a
// third party's profile — opens B's public profile and we assert what crossed
// the wire. The assertions read the SERVER-RENDERED HTML (`page.content()`), so
// they prove the field was never sent, not merely that CSS hid it: if the public
// projection (getPublicBurnerProfile + publicBioView) stopped stripping a class,
// its sentinel would appear in the HTML and the spec would go red.
//
// MEDICAL IS THE ONE DELIBERATE EXCEPTION (Ryan, 26 Jul 2026). It is never
// public, but it IS visible to the audience the burner disclosed it to — and here
// burner A is the LEAD of the camp B joined, so A is exactly that audience. The
// spec asserts A DOES see it (the consent-at-entry model working) while every
// hard-locked sentinel stays absent. A plain camp-mate who leads nothing is
// refused — proven in specs/anon/burner-profile-privacy.spec.ts and
// specs/camp-member/camp-member-cross-camp-isolation.spec.ts.
//
// SCOPE NOTE (honest boundary): "the server refuses if the flag is *forced*
// public" is a persistence-layer coercion (core enforcePrivacyFlags /
// privacyViolations, wired at apps/web/lib/bio-store.ts). The onboarding UI makes
// forcing a hard-locked flag impossible (the toggle is disabled/absent — proven
// in burner-bio.spec.ts), and forcing it anyway would require bypassing the app,
// which this harness forbids (no back doors). The observable end-to-end
// guarantee — the values never reach any public surface regardless of flags — is
// what this spec asserts; the coercion-on-write itself is covered by the core +
// M3-06 action-level tests.

import { test, expect } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
} from "../../personas/factories";
import { uniqueName } from "../../lib/identity";
import { fillDetailedBio, readBurnerIdFromRoster } from "./support";

test.describe("new burner · privacy projection", () => {
  test("public fields appear on a third-party profile; private and hard-locked never do", async ({
    webPage, // burner A — camp lead + third-party viewer
    makeAppPage,
  }) => {
    // --- Burner A: a camp with an invite, so A and B share a roster ---------
    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, {
      description: "A place to prove the privacy wire.",
    });
    const invite = await inviteToCamp(webPage, camp.slug, "member");

    // --- Burner B: the subject, with a fully-populated bio ------------------
    const bPage = await makeAppPage("web");
    await signUpBurner(bPage);

    const bName = uniqueName("Burner B");
    const publicAbout = uniqueName("about the dust");
    const sentinels = {
      city: uniqueName("SecretCity"),
      onsite: uniqueName("OnsiteContact"),
      offsite: uniqueName("OffsiteContact"),
      medical: uniqueName("MedicalNote"),
      id: uniqueName("PassportNo"),
      phone: "825559001", // stored E.164 (+27…); the digits must never surface
    };

    await fillDetailedBio(bPage, {
      displayName: bName, // default PUBLIC → the profile heading
      homeCity: sentinels.city,
      homeCityPublic: false, // flipped PRIVATE → must be absent
      attendedYears: [2019, 2022], // default PUBLIC → the years render
      about: publicAbout, // default PUBLIC → the About section renders
      phoneNational: sentinels.phone,
      onsiteName: sentinels.onsite,
      offsiteName: sentinels.offsite,
      medical: sentinels.medical,
      idNumber: sentinels.id,
    });

    // B joins A's camp (B is onboarded now, so the gate lets the join through).
    await joinByInvite(bPage, invite.url);

    // --- Burner A opens B's public profile via the real roster link --------
    await webPage.goto(`/camps/${camp.slug}`);
    const burnerId = await readBurnerIdFromRoster(webPage, bName);
    await webPage.goto(`/burners/${burnerId}`);

    // The profile loaded (public display name is the heading anchor).
    await expect(
      webPage.getByRole("heading", { name: bName }),
    ).toBeVisible();

    // PUBLIC fields are present.
    await expect(webPage.getByText(publicAbout)).toBeVisible();
    await expect(webPage.getByText("2019").first()).toBeVisible();

    // The PRIVATE-flipped field is gone from the rendered page.
    await expect(webPage.getByText(sentinels.city)).toHaveCount(0);

    // Server-side proof: the hard-locked sentinels are absent from the delivered
    // HTML — the server never selected/projected them — while the public control
    // IS present.
    const html = await webPage.content();
    expect(html).toContain(publicAbout); // control: the page really rendered
    const { medical, ...neverVisible } = sentinels;
    for (const [field, value] of Object.entries(neverVisible)) {
      expect(html, `hard-locked/private "${field}" leaked into public HTML`).not.toContain(
        value,
      );
    }

    // MEDICAL: A leads the camp B joined, so A is the audience B consented to at
    // the point of entry — the notes render on B's DETAIL view (and only there).
    expect(
      html,
      "a camp lead must see their own member's medical notes on the member detail view",
    ).toContain(medical);
  });
});
