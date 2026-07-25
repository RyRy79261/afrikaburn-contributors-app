"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { enumerationSafeMessage } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { PasswordInput } from "@quagga/ui/components/password-input";

import { authClient } from "@/lib/auth-client";

// Supplier sign-in (canvas `OX6KJ` desktop / `xgCd7` mobile), redesigned to
// match the sign-up screen.
//
// The failure message is the SINGLE generic string from @quagga/core
// (`enumerationSafeMessage("sign_in")`) — identical whether the address is
// unknown, the password is wrong, or the account is locked out. Nothing here
// may branch on account existence (docs/accounts-security-spec.md §"No user
// enumeration"; `leaksAccountExistence` is the regression guard on that copy).
//
// No strength meter on this field: on sign-in it is noise, and it would leak
// nothing useful anyway.

const GENERIC_PROBLEM = "Something went wrong. Please try again in a moment.";

export function SupplierSignInForm() {
  const router = useRouter();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { error: signInError } = await authClient.signIn.email({
        email: email.trim(),
        password,
        callbackURL: "/onboarding",
      });
      if (signInError) {
        setError(enumerationSafeMessage("sign_in"));
        return;
      }
      router.push("/onboarding");
      router.refresh();
    } catch {
      setError(GENERIC_PROBLEM);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Welcome back — pick up where your onboarding left off.
        </p>
      </div>

      <Field label="Email" htmlFor="signin-email" required>
        <Input
          id="signin-email"
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

      <Field label="Password" htmlFor="signin-password" required>
        <PasswordInput
          id="signin-password"
          name="password"
          autoComplete="current-password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hideStrength
          disabled={pending}
          required
        />
      </Field>

      <div className="-mt-1 text-right">
        <Link
          href="/auth/forgot-password"
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Forgot your password?
        </Link>
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-xs text-muted-foreground">
        If something doesn&apos;t match we&apos;ll just say so — we never reveal
        which part was wrong.
      </p>

      <p className="text-center text-sm text-muted-foreground">
        New supplier?{" "}
        <Link
          href="/signup"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
