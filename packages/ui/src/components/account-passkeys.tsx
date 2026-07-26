"use client";

import * as React from "react";
import { Fingerprint, Trash2 } from "lucide-react";
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

// Shared passkey management card (design canvas frame G35eq / SjInE). Lives in
// @quagga/ui so all three apps render the identical flow — each passes its own
// `authClient`. Real, backed by @better-auth/passkey wired in @quagga/auth
// (migration 0015), rpID scoped to the apex so ONE passkey works on app./org./
// suppliers.
//
// RECOVERY HONESTY (the task's hard requirement): a passkey is an ACCELERATOR, not
// a replacement for the password. Losing your only passkey is never a lockout —
// you still sign in with your password (or a 2FA backup code). The copy says so,
// and the component never presents passkeys as the sole way in.

/** One registered passkey, as the host server-fetches it. */
export interface PasskeyRow {
  id: string;
  name: string | null;
  deviceType: string | null;
  createdAt: string | null;
}

export interface AccountPasskeysProps {
  client: AccountAuthClient;
  passkeys: PasskeyRow[];
  /** Called after add/remove so the host can refresh the server-rendered list. */
  onChanged?: () => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function AccountPasskeys({
  client,
  passkeys,
  onChanged,
}: AccountPasskeysProps) {
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const supported =
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined";

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    // Triggers the browser WebAuthn prompt (Touch ID / Windows Hello / security
    // key). The plugin stores the credential against this user, scoped to the
    // apex rpID.
    const { error: err } = await client.passkey.addPasskey({
      name: name.trim() || undefined,
    });
    setPending(false);
    if (err) {
      // A user cancelling the browser prompt surfaces here too — keep it calm.
      setError(
        clientErrorMessage(
          err,
          "That didn't complete. Your device may have cancelled it — try again.",
        ),
      );
      return;
    }
    setName("");
    setAdding(false);
    onChanged?.();
  }

  async function remove(id: string) {
    setError(null);
    setBusyId(id);
    const { error: err } = await client.passkey.deletePasskey({ id });
    setBusyId(null);
    if (err) {
      setError(clientErrorMessage(err, "Couldn't remove that passkey. Try again."));
      return;
    }
    onChanged?.();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Fingerprint className="h-4 w-4 text-muted-foreground" aria-hidden />
              Passkeys
            </CardTitle>
            <CardDescription className="mt-1.5">
              Sign in with your fingerprint, face or device PIN instead of typing
              a password. One passkey works across all of AfrikaBurn&rsquo;s apps.
            </CardDescription>
          </div>
          <Badge variant={passkeys.length > 0 ? "success" : "outline"}>
            {passkeys.length > 0 ? `${passkeys.length} set up` : "None yet"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {passkeys.length > 0 ? (
          <ul className="flex flex-col">
            {passkeys.map((pk) => (
              <li
                key={pk.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Fingerprint
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {pk.name?.trim() || "Passkey"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {pk.deviceType === "multiDevice"
                        ? "Synced"
                        : pk.deviceType === "singleDevice"
                          ? "This device"
                          : "Passkey"}
                      {pk.createdAt ? ` · added ${formatDate(pk.createdAt)}` : ""}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(pk.id)}
                  disabled={busyId === pk.id}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {busyId === pk.id ? "Removing…" : "Remove"}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            You haven&rsquo;t added any passkeys yet.
          </p>
        )}

        {adding ? (
          <form onSubmit={add} className="flex flex-col gap-3" noValidate>
            <Field
              label="Name this passkey"
              htmlFor="passkey-name"
              help="So you can tell your devices apart — e.g. “My phone”."
            >
              <Input
                id="passkey-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My phone"
                maxLength={64}
                disabled={pending}
              />
            </Field>
            {error ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Waiting for your device…" : "Create passkey"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAdding(false);
                  setName("");
                  setError(null);
                }}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            {error ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setError(null);
                  setAdding(true);
                }}
                disabled={!supported}
              >
                Add a passkey
              </Button>
            </div>
            {!supported ? (
              <p className="text-xs text-muted-foreground">
                This browser doesn&rsquo;t support passkeys. You can still sign in
                with your password.
              </p>
            ) : null}
          </div>
        )}

        <p className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          A passkey is a faster way in, not your only one — your password stays
          active, so losing a device never locks you out. Removing a passkey here
          only affects sign-in on that device.
        </p>
      </CardContent>
    </Card>
  );
}
