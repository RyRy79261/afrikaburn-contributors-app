"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@quagga/ui/components/button";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { PasswordInput } from "@quagga/ui/components/password-input";
import { authClient } from "@/lib/auth-client";

// Branded email/password + Google auth form (design canvas frame u87N7). One
// password field (no confirm), show/hide toggle, length-based strength on
// sign-up. All messages are enumeration-safe per docs/accounts-security-spec.md
// — nothing reveals whether an account exists.

export type AuthMode = "sign-in" | "sign-up";

// Minimum password length (accounts-security-spec: 15+, no composition rules).
const PASSWORD_MIN_LENGTH = 15;

// Deliberately generic: same message whether the email is unknown or the
// password is wrong, so sign-in cannot be used to enumerate accounts.
const SIGN_IN_FAILED =
  "That email and password don't match. Check them and try again.";
// Shown for BOTH a fresh sign-up and an already-registered address.
const SIGN_UP_GENERIC =
  "Check your inbox — if that address is new, we've sent a link to confirm your account.";
const GENERIC_PROBLEM =
  "Something went wrong. Please try again in a moment.";

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
        // Keep the form to email + password (fewer forms — the Burner Bio
        // collects the rest). Derive a placeholder display name from the email.
        const name = email.split("@")[0] || "Burner";
        const { error: signUpError } = await authClient.signUp.email({
          email,
          password,
          name,
        });
        if (signUpError) {
          const msg = (signUpError.message ?? "").toLowerCase();
          // Surface real, actionable password problems; keep everything else
          // (including "user already exists") enumeration-safe.
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
        <h1 className="text-2xl">Welcome, burner</h1>
        <p className="text-sm text-muted-foreground">
          Sign in or create your account — your Burner Bio takes about 3 minutes.
        </p>
      </div>

      <Field label="Email" htmlFor="auth-email">
        <Input
          id="auth-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
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

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm font-medium text-primary">
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
              className="font-medium text-primary hover:underline"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link
              href="/auth/sign-up"
              className="font-medium text-primary hover:underline"
            >
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
