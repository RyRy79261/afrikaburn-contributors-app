"use client";

import * as React from "react";
import QRCode from "react-qr-code";
import { ShieldCheck, ShieldQuestion, Copy, Download, Check } from "lucide-react";
import { Badge } from "./badge";
import { Button } from "./button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card";
import { Field } from "./field";
import { Input } from "./input";
import {
  clientErrorMessage,
  type AccountAuthClient,
} from "./account-auth-client";

// Shared TOTP two-factor enrolment + management card (design canvas frame G35eq /
// SjInE). Lives in @quagga/ui so the participant, org and supplier apps render the
// IDENTICAL flow — each passes its own `authClient` (which structurally satisfies
// AccountAuthClient). Real, backed by the Better Auth twoFactor plugin wired in
// @quagga/auth (migration 0015).
//
// The enrolment flow the frames specify:
//   turn on → confirm password → scan QR / copy the setup key → verify a 6-digit
//   code → backup codes shown ONCE (copy / download) → 2FA is on.
// Backup codes are the recovery path when the authenticator is lost, so they are
// surfaced exactly once and never again — regenerate replaces them.

const GENERIC = "Something went wrong. Try again.";

/** Pull the base32 secret out of an otpauth:// URI for the manual-entry key. */
function secretFromTotpUri(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    return parsed.searchParams.get("secret");
  } catch {
    return null;
  }
}

/** Group a base32 secret into 4-char blocks so it can be typed without errors. */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

type Step = "verify" | "backup";

export interface AccountTwoFactorProps {
  client: AccountAuthClient;
  /** Whether 2FA is currently on for this account (user.twoFactorEnabled). */
  enabled: boolean;
  /**
   * Whether a password must be supplied to enable/disable. True when the account
   * has a password credential (Better Auth requires it); false for a
   * Google-only / passkey-only account (allowPasswordless is set in @quagga/auth).
   */
  requiresPassword: boolean;
  /** Called after a state change so the host can refresh server data. */
  onChanged?: () => void;
}

export function AccountTwoFactor({
  client,
  enabled,
  requiresPassword,
  onChanged,
}: AccountTwoFactorProps) {
  const [open, setOpen] = React.useState(false); // enrolment panel open
  const [step, setStep] = React.useState<Step>("verify");
  const [password, setPassword] = React.useState("");
  const [totpUri, setTotpUri] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");
  const [backupCodes, setBackupCodes] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  // Disable / regenerate sub-panels (only shown once enabled).
  const [managing, setManaging] = React.useState<null | "disable" | "regen">(
    null,
  );
  const [managePassword, setManagePassword] = React.useState("");

  function reset() {
    setOpen(false);
    setStep("verify");
    setPassword("");
    setTotpUri(null);
    setCode("");
    setBackupCodes([]);
    setError(null);
    setPending(false);
    setCopied(false);
    setManaging(null);
    setManagePassword("");
  }

  async function beginEnrol(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { data, error: err } = await client.twoFactor.enable({
      password: password || undefined,
    });
    setPending(false);
    if (err || !data) {
      setError(
        clientErrorMessage(
          err,
          requiresPassword
            ? "That password didn't match. Try again."
            : GENERIC,
        ),
      );
      return;
    }
    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes ?? []);
    setStep("verify");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { error: err } = await client.twoFactor.verifyTotp({ code });
    setPending(false);
    if (err) {
      setError(
        clientErrorMessage(err, "That code didn't match. Check the app and try again."),
      );
      return;
    }
    // Verified — reveal the backup codes once, then we're done.
    setStep("backup");
    onChanged?.();
  }

  function copyCodes() {
    void navigator.clipboard?.writeText(backupCodes.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function downloadCodes() {
    const blob = new Blob(
      [
        "AfrikaBurn Contributors — two-factor backup codes\n",
        "Each code works once. Keep them somewhere safe and private.\n\n",
        ...backupCodes.map((c) => `${c}\n`),
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "afrikaburn-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { error: err } = await client.twoFactor.disable({
      password: managePassword || undefined,
    });
    setPending(false);
    if (err) {
      setError(
        clientErrorMessage(err, "Couldn't turn two-factor off. Try again."),
      );
      return;
    }
    reset();
    onChanged?.();
  }

  async function regenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { data, error: err } = await client.twoFactor.generateBackupCodes({
      password: managePassword || undefined,
    });
    setPending(false);
    if (err || !data) {
      setError(
        clientErrorMessage(err, "Couldn't generate new backup codes. Try again."),
      );
      return;
    }
    setBackupCodes(data.backupCodes ?? []);
    setManaging(null);
    setManagePassword("");
    setStep("backup");
    setOpen(true);
    setTotpUri(null); // no QR — this is a pure backup-code reissue
    onChanged?.();
  }

  const secret = totpUri ? secretFromTotpUri(totpUri) : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              {enabled ? (
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
              ) : (
                <ShieldQuestion
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden
                />
              )}
              Two-factor authentication
            </CardTitle>
            <CardDescription className="mt-1.5">
              One-time codes from an authenticator app. We never use SMS — SIM
              swaps are a real, common attack in South Africa.
            </CardDescription>
          </div>
          <Badge variant={enabled ? "success" : "outline"}>
            {enabled ? "On" : "Off"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* ---- OFF, not enrolling: offer to turn it on. ---- */}
        {!enabled && !open ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Add a second step at sign-in. You&rsquo;ll scan a QR code with an
              authenticator app (Google Authenticator, Aegis, 1Password…) and get
              backup codes to keep somewhere safe.
            </p>
            <div>
              <Button
                size="sm"
                onClick={() => {
                  reset();
                  setOpen(true);
                }}
              >
                Turn on two-factor
              </Button>
            </div>
          </div>
        ) : null}

        {/* ---- Enrolment: password (if needed) then QR. ---- */}
        {!enabled && open && !totpUri && step === "verify" ? (
          <form onSubmit={beginEnrol} className="flex flex-col gap-4" noValidate>
            {requiresPassword ? (
              <Field
                label="Confirm your password"
                htmlFor="tfa-enrol-password"
                help="We ask for it before turning on a second factor."
              >
                <Input
                  id="tfa-enrol-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={pending}
                  required
                />
              </Field>
            ) : (
              <p className="text-sm text-muted-foreground">
                We&rsquo;ll generate a setup QR code for your authenticator app.
              </p>
            )}
            {error ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={pending || (requiresPassword && !password)}
              >
                {pending ? "Setting up…" : "Continue"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {/* ---- Enrolment: QR + setup key + verify. ---- */}
        {!enabled && open && totpUri && step === "verify" ? (
          <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="rounded-lg border border-border bg-white p-3">
                <QRCode value={totpUri} size={160} />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <p className="text-sm font-medium">Scan this with your app</p>
                <p className="text-xs text-muted-foreground">
                  Can&rsquo;t scan? Enter this setup key manually:
                </p>
                {secret ? (
                  <code className="select-all break-all rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs">
                    {groupSecret(secret)}
                  </code>
                ) : null}
              </div>
            </div>
            <Field
              label="Enter the 6-digit code"
              htmlFor="tfa-verify-code"
              help="From your authenticator app — it refreshes every 30 seconds."
            >
              <Input
                id="tfa-verify-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                disabled={pending}
                required
              />
            </Field>
            {error ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={pending || code.length !== 6}
              >
                {pending ? "Verifying…" : "Verify and turn on"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {/* ---- Backup codes shown ONCE. ---- */}
        {open && step === "backup" ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
              <p className="text-sm font-medium">
                Save your backup codes now
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Each works once. They&rsquo;re your way in if you lose your
                authenticator — we can&rsquo;t show them again.
              </p>
            </div>
            <ul className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3">
              {backupCodes.map((c) => (
                <li key={c} className="font-mono text-sm">
                  {c}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copyCodes}
              >
                {copied ? (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copy
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={downloadCodes}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Download
              </Button>
              <Button type="button" size="sm" onClick={reset}>
                I&rsquo;ve saved them
              </Button>
            </div>
          </div>
        ) : null}

        {/* ---- ON: manage (regenerate codes / turn off). ---- */}
        {enabled && !open ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Two-factor is on. You&rsquo;ll enter a code from your authenticator
              app each time you sign in on a new device.
            </p>
            {managing === null ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setManaging("regen");
                  }}
                >
                  Regenerate backup codes
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setManaging("disable");
                  }}
                >
                  Turn off
                </Button>
              </div>
            ) : null}

            {managing === "disable" ? (
              <form onSubmit={disable} className="flex flex-col gap-3" noValidate>
                <p className="text-sm text-muted-foreground">
                  Turning two-factor off makes your account easier to break into.
                </p>
                {requiresPassword ? (
                  <Field label="Confirm your password" htmlFor="tfa-disable-pw">
                    <Input
                      id="tfa-disable-pw"
                      type="password"
                      autoComplete="current-password"
                      value={managePassword}
                      onChange={(e) => setManagePassword(e.target.value)}
                      disabled={pending}
                      required
                    />
                  </Field>
                ) : null}
                {error ? (
                  <p role="alert" className="text-sm font-medium text-destructive">
                    {error}
                  </p>
                ) : null}
                <div className="flex items-center gap-2">
                  <Button
                    type="submit"
                    variant="destructive"
                    size="sm"
                    disabled={pending || (requiresPassword && !managePassword)}
                  >
                    {pending ? "Turning off…" : "Turn off two-factor"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setManaging(null);
                      setManagePassword("");
                      setError(null);
                    }}
                    disabled={pending}
                  >
                    Keep it on
                  </Button>
                </div>
              </form>
            ) : null}

            {managing === "regen" ? (
              <form
                onSubmit={regenerate}
                className="flex flex-col gap-3"
                noValidate
              >
                <p className="text-sm text-muted-foreground">
                  This replaces your existing backup codes — the old ones stop
                  working.
                </p>
                {requiresPassword ? (
                  <Field label="Confirm your password" htmlFor="tfa-regen-pw">
                    <Input
                      id="tfa-regen-pw"
                      type="password"
                      autoComplete="current-password"
                      value={managePassword}
                      onChange={(e) => setManagePassword(e.target.value)}
                      disabled={pending}
                      required
                    />
                  </Field>
                ) : null}
                {error ? (
                  <p role="alert" className="text-sm font-medium text-destructive">
                    {error}
                  </p>
                ) : null}
                <div className="flex items-center gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={pending || (requiresPassword && !managePassword)}
                  >
                    {pending ? "Generating…" : "Generate new codes"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setManaging(null);
                      setManagePassword("");
                      setError(null);
                    }}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
