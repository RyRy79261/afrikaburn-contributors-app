"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { assessPassword, PASSWORD_MIN_LENGTH } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { Field } from "@quagga/ui/components/field";
import { PasswordInput } from "@quagga/ui/components/password-input";
import { toast } from "@quagga/ui/components/toast";
import { resetPassword } from "@/lib/actions/password";

// Set a new password from an emailed link. ONE field, length-based strength,
// paste allowed. The reset invalidates every session on success. A missing token
// is a different screen, not a disabled state.

export function ResetPasswordForm({ token }: { token: string | null }) {
  if (!token) return <MissingToken />;
  return <ResetForm token={token} />;
}

function MissingToken() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          This link isn&rsquo;t usable
        </h1>
        <p className="text-sm text-muted-foreground">
          Reset links carry a single-use token. This one arrived without one —
          it may have been truncated by your email client, or already used.
        </p>
      </div>
      <Button asChild>
        <Link href="/auth/forgot-password">Request a new link</Link>
      </Button>
    </div>
  );
}

function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const assessment = assessPassword(password);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!assessment.ok) {
      setError(assessment.error);
      return;
    }
    startTransition(async () => {
      const result = await resetPassword({ token, newPassword: password });
      if (result.ok) {
        toast.success(result.message ?? "Password reset.");
        router.push("/signin");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Set a new password
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Choose a new password
        </h1>
        <p className="text-sm text-muted-foreground">
          Almost done — pick something long and memorable. This link works once.
        </p>
      </div>

      <Field
        label="New password"
        htmlFor="reset-password"
        help={`At least ${PASSWORD_MIN_LENGTH} characters — passphrases welcome`}
      >
        <PasswordInput
          id="reset-password"
          name="newPassword"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
          required
        />
      </Field>

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending || !assessment.ok}>
        {pending ? "Resetting…" : "Reset password"}
      </Button>

      <p className="text-xs text-muted-foreground">
        This signs you out everywhere — you&rsquo;ll re-enter your new password
        on each device.
      </p>
    </form>
  );
}
