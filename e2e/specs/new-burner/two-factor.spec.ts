// specs/new-burner/two-factor.spec.ts
//
// Persona: NEW BURNER — the second factor, enrolled for real.
//
// Two-factor, passkeys and backup codes were the headline reason for pulling
// self-hosted Better Auth forward (task #58: managed Neon Auth could not do
// them). They shipped, and nothing tested any of it. The whole flow — password
// confirm → TOTP secret → verify → backup codes shown ONCE → disable — existed
// only as a card nobody had ever driven.
//
// THE CODE IS REAL. `@better-auth/utils/otp` derives the same TOTP the server
// verifies, from the setup key the page itself prints — so this is a genuine
// enrolment, not a stub. That matters: a card that renders a QR and accepts
// anything would pass every assertion an "is the UI there?" test could make,
// and would be worse than no second factor because the account would believe it
// had one.
//
// What is asserted, in the order it breaks trust if wrong:
//   1. A WRONG code is refused. (If this ever passes, stop reading and fix it.)
//   2. The right code enrols, and the backup codes appear — once.
//   3. The card reports `On` on a FRESH server render, so the state is durable
//      rather than a client-side flag.
//   4. Turning it off asks for the password and lands back at `Off`.
//
// Passkeys are deliberately NOT here: WebAuthn needs a virtual authenticator
// over CDP, which is a different harness. That gap is named in the registry
// rather than faked with a card-renders assertion.

import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { test, expect } from "../../fixtures";
import { signUpBurner } from "../../personas/factories";
import { TEST_PASSWORD } from "../../lib/identity";

test.describe("new burner — two-factor enrolment", () => {
  test("enrols with a real TOTP, refuses a wrong one, shows backup codes, and turns off", async ({
    webPage,
  }) => {
    test.setTimeout(180_000);
    await signUpBurner(webPage, { onboard: true });

    await webPage.goto("/account/security");
    await expect(
      webPage.getByRole("button", { name: /turn on two-factor/i }),
    ).toBeVisible();
    await webPage.getByRole("button", { name: /turn on two-factor/i }).click();

    // The password gate before a second factor is added.
    await webPage.getByLabel(/confirm your password/i).fill(TEST_PASSWORD);
    await webPage.getByRole("button", { name: /^continue$/i }).click();

    // The setup key, printed for anyone who cannot scan the QR. Two things have
    // to be undone before it is the string the server signs with:
    //   · the card groups it in fours for readability (`groupSecret`);
    //   · it is BASE32 of the secret, which is what an authenticator app wants —
    //     while `createOTP` (the same helper Better Auth's server uses) takes
    //     the decoded secret. Feeding it the base32 produces a valid-looking
    //     six digits that the server rejects, which is exactly what happened on
    //     the first run of this spec.
    const shownKey = await webPage.locator("code").first().innerText();
    const secret = new TextDecoder().decode(
      base32.decode(shownKey.replace(/\s+/g, "")),
    );
    expect(secret.length).toBeGreaterThan(15);

    // 1. A WRONG CODE IS REFUSED.
    const wrong =
      (await createOTP(secret).totp()) === "000000" ? "111111" : "000000";
    await webPage.getByLabel(/enter the 6-digit code/i).fill(wrong);
    await webPage.getByRole("button", { name: /verify and turn on/i }).click();
    await expect(webPage.getByRole("alert")).toBeVisible();
    // Still enrolling — a refused code must not half-enable anything.
    await expect(
      webPage.getByRole("button", { name: /verify and turn on/i }),
    ).toBeVisible();

    // 2. THE RIGHT CODE ENROLS. Derived at click time so a slow refusal above
    // cannot push us past the 30-second window.
    await webPage
      .getByLabel(/enter the 6-digit code/i)
      .fill(await createOTP(secret).totp());
    await webPage.getByRole("button", { name: /verify and turn on/i }).click();

    await expect(
      webPage.getByText(/save your backup codes now/i),
    ).toBeVisible();
    const codes = await webPage
      .getByRole("listitem")
      .filter({ hasText: /^[a-z0-9-]{6,}$/i })
      .allInnerTexts();
    expect(codes.length).toBeGreaterThan(0);
    await webPage
      .getByRole("button", { name: /i've saved them|i’ve saved them/i })
      .click();

    // 3. DURABLE. A fresh server render is what a returning session sees; a
    // client-only flag would pass everything above and be gone on reload.
    await webPage.goto("/account/security");
    // The card's own sentence and its controls — not the On/Off badge, which is
    // decoration and whose bare "Off" collides with other copy on the page.
    await expect(webPage.getByText(/two-factor is on/i)).toBeVisible();
    await expect(
      webPage.getByRole("button", { name: /^turn off$/i }),
    ).toBeVisible();
    // …and the codes are NOT shown again. The card promises exactly that.
    await expect(webPage.getByText(/save your backup codes now/i)).toHaveCount(
      0,
    );

    // 4. OFF AGAIN, behind the password.
    //
    // A second factor you cannot remove is its own defect — the account is one
    // lost phone away from being unreachable — so this half matters as much as
    // enrolling. The card's `disable` handler surfaces any server refusal in a
    // role="alert", and that text is named in the failure rather than left as a
    // mystery "still on".
    await webPage.getByRole("button", { name: /^turn off$/i }).click();
    await webPage.getByLabel(/confirm your password/i).fill(TEST_PASSWORD);
    await webPage
      .getByRole("button", { name: /^turn off two-factor$/i })
      .click();
    await expect(
      webPage.getByRole("button", { name: /turn on two-factor/i }),
    ).toBeVisible({ timeout: 20_000 });
    // Filtered to alerts with TEXT: the card renders `role="alert"` paragraphs
    // unconditionally and leaves them empty when there is nothing to say, so a
    // bare `getByRole("alert")` count is always non-zero and proves nothing.
    expect(
      (await webPage.getByRole("alert").allInnerTexts()).filter((t) =>
        t.trim(),
      ),
      "the disable step reported an error",
    ).toEqual([]);

    await webPage.goto("/account/security");
    await expect(webPage.getByText(/two-factor is on/i)).toHaveCount(0);
    await expect(
      webPage.getByRole("button", { name: /turn on two-factor/i }),
    ).toBeVisible();
  });
});
