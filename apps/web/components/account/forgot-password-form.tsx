"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@quagga/ui/components/button";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { requestPasswordReset } from "@/lib/account-actions";

// Forgot-password request (canvas Gf1iJ / s2PAS ① "Request a reset link"). REAL:
// `auth.api.requestPasswordReset` is native to self-hosted email/password
// (@quagga/auth); the action presents it as honestly unavailable when no email
// sender is configured (a reset link can only reach the user by email).
//
// ENUMERATION-SAFETY IS THE DESIGN. The confirmation copy comes from @quagga/core
// `enumerationSafeMessage("forgot_password")` via the server action, and the SAME
// message renders whether or not the account exists — the action deliberately
// discards the provider's outcome, so there is nothing here that could branch.
// We also render the confirmation in place of the form rather than redirecting,
// because a redirect that only happens on success is itself an oracle.

export function ForgotPasswordForm() {
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await requestPasswordReset({
        email,
        redirectTo: "/auth/reset-password",
      });
      if (result.ok) {
        // The action returns the enumeration-safe message for BOTH outcomes.
        setSent(
          result.message ??
            "If that account exists, we've emailed it a reset link.",
        );
      } else {
        setError(result.error);
      }
    });
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Check your inbox
          </p>
          <h1 className="text-2xl">Reset link sent</h1>
        </div>
        <p className="text-sm text-muted-foreground">{sent}</p>
        <p className="text-xs text-muted-foreground">
          The link works once and expires shortly. If nothing arrives, check
          your spam folder before requesting another.
        </p>
        <Button variant="outline" asChild>
          <Link href="/auth/sign-in">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Account recovery
        </p>
        <h1 className="text-2xl">Forgot your password?</h1>
        <p className="text-sm text-muted-foreground">
          Enter your account email and we&rsquo;ll send a single-use reset link.
        </p>
      </div>

      <Field label="Email" htmlFor="forgot-email">
        <Input
          id="forgot-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
          required
        />
      </Field>

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending || email.length === 0}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link
          href="/auth/sign-in"
          className="font-medium text-primary hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
