"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PASSWORD_MIN_LENGTH } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { PasswordInput } from "@quagga/ui/components/password-input";
import { authClient } from "@/lib/auth-client";

// Branded email/password + Google auth form for the organiser console, talking
// to our OWN self-hosted Better Auth at /api/auth/* (@quagga/auth). Mirrors the
// participant app's form (one password field, no confirm, length-based strength
// on sign-up) and keeps every message enumeration-safe.
//
// Org ACCESS is not granted here — signing in only establishes an identity. The
// console gate (resolveOrgSession) still decides god/org_staff, and god is only
// bootstrapped for a GOD_EMAILS address whose email the provider has VERIFIED
// (Google sign-in, or a verified email once an email provider is configured).

export type AuthMode = "sign-in" | "sign-up";

const SIGN_IN_FAILED =
  "That email and password don't match. Check them and try again.";
const SIGN_UP_GENERIC =
  "Check your inbox — if that address is new, we've sent a link to confirm your account.";
const GENERIC_PROBLEM = "Something went wrong. Please try again in a moment.";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const isSignUp = mode === "sign-up";

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [googlePending, setGooglePending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (isSignUp && password.length < PASSWORD_MIN_LENGTH) {
      setError(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }

    setPending(true);
    try {
      if (isSignUp) {
        const name = email.split("@")[0] || "Organiser";
        const { error: signUpError } = await authClient.signUp.email({
          email,
          password,
          name,
        });
        if (signUpError) {
          const msg = (signUpError.message ?? "").toLowerCase();
          if (msg.includes("password")) {
            setError(
              `That password can't be used. Use at least ${PASSWORD_MIN_LENGTH} characters.`,
            );
          } else {
            setNotice(SIGN_UP_GENERIC);
          }
          return;
        }
        setNotice(SIGN_UP_GENERIC);
        router.refresh();
        return;
      }

      const { error: signInError } = await authClient.signIn.email({
        email,
        password,
        callbackURL: "/",
      });
      if (signInError) {
        setError(SIGN_IN_FAILED);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError(GENERIC_PROBLEM);
    } finally {
      setPending(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setNotice(null);
    setGooglePending(true);
    try {
      await authClient.signIn.social({ provider: "google", callbackURL: "/" });
    } catch {
      setError(GENERIC_PROBLEM);
      setGooglePending(false);
    }
  }

  const busy = pending || googlePending;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl">
          {isSignUp ? "Create your console account" : "Organiser sign-in"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Restricted to AfrikaBurn org staff. Access is granted by your role, not
          by signing in.
        </p>
      </div>

      <Field label="Email" htmlFor="auth-email">
        <Input
          id="auth-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@afrikaburn.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          required
        />
      </Field>

      <Field label="Password" htmlFor="auth-password">
        <PasswordInput
          id="auth-password"
          name="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hideStrength={!isSignUp}
          minLength={PASSWORD_MIN_LENGTH}
          disabled={busy}
          required
        />
      </Field>

      {isSignUp ? null : (
        <div className="-mt-1 text-right">
          <Link
            href="/auth/forgot-password"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Forgot your password?
          </Link>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm font-medium text-accent">
          {notice}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={busy}>
        {pending
          ? isSignUp
            ? "Creating account…"
            : "Signing in…"
          : isSignUp
            ? "Create account"
            : "Sign in"}
      </Button>

      <div className="flex items-center gap-3 py-1">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-widest text-muted-foreground">
          or
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={handleGoogle}
        disabled={busy}
      >
        {googlePending ? "Redirecting…" : "Continue with Google"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {isSignUp ? (
          <>
            Already have an account?{" "}
            <Link
              href="/auth/sign-in"
              className="font-medium text-accent hover:underline"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            New org account?{" "}
            <Link
              href="/auth/sign-up"
              className="font-medium text-accent hover:underline"
            >
              Create one
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
