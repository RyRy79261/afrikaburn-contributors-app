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
// Re-auth is PASSWORD ONLY, and that is not a shortcut: the spec's alternative
// second factor is 2FA, which is structurally unavailable on our managed Neon
// Auth instance (see docs/accounts-security-spec.md §"Provider capability
// probe"). There is nothing else to offer, so we don't pretend there is.
//
// `blocked` disables the button, but the real guard is server-side —
// `requestAccountDeletion` re-runs `assessDeletionEligibility` after re-auth,
// so a burner who defeats the disabled attribute still gets refused.

export function DeleteAccountForm({ blocked }: { blocked: boolean }) {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await requestAccountDeletion({ password });
      if (result.ok) {
        setPassword("");
        toast.success(result.message ?? "Deletion scheduled.");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
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
          disabled={blocked || pending || password.length === 0}
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
  const [pending, startTransition] = React.useTransition();

  function cancel() {
    startTransition(async () => {
      const result = await cancelAccountDeletion();
      if (result.ok) {
        toast.success(result.message ?? "Cancelled — nothing was erased.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button onClick={cancel} disabled={pending}>
      {pending ? "Cancelling…" : "Keep my account"}
    </Button>
  );
}
