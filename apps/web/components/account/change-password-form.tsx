"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { assessPassword, PASSWORD_MIN_LENGTH } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { PasswordInput } from "@quagga/ui/components/password-input";
import { Switch } from "@quagga/ui/components/switch";
import { toast } from "@quagga/ui/components/toast";
import { changePassword } from "@/lib/account-actions";

// Change-password form (canvas SjInE "Password · Change"). A SUPPORTED
// capability — the provider's `change-password` endpoint re-authenticates with
// the current password upstream, so this is a real, working control.
//
// Per accounts-security-spec: ONE new-password field (no confirm-twice), a
// show/hide toggle, paste allowed, length-based strength. The client check uses
// the SAME @quagga/core `assessPassword` the server action enforces — the
// client copy is a courtesy, the server call is the boundary.

export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [revokeOthers, setRevokeOthers] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const assessment = assessPassword(newPassword);
  const ready =
    currentPassword.length > 0 && newPassword.length > 0 && assessment.ok;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!assessment.ok) {
      setError(assessment.error);
      return;
    }
    startTransition(async () => {
      const result = await changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: revokeOthers,
      });
      if (result.ok) {
        setCurrentPassword("");
        setNewPassword("");
        toast.success(result.message ?? "Password changed.");
        onDone?.();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Current password" htmlFor="account-current-password">
        <Input
          id="account-current-password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          disabled={pending}
          required
        />
      </Field>

      <Field
        label="New password"
        htmlFor="account-new-password"
        help={`At least ${PASSWORD_MIN_LENGTH} characters — passphrases welcome. Spaces are fine, and you can paste from a password manager.`}
      >
        <PasswordInput
          id="account-new-password"
          name="newPassword"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          disabled={pending}
          required
        />
      </Field>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/20 p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Sign out my other devices</p>
          <p className="text-xs text-muted-foreground">
            Recommended. This device stays signed in.
          </p>
        </div>
        <Switch
          checked={revokeOthers}
          onCheckedChange={setRevokeOthers}
          disabled={pending}
          aria-label="Sign out my other devices"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={!ready || pending}>
          {pending ? "Changing…" : "Change password"}
        </Button>
        {onDone ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDone}
            disabled={pending}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
