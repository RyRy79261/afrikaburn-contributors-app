// tests/negative-paths.spec.ts — adversarial authz, driven by the ONE registry
// (personas/registry.ts). Each assertion proves the server-side guard REFUSES,
// never that a link is hidden (AGENTS.md rule 7). Per the mandatory adversarial
// pass (roadmap M3-30), each of these must be re-proven by DELETING the matching
// server guard and watching the spec go red — a negative-path test that still
// passes with the guard gone is the exact failure it exists to prevent.
//
// ## What this file stopped claiming, and when
//
// Until 28 Jul 2026 it carried five `test.fixme` stubs declaring the data-heavy
// guards "the M3-30 owner's to complete" — free-camp discovery, cross-camp
// registration reads, org-internal supplier notes, hard-locked PII on public
// surfaces, and god-only surfaces reached by org staff. Every one of them had
// been implemented and covered for weeks:
//
//   discover-free-camp / open-free-camp-page
//        specs/anon/free-camp-undiscoverable.spec.ts
//        specs/camp-member/camp-member-cross-camp-isolation.spec.ts
//   read-other-camp-registration
//        specs/camp-member/camp-member-cross-camp-isolation.spec.ts
//   see-org-supplier-notes
//        specs/supplier/isolation.spec.ts
//   see-hard-locked-field-public
//        specs/anon/burner-profile-privacy.spec.ts
//        specs/camp-member/camp-member-cross-camp-isolation.spec.ts
//   reach-god-only-surface
//        specs/org-staff/system-panel.spec.ts
//        specs/org-staff/cannot-elevate-accounts.spec.ts
//        specs/org-staff/camp-categories-crud.spec.ts
//
// A skipped test that says "nobody has done this yet" about work that IS done is
// worse than no test: it is a standing invitation to redo it, and it makes the
// suite's own summary line ("5 skipped") a lie about coverage. So the stubs are
// gone and the last test below replaces them with the thing they were pretending
// to be — a live gate that fails when a registry capability has NO spec claiming
// it, which is the only version of "not yet implemented" that can ever be true.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures";
import { signUpBurner, signInAs } from "../personas/factories";
import { forbiddenMatrix } from "../personas/registry";

test.describe("authz negative paths", () => {
  test("anonymous is refused the org console [reach-org-console]", async ({
    orgPage,
  }) => {
    // A protected console route, unauthenticated → the full gate replaces the
    // console. "Restricted to AfrikaBurn staff" + a Sign-in CTA IS the refusal.
    await orgPage.goto("/registrations");
    await expect(
      orgPage.getByText(/restricted to afrikaburn staff/i),
    ).toBeVisible();
    await expect(
      orgPage.getByRole("link", { name: /^sign in$/i }),
    ).toBeVisible();
    // And the console chrome/data is absent (not merely hidden behind a link).
    await expect(
      orgPage.getByRole("heading", { name: /registration/i }),
    ).toHaveCount(0);
  });

  test("a non-org burner is refused the org console [reach-org-console]", async ({
    webPage,
    orgPage,
  }) => {
    const account = await signUpBurner(webPage, { onboard: true });
    await signInAs(orgPage, account, "org");
    await orgPage.goto("/registrations");
    // Signed in, but no org role → the polite wall. This proves the guard rejects
    // an AUTHENTICATED principal, the case a hidden-nav approach would miss.
    await expect(
      orgPage.getByText(/this side is for afrikaburn staff/i),
    ).toBeVisible();
    await expect(
      orgPage.getByRole("heading", { name: /registration pipeline/i }),
    ).toHaveCount(0);
  });

  test("every forbidden capability in the registry is claimed by a spec", () => {
    // THE REGISTRY IS ONLY WORTH KEEPING IF IT IS ANSWERED. Adding a persona's
    // forbidden capability is cheap; writing the spec that proves the refusal is
    // not, and nothing used to notice the gap. This does: a capability id that
    // appears in no spec file fails here, by name, with nowhere to hide.
    //
    // The convention it enforces is the one the suite already follows — a spec
    // cites the registry id it proves, in its header comment or its test title
    // (`[reach-org-console]`). Cheap to satisfy, and it makes "which spec proves
    // this?" answerable with grep instead of archaeology.
    //
    // NOT a proof that the refusal works — that is each spec's job, re-proven by
    // deleting the guard. This is a proof that a claim EXISTS, which is the
    // failure mode five `fixme`s hid for weeks.
    const specsRoot = fileURLToPath(new URL("../specs", import.meta.url));
    const testsRoot = fileURLToPath(new URL(".", import.meta.url));

    function collect(dir: string): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...collect(full));
        else if (entry.endsWith(".ts")) out.push(full);
      }
      return out;
    }

    const corpus = [...collect(specsRoot), ...collect(testsRoot)]
      // This file names every id in the map above, so counting it would make the
      // gate self-satisfying — exactly the tautology the `fixme`s were.
      .filter((f) => !f.endsWith("negative-paths.spec.ts"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");

    const unclaimed = [
      ...new Set(
        forbiddenMatrix()
          .map((row) => row.capability.id)
          .filter((id) => !corpus.includes(id)),
      ),
    ].sort();

    expect(
      unclaimed,
      `No spec cites these forbidden capabilities. Name the id in the owning spec's header or test title, or drop it from personas/registry.ts:\n  ${unclaimed.join("\n  ")}`,
    ).toEqual([]);
  });
});
