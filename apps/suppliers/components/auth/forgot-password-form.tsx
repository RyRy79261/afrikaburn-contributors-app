"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@quagga/ui/components/button";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { requestPasswordReset } from "@/lib/actions/password";

// Forgot-password request for the portal. Enumeration-safe: the confirmation
// copy comes from the server action and is identical whether or not the account
// exists. The confirmation renders in place of the form (no success-only
// redirect that would itself be an oracle).

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
          <h1 className="text-2xl font-semibold tracking-tight">
            Reset link sent
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">{sent}</p>
        <Button variant="outline" asChild>
          <Link href="/signin">Back to sign in</Link>
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
        <h1 className="text-2xl font-semibold tracking-tight">
          Forgot your password?
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter your account email and we&rsquo;ll send a single-use reset link.
        </p>
      </div>

      <Field label="Email" htmlFor="forgot-email" required>
        <Input
          id="forgot-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="bookings@yourbusiness.co.za"
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
          href="/signin"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
