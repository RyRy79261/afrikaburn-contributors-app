import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { AccountTwoFactorChallenge } from "../account-two-factor-challenge";
import type { AccountAuthClient } from "../account-auth-client";

// The gate between a correct password and a session. The backup-code route is
// the recovery path for a lost authenticator, and it is the branch nothing else
// in the repo would notice breaking: if `switchMode` stops clearing the code, a
// half-typed TOTP is submitted as a backup code and refused; if the wrong verify
// method is called, a locked-out user stays locked out.
//
// The two modes have genuinely different validity rules, which is why every
// input assertion below is made twice.

function makeClient(over: { totp?: unknown; backup?: unknown } = {}) {
  const verifyTotp = vi
    .fn()
    .mockResolvedValue(over.totp ?? { data: {}, error: null });
  const verifyBackupCode = vi
    .fn()
    .mockResolvedValue(over.backup ?? { data: {}, error: null });
  const client = {
    twoFactor: {
      enable: vi.fn(),
      verifyTotp,
      verifyBackupCode,
      disable: vi.fn(),
      generateBackupCodes: vi.fn(),
    },
    passkey: { addPasskey: vi.fn(), deletePasskey: vi.fn() },
  } satisfies AccountAuthClient;
  return { client, verifyTotp, verifyBackupCode };
}

const toBackup = () =>
  fireEvent.click(
    screen.getByRole("button", {
      name: "Lost your authenticator? Use a backup code",
    }),
  );

describe("totp mode", () => {
  it("strips non-digits and caps at six", () => {
    const { client } = makeClient();
    render(
      <AccountTwoFactorChallenge client={client} onVerified={vi.fn()} />,
    );
    const input = screen.getByLabelText("6-digit code") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "12 34-56789" } });
    expect(input.value).toBe("123456");
  });

  it("keeps Verify disabled until there are exactly six digits", () => {
    const { client } = makeClient();
    render(
      <AccountTwoFactorChallenge client={client} onVerified={vi.fn()} />,
    );
    const verify = screen.getByRole("button", {
      name: "Verify",
    }) as HTMLButtonElement;

    expect(verify.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "12345" },
    });
    expect(verify.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    expect(verify.disabled).toBe(false);
  });

  it("verifies against the authenticator, never the backup route", async () => {
    const { client, verifyTotp, verifyBackupCode } = makeClient();
    const onVerified = vi.fn();
    render(
      <AccountTwoFactorChallenge client={client} onVerified={onVerified} />,
    );
    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(verifyTotp).toHaveBeenCalledWith({
      code: "123456",
      trustDevice: false,
    });
    // Sending a TOTP to the backup endpoint burns nothing but tells the user
    // their backup code was wrong, which is a lie about which thing failed.
    expect(verifyBackupCode).not.toHaveBeenCalled();
  });

  it("explains the 30-second window when the code is refused", async () => {
    const { client } = makeClient({ totp: { data: null, error: {} } });
    const onVerified = vi.fn();
    render(
      <AccountTwoFactorChallenge client={client} onVerified={onVerified} />,
    );
    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    const alert = await screen.findByRole("alert");
    // The most common cause is a code that has rolled over, so say so rather
    // than implying the account is wrong.
    expect(alert.textContent).toBe(
      "That code didn't match. It refreshes every 30 seconds — try the latest one.",
    );
    expect(onVerified).not.toHaveBeenCalled();
  });
});

describe("backup mode", () => {
  it("keeps non-digits and enables Verify on any non-empty value", () => {
    const { client } = makeClient();
    render(
      <AccountTwoFactorChallenge client={client} onVerified={vi.fn()} />,
    );
    toBackup();
    const input = screen.getByLabelText("Backup code") as HTMLInputElement;
    const verify = screen.getByRole("button", {
      name: "Verify",
    }) as HTMLButtonElement;

    expect(verify.disabled).toBe(true);
    // Backup codes are alphanumeric; the TOTP digit filter would destroy them.
    fireEvent.change(input, { target: { value: "  a1b2-c3d4  " } });
    expect(input.value).toBe("a1b2-c3d4");
    expect(verify.disabled).toBe(false);
  });

  it("verifies against the backup route, never the authenticator", async () => {
    const { client, verifyTotp, verifyBackupCode } = makeClient();
    const onVerified = vi.fn();
    render(
      <AccountTwoFactorChallenge client={client} onVerified={onVerified} />,
    );
    toBackup();
    fireEvent.change(screen.getByLabelText("Backup code"), {
      target: { value: "a1b2c3d4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(verifyBackupCode).toHaveBeenCalledWith({
      code: "a1b2c3d4",
      trustDevice: false,
    });
    expect(verifyTotp).not.toHaveBeenCalled();
  });

  it("names the single-use rule when a backup code is refused", async () => {
    const { client } = makeClient({ backup: { data: null, error: {} } });
    render(
      <AccountTwoFactorChallenge client={client} onVerified={vi.fn()} />,
    );
    toBackup();
    fireEvent.change(screen.getByLabelText("Backup code"), {
      target: { value: "used-code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    const alert = await screen.findByRole("alert");
    // "Already been used" is the difference between trying another code and
    // giving up on the whole recovery route.
    expect(alert.textContent).toBe(
      "That backup code didn't match, or it's already been used.",
    );
  });
});

describe("switching modes", () => {
  it("clears the code and the error, and swaps every mode-specific attribute", async () => {
    const { client } = makeClient({ totp: { data: null, error: {} } });
    render(
      <AccountTwoFactorChallenge client={client} onVerified={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await screen.findByRole("alert");

    toBackup();

    // A leftover TOTP submitted as a backup code is refused, and the user is
    // told their backup code is wrong — the worst place to be misinformed.
    const input = screen.getByLabelText("Backup code") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input.getAttribute("maxlength")).toBe("20");
    expect(input.getAttribute("inputmode")).toBe("text");
    expect(
      screen.getByText("Enter one of your backup codes. Each works once."),
    ).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Use a code from your authenticator app instead",
      }),
    );
    const back = screen.getByLabelText("6-digit code") as HTMLInputElement;
    expect(back.getAttribute("maxlength")).toBe("6");
    expect(back.getAttribute("inputmode")).toBe("numeric");
    expect(
      screen.getByText("Enter the 6-digit code from your authenticator app."),
    ).toBeDefined();
  });
});

describe("trust this device", () => {
  it("threads the choice into whichever verify call is made", async () => {
    const { client, verifyBackupCode } = makeClient();
    render(
      <AccountTwoFactorChallenge client={client} onVerified={vi.fn()} />,
    );
    toBackup();
    fireEvent.click(screen.getByLabelText("Trust this device for 30 days"));
    fireEvent.change(screen.getByLabelText("Backup code"), {
      target: { value: "a1b2c3d4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    // Dropping this silently means the person is challenged again tomorrow on
    // the device they just told us to remember.
    await waitFor(() =>
      expect(verifyBackupCode).toHaveBeenCalledWith({
        code: "a1b2c3d4",
        trustDevice: true,
      }),
    );
  });

  it("threads the choice into the AUTHENTICATOR call too", async () => {
    // The test above only reaches the backup arm. The two calls are written
    // separately in the source, so `trustDevice` can go missing from one while
    // the other keeps it — and the authenticator arm is the one nearly every
    // person actually uses.
    const { client, verifyTotp } = makeClient();
    render(<AccountTwoFactorChallenge client={client} onVerified={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("Trust this device for 30 days"));
    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() =>
      expect(verifyTotp).toHaveBeenCalledWith({
        code: "123456",
        trustDevice: true,
      }),
    );
  });
});
