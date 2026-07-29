// specs/camp-lead/layout-uploads.spec.ts
//
// Persona: CAMP LEAD — the file-attachment path, which nothing tested.
//
// `@quagga/ui`'s `FileUpload` is the ONE primitive behind every attachment in
// the product: registration layout sketches, artwork concept images, mutant
// vehicle photos, supplier documents, and file questions in the questionnaire
// engine. It had no e2e coverage at all, on any of them.
//
// ## Why this tests the URL path, and why that is the honest choice
//
// `FileUpload` has two halves: real Vercel Blob client uploads when the
// deployment has BLOB_READ_WRITE_TOKEN, and a URL-paste fallback with a stated
// reason when it does not. Neither CI nor scripts/e2e-local.sh sets that token —
// deliberately, because a token in CI means a suite that writes to a real blob
// store — so the fallback is what every e2e run can see, and pretending
// otherwise would mean a spec that skips itself and proves nothing.
//
// So this covers what is actually reachable, and covers it properly: the add,
// the two refusals, the cap, removal, that the value SURVIVES A RELOAD (it is
// autosaved through `onCommit`, not held in React state), and that the org
// console renders the same links back on the review screen. That last hop is
// the point of an attachment — a layout nobody can open is not a layout.
//
// HONEST SCOPE NOTE. The blob branch — the drop zone, the MIME and size
// pre-checks (`validate`), the upload progress state — is NOT exercised here
// and cannot be without a token. Its logic is pure and belongs in a unit test
// against `FileUpload`; what is asserted below is everything else.

import { test, expect, skipUnlessGod } from "../../fixtures";
import {
  signUpBurner,
  createCamp,
  submitRegistration,
  elevateToGod,
} from "../../personas/factories";
import { uniqueName } from "../../lib/identity";
import { openRegistrationInConsole } from "./support";

/** `MAX_LAYOUT_UPLOADS` in @quagga/types — named here so a change fails loudly. */
const MAX_LAYOUT_UPLOADS = 4;

test.describe("camp lead — layout attachments on the registration", () => {
  test("adds, dedupes, caps and removes layout links, and they survive a reload", async ({
    webPage,
  }) => {
    test.setTimeout(180_000);

    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Shade and chai." });
    await webPage.goto(`/camps/${camp.slug}/registration`);

    // Section 4 owns the layout uploads (SECTION_LABELS.size_logistics).
    await webPage
      .getByRole("button", { name: /size & logistics/i })
      .first()
      .click();
    await expect(webPage.getByText(/layout sketches \/ plans/i)).toBeVisible();

    // The deployment has no blob token, and the screen SAYS so rather than
    // offering a drop zone that would fail.
    await expect(
      webPage.getByText(
        /file uploads aren['’]t configured on this deployment/i,
      ),
    ).toBeVisible();
    await expect(
      webPage.getByRole("button", { name: /upload a layout image/i }),
    ).toHaveCount(0);

    const url = webPage.getByLabel("Paste a URL");
    const add = webPage.getByRole("button", { name: "Add", exact: true });

    // REFUSAL 1: not a URL. `new URL()` is the check, and the toast is the
    // whole feedback — a silently ignored click would leave a lead pressing Add
    // and wondering.
    await url.fill("not a url");
    await add.click();
    await expect(
      webPage.getByText(/that doesn['’]t look like a valid url/i),
    ).toBeVisible();

    // The real thing. One link per press, rendered as a thumbnail with its own
    // remove control.
    const first = `https://example.org/layout-${uniqueName("a")}.png`;
    await url.fill(first);
    await add.click();
    await expect(
      webPage.getByRole("button", { name: "Remove upload 1" }),
    ).toBeVisible();

    // REFUSAL 2: the same link twice. Silently accepting it would put a
    // duplicate in `s4_layout_upload_urls` and show the reviewer the same
    // sketch twice.
    await url.fill(first);
    await add.click();
    await expect(
      webPage.getByText(/that link is already added/i),
    ).toBeVisible();
    await expect(
      webPage.getByRole("button", { name: /^Remove upload \d+$/ }),
    ).toHaveCount(1);

    // Fill to the cap. At MAX_LAYOUT_UPLOADS the ADD CONTROLS GO AWAY entirely
    // (`{!full && …}`) — the cap is not merely enforced on save.
    for (let i = 2; i <= MAX_LAYOUT_UPLOADS; i += 1) {
      await url.fill(`https://example.org/layout-${uniqueName(`n${i}`)}.png`);
      await add.click();
      await expect(
        webPage.getByRole("button", { name: `Remove upload ${i}` }),
      ).toBeVisible();
    }
    await expect(webPage.getByLabel("Paste a URL")).toHaveCount(0);
    await expect(
      webPage.getByRole("button", { name: "Add", exact: true }),
    ).toHaveCount(0);

    // Removing one brings the add controls back — the cap is a live count, not
    // a one-way latch.
    await webPage
      .getByRole("button", { name: `Remove upload ${MAX_LAYOUT_UPLOADS}` })
      .click();
    await expect(webPage.getByLabel("Paste a URL")).toBeVisible();
    await expect(
      webPage.getByRole("button", { name: /^Remove upload \d+$/ }),
    ).toHaveCount(MAX_LAYOUT_UPLOADS - 1);

    // THE PART THAT MATTERS. `FileUpload` calls `onCommit` a macrotask after
    // `onChange` so the wizard's autosave reads the NEW value — if that ordering
    // ever regressed, every link would look right on screen and be absent from
    // the draft. A full reload is the only assertion that can tell those apart.
    //
    // WAIT FOR THE SAVE FIRST. `onCommit` starts an async flush; a reload fired
    // on the next line kills it in flight. Measured on the first run of this
    // spec: the removal was still on screen, the DB still held four URLs, and
    // the failure looked like a persistence bug in the product. The rail's own
    // "Saved just now" is the honest signal that the server has the edit —
    // which is exactly what it is there to tell a camp lead, too.
    await expect(webPage.getByText(/saved just now/i)).toBeVisible({
      timeout: 30_000,
    });
    await webPage.reload();
    await webPage
      .getByRole("button", { name: /size & logistics/i })
      .first()
      .click();
    await expect(
      webPage.getByRole("button", { name: /^Remove upload \d+$/ }),
    ).toHaveCount(MAX_LAYOUT_UPLOADS - 1);
  });

  test("the reviewer can open every layout the camp attached", async ({
    webPage,
    orgPage,
  }) => {
    skipUnlessGod();
    test.setTimeout(240_000);

    await signUpBurner(webPage, { onboard: true });
    const camp = await createCamp(webPage, { description: "Dust and tea." });

    // A filename unique to this run, so finding it in the console proves it came
    // from THIS camp's registration and not a seeded row.
    const layout = `https://example.org/${uniqueName("plan")}.png`;

    // Through the factory, because the links have to be part of the SUBMITTED
    // registration and the wizard is read-only afterwards — there is no adding
    // them once it is in the queue.
    await submitRegistration(webPage, camp.slug, { layoutUrls: [layout] });

    // The camp's own locked view lists it — behind the per-section disclosure
    // the summary renders ("View what you submitted"), so it has to be opened
    // first. Every section is opened rather than hunting for the right card:
    // there is exactly one "Layout 1" link in the document, so this cannot
    // match the wrong thing.
    for (const disclosure of await webPage
      .getByText("View what you submitted")
      .all()) {
      await disclosure.click();
    }
    await expect(
      webPage.getByRole("link", { name: /^Layout 1$/ }),
    ).toHaveAttribute("href", layout);

    // …and so does the reviewer's, which is the hop that makes an attachment
    // worth having. A URL that reaches the database but not the review screen is
    // a sketch nobody at AfrikaBurn can open.
    await elevateToGod(orgPage);
    await openRegistrationInConsole(orgPage, camp.name);
    await expect(
      orgPage.getByRole("link", { name: /^Layout 1$/ }),
    ).toHaveAttribute("href", layout);
  });
});
