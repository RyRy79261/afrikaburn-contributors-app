// specs/org-staff/medical-notes-access.spec.ts
//
// Persona: ORG STAFF — the most sensitive screen in the product, opened.
//
// `/registrations/[id]/members/[userId]` is the only console surface that
// renders a burner's medical notes. Everything about it is deliberate: the
// predicate runs BEFORE the fetch so a refused caller never loads the
// ciphertext, the read writes a `bio.medical.view` audit row, and that row is
// what answers a burner who asks "who saw my medical information?".
//
// Not one spec had ever opened it. The unit gate proves the predicate and the
// projection (org-rank-enforcement, medical-audit-surface), and engineer-rank
// proves the ENGINEER is refused the access log — but nothing walked the path
// that actually discloses the data, so nothing would have caught the page
// rendering notes it never audited, or auditing a read it never performed.
//
// Three claims, in the order a POPIA question would ask them:
//   1. A burner writes medical notes on their own bio, privately.
//   2. Org staff open that member from the registration and SEE them.
//   3. The read is on the record — by name, in the medical access log, with the
//      basis it was granted on.
//
// The camp itself is real: a lead creates it, invites the subject, and submits a
// registration, because the console reaches members THROUGH a registration.

import { test, expect, skipUnlessGod } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  inviteToCamp,
  joinByInvite,
  submitRegistration,
} from "../../personas/factories";
import { uniqueName, uniqueUsername } from "../../lib/identity";
import { openRegistrationInConsole } from "../camp-lead/support";
import { setHardLockedBioData } from "../camp-member/support";
import { provisionOrgStaff, desktopOnly } from "./_helpers";

test.describe("org staff · medical notes are disclosed, and the disclosure is recorded", () => {
  test.beforeEach(() => desktopOnly(test, test.info().project.name));

  test("opens a member's medical notes and the read lands in the access log", async ({
    makeAppPage,
  }) => {
    skipUnlessGod();
    test.setTimeout(240_000);

    const leadPage = await makeAppPage("web");
    const memberPage = await makeAppPage("web");

    await signUpBurner(leadPage, { onboard: true });
    const camp = await createCamp(leadPage, { description: "Shade and tea." });
    const invite = await inviteToCamp(leadPage, camp.slug, "member");

    // NAME THE USERNAME. The roster shows `publicMemberName(username)`, not the
    // account's sign-up name, and `signUpBurner` discards the one `completeBio`
    // generates — so an assertion on `account.name` would look for a string the
    // console never prints.
    const subject = uniqueUsername("medical");
    await signUpBurner(memberPage, { onboard: true, username: subject });
    await joinByInvite(memberPage, invite.url);

    // The subject discloses. `setHardLockedBioData` drives the real profile
    // editor — this is a burner writing their own notes, not a seeded row.
    const medicalNotes = uniqueName(
      "Peanut anaphylaxis, EpiPen in tent (medical-e2e)",
    );
    const onsiteContactName = uniqueName("Thandi Mokoena (medical-e2e)");
    await setHardLockedBioData(memberPage, { onsiteContactName, medicalNotes });

    // The console reaches members through a registration, so there must be one.
    await submitRegistration(leadPage, camp.slug);

    const staff = await provisionOrgStaff(makeAppPage);
    await openRegistrationInConsole(staff.org, camp.name);

    // Into the member. The roster prints every name unconditionally, so the
    // link — not the name — is what proves we opened the right person.
    await staff.org
      .getByRole("link", { name: new RegExp(subject, "i") })
      .first()
      .click();
    await staff.org.waitForURL(/\/members\/[0-9a-f-]{36}$/i);
    await expect(
      staff.org.getByRole("heading", { name: subject }),
    ).toBeVisible();

    // THE DISCLOSURE. Org staff hold personal information in `registrations`,
    // so the notes render — and the screen tells the reader the subject knew.
    await expect(
      staff.org.getByRole("heading", { name: /medical notes/i }),
    ).toBeVisible();
    await expect(staff.org.getByText(medicalNotes)).toBeVisible();
    await expect(
      staff.org.getByText(/knowing their camp leads and afrikaburn/i),
    ).toBeVisible();

    // THE RECORD. Scoped to the medical panel's own table — the audit page also
    // renders the GENERAL trail, and a bare page-wide name assertion would pass
    // on a row that has nothing to do with a medical read.
    // Named by the table's own <caption> (added 28 Jul 2026 — the page rendered
    // two tables and neither had an accessible name, so nothing could pick one).
    const medicalPanel = staff.org.getByRole("table", {
      name: /medical-notes reads/i,
    });

    // `bio.medical.view` is written in an `after()` callback, so it lands after
    // the response — poll rather than assume it is there by the time the next
    // navigation resolves.
    await expect(async () => {
      await staff.org.goto("/audit");
      await expect(
        staff.org.getByRole("heading", { name: /audit log/i }),
      ).toBeVisible();
      await expect(
        medicalPanel.getByRole("row", { name: new RegExp(subject, "i") }),
      ).toBeVisible();
    }).toPass({ timeout: 30_000 });

    // …and the panel names WHY it was allowed, not merely that it happened. A
    // log that records the read without the basis cannot answer the question it
    // exists for. "Org staff" is the basis `medicalAccessBasis` derives for this
    // actor; "Camp lead" here would mean the predicate took the wrong branch.
    await expect(
      medicalPanel
        .getByRole("row", { name: new RegExp(subject, "i") })
        .getByText("Org staff"),
    ).toBeVisible();

    // The notes themselves are NOT in the log. The audit row names the subject
    // and the basis; repeating the disclosure into a second table would make
    // every reader of the log a reader of everyone's conditions.
    await expect(staff.org.getByText(medicalNotes)).toHaveCount(0);
  });
});
