"use client";

import * as React from "react";
import { Button } from "@quagga/ui/components/button";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { PasswordInput } from "@quagga/ui/components/password-input";
import { Switch } from "@quagga/ui/components/switch";
import { toast } from "@quagga/ui/components/toast";

// Change-password form (canvas SjInE "Password · Change"), shared by all three
// apps. Backed by Better Auth's `change-password`, which re-authenticates with
// the current password server-side — we never verify a password ourselves.
//
// Per accounts-security-spec: ONE new-password field (no confirm-twice), a
// show/hide toggle, paste allowed, length-based strength.
//
// THE POLICY IS INJECTED, not imported. `assess` is @quagga/core's
// `assessPassword` handed in by the app — the same function the server action
// enforces — because @quagga/ui does not depend on core. The client check is a
// courtesy either way; the server call is the boundary, and this component
// cannot become a second, drifting definition of what a good password is.

/**
 * Structurally what @quagga/core's `assessPassword` returns — declared here
 * rather than imported because @quagga/ui takes no dependency on core. `error`
 * is `string | null | undefined` so core's shape (which nulls it on success)
 * satisfies it without a cast at every call site.
 */
export interface PasswordAssessment {
  ok: boolean;
  error?: string | null;
}

export type ChangePasswordResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export function AccountChangePassword({
  minLength,
  assess,
  onSubmit,
  onDone,
  onChanged,
  idPrefix = "account",
}: {
  /** For the `minLength` attribute and the help text. */
  minLength: number;
  assess: (password: string) => PasswordAssessment;
  onSubmit: (input: {
    currentPassword: string;
    newPassword: string;
    revokeOtherSessions: boolean;
  }) => Promise<ChangePasswordResult>;
  /** Collapse the form. When absent, no Cancel button is offered. */
  onDone?: () => void;
  /** Re-read the server-rendered page after a successful change. */
  onChanged?: () => void;
  /** Namespaces the field ids so two forms can coexist on one page. */
  idPrefix?: string;
}) {
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [revokeOthers, setRevokeOthers] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const assessment = assess(newPassword);
  const ready =
    currentPassword.length > 0 && newPassword.length > 0 && assessment.ok;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!assessment.ok) {
      setError(assessment.error ?? "That password won't do.");
      return;
    }
    startTransition(async () => {
      const result = await onSubmit({
        currentPassword,
        newPassword,
        revokeOtherSessions: revokeOthers,
      });
      if (result.ok) {
        setCurrentPassword("");
        setNewPassword("");
        toast.success(result.message ?? "Password changed.");
        onDone?.();
        onChanged?.();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Current password" htmlFor={`${idPrefix}-current-password`}>
        <Input
          id={`${idPrefix}-current-password`}
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
        htmlFor={`${idPrefix}-new-password`}
        help={`At least ${minLength} characters — passphrases welcome. Spaces are fine, and you can paste from a password manager.`}
      >
        <PasswordInput
          id={`${idPrefix}-new-password`}
          name="newPassword"
          autoComplete="new-password"
          minLength={minLength}
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
