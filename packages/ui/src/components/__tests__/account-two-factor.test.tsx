import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { AccountTwoFactor } from "../account-two-factor";
import type { AccountAuthClient } from "../account-auth-client";

// Two-factor enrolment, for all three apps. The load-bearing property of this
// screen is that it never LIES about what happened: the backup codes are shown
// exactly once and can never be shown again, so a reassuring "Copied ✓" over a
// clipboard write that never happened is a lockout the user manufactures
// themselves by trusting it. The file's own comment records that defect
// shipping once; the regression case below is what stops it coming back.
//
// jsdom has no `navigator.clipboard` at all, so the FAILURE path is the default
// here and needs no stub — the success path is the one that needs help.

const TOTP_URI =
  "otpauth://totp/AfrikaBurn:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=AfrikaBurn";
const CODES = ["11111111", "22222222", "33333333"];

/** A stub Better Auth client whose every method is a spy the test can steer. */
function makeClient(over: {
  enable?: unknown;
  verifyTotp?: unknown;
  disable?: unknown;
  generateBackupCodes?: unknown;
} = {}) {
  const enable = vi.fn().mockResolvedValue(
    over.enable ?? { data: { totpURI: TOTP_URI, backupCodes: CODES }, error: null },
  );
  const verifyTotp = vi
    .fn()
    .mockResolvedValue(over.verifyTotp ?? { data: {}, error: null });
  const disable = vi
    .fn()
    .mockResolvedValue(over.disable ?? { data: {}, error: null });
  const generateBackupCodes = vi.fn().mockResolvedValue(
    over.generateBackupCodes ?? {
      data: { backupCodes: ["99999999", "88888888"] },
      error: null,
    },
  );
  const client = {
    twoFactor: {
      enable,
      verifyTotp,
      verifyBackupCode: vi.fn(),
      disable,
      generateBackupCodes,
    },
    passkey: { addPasskey: vi.fn(), deletePasskey: vi.fn() },
  } satisfies AccountAuthClient;
  return { client, enable, verifyTotp, disable, generateBackupCodes };
}

/** Walk a fresh card all the way to the backup-code panel. */
async function enrolToBackupCodes(onChanged?: () => void) {
  const stubs = makeClient();
  render(
    <AccountTwoFactor
      client={stubs.client}
      enabled={false}
      requiresPassword={false}
      onChanged={onChanged}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Turn on two-factor" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByLabelText("Enter the 6-digit code");
  fireEvent.change(screen.getByLabelText("Enter the 6-digit code"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify and turn on" }));
  await screen.findByText("Save your backup codes now");
  return stubs;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // The clipboard stub is installed with defineProperty, so undo it by hand.
  if ("clipboard" in navigator) {
    // @ts-expect-error — deleting an own property the test installed.
    delete navigator.clipboard;
  }
});

describe("the setup key", () => {
  it("renders the secret in 4-char blocks so it can be typed without errors", async () => {
    const { client } = makeClient();
    render(
      <AccountTwoFactor
        client={client}
        enabled={false}
        requiresPassword={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn on two-factor" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // JBSWY3DPEHPK3PXP, grouped. Someone hand-typing this into an authenticator
    // on a phone is the whole reason the blocks exist.
    expect(await screen.findByText("JBSW Y3DP EHPK 3PXP")).toBeDefined();
  });

  it("shows no setup key rather than throwing when the URI is malformed", async () => {
    const { client } = makeClient({
      enable: { data: { totpURI: "not-a-uri", backupCodes: CODES }, error: null },
    });
    render(
      <AccountTwoFactor
        client={client}
        enabled={false}
        requiresPassword={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn on two-factor" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // The QR still renders from whatever the server sent; only the manual key
    // is withheld. A thrown URL parse here would blank the whole panel.
    await screen.findByText("Scan this with your app");
    expect(screen.queryByText(/JBSW/)).toBeNull();
  });
});

describe("beginEnrol", () => {
  it("posts the typed password and names the likely cause when it is refused", async () => {
    const { client, enable } = makeClient({
      enable: { data: null, error: {} },
    });
    render(
      <AccountTwoFactor client={client} enabled={false} requiresPassword />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn on two-factor" }));
    fireEvent.change(screen.getByLabelText("Confirm your password"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(enable).toHaveBeenCalledWith({ password: "hunter2" }),
    );
    // The specific message, not the generic one: an account that needs a
    // password has exactly one plausible reason to be refused here.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("That password didn't match. Try again.");
  });

  it("asks for no password on a passwordless account and sends undefined", async () => {
    const { client, enable } = makeClient();
    render(
      <AccountTwoFactor
        client={client}
        enabled={false}
        requiresPassword={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn on two-factor" }));

    // A Google-only / passkey-only account has no password to confirm; asking
    // for one would be a field nobody can fill.
    expect(screen.queryByLabelText("Confirm your password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(enable).toHaveBeenCalledWith({ password: undefined }),
    );
  });

  it("falls back to the generic message when no password was in play", async () => {
    const { client } = makeClient({ enable: { data: null, error: null } });
    render(
      <AccountTwoFactor
        client={client}
        enabled={false}
        requiresPassword={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn on two-factor" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Something went wrong. Try again.");
  });
});

describe("the 6-digit code", () => {
  it("strips non-digits and hard-caps at six", async () => {
    const { client } = makeClient();
    render(
      <AccountTwoFactor
        client={client}
        enabled={false}
        requiresPassword={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn on two-factor" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const input = (await screen.findByLabelText(
      "Enter the 6-digit code",
    )) as HTMLInputElement;

    // A pasted "123 456" or an autofilled string must not become an 8-char code
    // the server will simply refuse.
    fireEvent.change(input, { target: { value: "abc123456789" } });
    expect(input.value).toBe("123456");
  });

  it("keeps Verify disabled until there are exactly six digits", async () => {
    const { client } = makeClient();
    render(
      <AccountTwoFactor
        client={client}
        enabled={false}
        requiresPassword={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn on two-factor" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const input = await screen.findByLabelText("Enter the 6-digit code");
    const verify = screen.getByRole("button", {
      name: "Verify and turn on",
    }) as HTMLButtonElement;

    expect(verify.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "12345" } });
    expect(verify.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "123456" } });
    expect(verify.disabled).toBe(false);
  });

  it("keeps a wrong code on the verify step and never reveals backup codes", async () => {
    const { client } = makeClient({
      verifyTotp: { data: null, error: { message: "" } },
    });
    const onChanged = vi.fn();
    render(
      <AccountTwoFactor
        client={client}
        enabled={false}
        requiresPassword={false}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn on two-factor" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(await screen.findByLabelText("Enter the 6-digit code"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify and turn on" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "That code didn't match. Check the app and try again.",
    );
    // The codes are a one-shot reveal — handing them over on a failed verify
    // would mean an unverified enrolment burned the only showing.
    expect(screen.queryByText("Save your backup codes now")).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("advances to the backup codes once and tells the host exactly once", async () => {
    const onChanged = vi.fn();
    const { verifyTotp } = await enrolToBackupCodes(onChanged);

    expect(verifyTotp).toHaveBeenCalledWith({ code: "123456" });
    for (const code of CODES) expect(screen.getByText(code)).toBeDefined();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe("copying the backup codes", () => {
  it("REGRESSION: says nothing was copied when the clipboard is unavailable", async () => {
    await enrolToBackupCodes();
    // jsdom exposes no navigator.clipboard, which is exactly the real-world
    // state outside a secure context.
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("nothing was copied");
    // The three things that make this a lockout if they go wrong: the button
    // must NOT claim success, the alert must be in this panel, and the codes
    // must still be readable so they can be copied by hand.
    expect(screen.queryByRole("button", { name: /Copied/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Copy/ })).toBeDefined();
    for (const code of CODES) expect(screen.getByText(code)).toBeDefined();
  });

  it("writes the codes newline-joined and confirms only then", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await enrolToBackupCodes();
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Copied/ })).toBeDefined(),
    );
    expect(writeText).toHaveBeenCalledWith(CODES.join("\n"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("treats a rejected write as a failure, not a success", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    await enrolToBackupCodes();
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));

    // A permissions-policy refusal rejects rather than throwing synchronously,
    // which is precisely what the old fire-and-forget version could not see.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("nothing was copied");
    expect(screen.queryByRole("button", { name: /Copied/ })).toBeNull();
  });
});

describe("downloading the backup codes", () => {
  it("builds a text file from the codes and releases the object URL", async () => {
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:codes");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    await enrolToBackupCodes();

    // jsdom logs "Not implemented: navigation" for the anchor click. That is
    // noise from a passing test, not a failure.
    fireEvent.click(screen.getByRole("button", { name: /Download/ }));

    expect(create).toHaveBeenCalledTimes(1);
    const blob = create.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toContain("11111111");
    // Leaking the URL keeps the blob alive for the life of the document.
    expect(revoke).toHaveBeenCalledWith("blob:codes");
  });
});

describe("managing an enabled account", () => {
  it("offers regenerate and turn-off, and nothing else", () => {
    const { client } = makeClient();
    render(<AccountTwoFactor client={client} enabled requiresPassword />);

    expect(
      screen.getByRole("button", { name: "Regenerate backup codes" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Turn on two-factor" }),
    ).toBeNull();
  });

  it("replaces the codes on regenerate and shows no QR for a reissue", async () => {
    const { client, generateBackupCodes } = makeClient();
    const onChanged = vi.fn();
    render(
      <AccountTwoFactor
        client={client}
        enabled
        requiresPassword
        onChanged={onChanged}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Regenerate backup codes" }),
    );
    fireEvent.change(screen.getByLabelText("Confirm your password"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate new codes" }));

    await screen.findByText("Save your backup codes now");
    expect(generateBackupCodes).toHaveBeenCalledWith({ password: "hunter2" });
    expect(screen.getByText("99999999")).toBeDefined();
    // A reissue re-uses the SAME authenticator secret, so re-showing a QR would
    // invite the user to enrol a second, pointless entry.
    expect(screen.queryByText("Scan this with your app")).toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("leaves the existing codes alone when regeneration is refused", async () => {
    const { client } = makeClient({
      generateBackupCodes: { data: null, error: { message: "Wrong password." } },
    });
    const onChanged = vi.fn();
    render(
      <AccountTwoFactor
        client={client}
        enabled
        requiresPassword
        onChanged={onChanged}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Regenerate backup codes" }),
    );
    fireEvent.change(screen.getByLabelText("Confirm your password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate new codes" }));

    // The server's own wording wins over our fallback when it sends one.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Wrong password.");
    expect(screen.queryByText("Save your backup codes now")).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("requires the password to turn 2FA off and refuses without it", () => {
    const { client } = makeClient();
    render(<AccountTwoFactor client={client} enabled requiresPassword />);
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));

    const submit = screen.getByRole("button", {
      name: "Turn off two-factor",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Confirm your password"), {
      target: { value: "hunter2" },
    });
    expect(submit.disabled).toBe(false);
  });

  it("keeps the panel open and shows why when turning off is refused", async () => {
    const { client, disable } = makeClient({
      disable: { data: null, error: {} },
    });
    const onChanged = vi.fn();
    render(
      <AccountTwoFactor
        client={client}
        enabled
        requiresPassword
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    fireEvent.change(screen.getByLabelText("Confirm your password"), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Turn off two-factor" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Couldn't turn two-factor off. Try again.");
    expect(disable).toHaveBeenCalledWith({ password: "nope" });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("resets the panel and tells the host once 2FA is actually off", async () => {
    const { client } = makeClient();
    const onChanged = vi.fn();
    render(
      <AccountTwoFactor
        client={client}
        enabled={false}
        requiresPassword={false}
        onChanged={onChanged}
      />,
    );
    // enabled={false} with the disable panel is not reachable, so exercise the
    // success reset through the enrolment panel's own Cancel instead.
    fireEvent.click(screen.getByRole("button", { name: "Turn on two-factor" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: "Turn on two-factor" }),
    ).toBeDefined();

    const enabledCard = makeClient();
    render(
      <AccountTwoFactor
        client={enabledCard.client}
        enabled
        requiresPassword={false}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn off two-factor" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(enabledCard.disable).toHaveBeenCalledWith({ password: undefined });
  });
});
