"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { DELETION_GRACE_PERIOD_DAYS } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { toast } from "@quagga/ui/components/toast";
import {
  cancelAccountDeletion,
  requestAccountDeletion,
} from "@/lib/account-actions";

// The re-auth + request control (canvas Q3pQj6 §"Confirm and request deletion").
//
// TWO CONFIRMATION SHAPES, because accounts come in two shapes:
//   · password accounts re-enter their password (verified upstream);
//   · Google-only accounts type their own email address, because there is no
//     local credential to verify and a server action cannot round-trip a
//     Google re-consent.
//
// Until 27 Jul 2026 only the first existed, so a Google-only burner was shown a
// password field that could never succeed — POPIA erasure was unreachable for
// them. The server decides which applies from the linked providers; `hasPassword`
// here only picks the control to draw.
//
// `blocked` disables the button, but the real guard is server-side —
// `requestAccountDeletion` re-runs `assessDeletionEligibility` after re-auth,
// so a burner who defeats the disabled attribute still gets refused.

export function DeleteAccountForm({
  blocked,
  hasPassword,
  email,
}: {
  blocked: boolean;
  /** False for a Google-only account: confirm by typing the address instead. */
  hasPassword: boolean;
  email: string | null;
}) {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [confirmEmail, setConfirmEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const answer = hasPassword ? password : confirmEmail;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await requestAccountDeletion(
        hasPassword ? { password } : { confirmEmail },
      );
      if (result.ok) {
        setPassword("");
        setConfirmEmail("");
        toast.success(result.message ?? "Deletion scheduled.");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {hasPassword ? (
        <Field
          label="Confirm your password"
          htmlFor="delete-password"
          help="We ask again because a stolen session shouldn't be enough to erase someone."
        >
          <Input
            id="delete-password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending || blocked}
            required
          />
        </Field>
      ) : (
        <Field
          label="Type your email address to confirm"
          htmlFor="delete-confirm-email"
          help={
            email
              ? `You sign in with Google, so there's no password to check. Type ${email} to confirm it's you.`
              : "You sign in with Google, so there's no password to check. Type your account email address to confirm."
          }
        >
          <Input
            id="delete-confirm-email"
            name="confirmEmail"
            type="email"
            autoComplete="off"
            spellCheck={false}
            placeholder={email ?? "you@example.com"}
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            disabled={pending || blocked}
            required
          />
        </Field>
      )}

      <p className="text-xs text-muted-foreground">
        You have {DELETION_GRACE_PERIOD_DAYS} days to change your mind — just
        sign in during that window and the deletion is cancelled, no harm done.
        After {DELETION_GRACE_PERIOD_DAYS} days your account is anonymised, not
        hard-deleted, so camps and history stay intact.
      </p>

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col items-start gap-2">
        <Button
          type="submit"
          variant="destructive"
          disabled={blocked || pending || answer.trim().length === 0}
        >
          {pending ? "Requesting…" : "Request deletion"}
        </Button>
        {blocked ? (
          <p className="text-xs text-muted-foreground">
            Resolve the blocker above to enable this.
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** Cancel a running grace period from the page (signing in also cancels it). */
export function CancelDeletionButton() {
  const router = useRouter();
  const [cancelling, startCancel] = React.useTransition();
  // A SECOND transition, for the refresh alone. `router.refresh()` returns void
  // and only keeps a transition pending when it is called SYNCHRONOUSLY inside
  // one — called after an `await`, the original transition has already exited,
  // so the button went back to "Keep my account" and the toast appeared while
  // the grace banner was still on screen. That reads as a failed cancel on the
  // one screen where a person is already anxious about losing their account,
  // and it is what makes the e2e spec race the server.
  const [refreshing, startRefresh] = React.useTransition();

  async function cancel() {
    const result = await new Promise<
      Awaited<ReturnType<typeof cancelAccountDeletion>>
    >((resolve) => {
      startCancel(async () => resolve(await cancelAccountDeletion()));
    });

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "Cancelled — nothing was erased.");
    // Synchronous inside the transition: `pending` now stays true until the
    // fresh server render has actually arrived, so the control is only ever
    // idle when the screen matches the database.
    startRefresh(() => router.refresh());
  }

  const pending = cancelling || refreshing;
  return (
    <Button onClick={cancel} disabled={pending}>
      {pending ? "Cancelling…" : "Keep my account"}
    </Button>
  );
}
