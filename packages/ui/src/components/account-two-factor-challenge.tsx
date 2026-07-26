"use client";

import * as React from "react";
import { Button } from "./button";
import { Field } from "./field";
import { Input } from "./input";
import {
  clientErrorMessage,
  type AccountAuthClient,
} from "./account-auth-client";

// Shared sign-in second-factor challenge (design canvas frame u87N7 — the step
// after a correct password when 2FA is on). Better Auth's signIn.email returns
// `data.twoFactorRedirect === true` instead of a session; the sign-in view then
// renders this. Real, backed by the twoFactor plugin.
//
// Two ways through, so a lost authenticator is never a dead end:
//   - a 6-digit code from the authenticator app (default), or
//   - a one-time backup code (the recovery path).

export interface AccountTwoFactorChallengeProps {
  client: AccountAuthClient;
  /** Called once the second factor verifies and a full session exists. */
  onVerified: () => void;
}

export function AccountTwoFactorChallenge({
  client,
  onVerified,
}: AccountTwoFactorChallengeProps) {
  const [mode, setMode] = React.useState<"totp" | "backup">("totp");
  const [code, setCode] = React.useState("");
  const [trustDevice, setTrustDevice] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function switchMode(next: "totp" | "backup") {
    setMode(next);
    setCode("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result =
      mode === "totp"
        ? await client.twoFactor.verifyTotp({ code, trustDevice })
        : await client.twoFactor.verifyBackupCode({ code, trustDevice });
    setPending(false);
    if (result.error) {
      setError(
        clientErrorMessage(
          result.error,
          mode === "totp"
            ? "That code didn't match. It refreshes every 30 seconds — try the latest one."
            : "That backup code didn't match, or it's already been used.",
        ),
      );
      return;
    }
    onVerified();
  }

  const totp = mode === "totp";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl">One more step</h1>
        <p className="text-sm text-muted-foreground">
          {totp
            ? "Enter the 6-digit code from your authenticator app."
            : "Enter one of your backup codes. Each works once."}
        </p>
      </div>

      <Field label={totp ? "6-digit code" : "Backup code"} htmlFor="tfa-challenge">
        <Input
          id="tfa-challenge"
          inputMode={totp ? "numeric" : "text"}
          autoComplete="one-time-code"
          autoFocus
          maxLength={totp ? 6 : 20}
          value={code}
          onChange={(e) =>
            setCode(
              totp
                ? e.target.value.replace(/\D/g, "").slice(0, 6)
                : e.target.value.trim(),
            )
          }
          disabled={pending}
          required
        />
      </Field>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={trustDevice}
          onChange={(e) => setTrustDevice(e.target.checked)}
          disabled={pending}
        />
        Trust this device for 30 days
      </label>

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        disabled={pending || (totp ? code.length !== 6 : code.length === 0)}
      >
        {pending ? "Verifying…" : "Verify"}
      </Button>

      <button
        type="button"
        className="text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => switchMode(totp ? "backup" : "totp")}
      >
        {totp
          ? "Lost your authenticator? Use a backup code"
          : "Use a code from your authenticator app instead"}
      </button>
    </form>
  );
}
