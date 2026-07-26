"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@quagga/ui/components/button";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { PasswordInput } from "@quagga/ui/components/password-input";
import { AccountTwoFactorChallenge } from "@quagga/ui/components/account-two-factor-challenge";
import {
  INVITE_AUTH_PARAM,
  INVITE_AUTH_MARKER,
  INVITE_RESUME_PATH,
} from "@quagga/core";
import { authClient } from "@/lib/auth-client";
import { navigateOnwards } from "@/lib/client-navigation";

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

export function AuthForm({
  mode,
  redirectTo = "/",
}: {
  mode: AuthMode;
  /**
   * Where a completed sign-in lands. Only ever an INTERNAL path chosen by the
   * server (see app/auth/[...path]/page.tsx) — never read from user input — so
   * it cannot become an open redirect. `/join/continue` is the invite round
   * trip's far side.
   */
  redirectTo?: string;
}) {
  const router = useRouter();
  const isSignUp = mode === "sign-up";
  // Keep "an invite is waiting" attached when the visitor switches between
  // sign-in, sign-up and forgot-password, so the round trip is not dropped by a
  // change of mind. Opaque marker only — the token lives in an httpOnly cookie.
  const resumingInvite = redirectTo === INVITE_RESUME_PATH;
  const authQuery = resumingInvite
    ? `?${INVITE_AUTH_PARAM}=${INVITE_AUTH_MARKER}`
    : "";

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [googlePending, setGooglePending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  // Set when a correct password returns a 2FA challenge instead of a session.
  const [needsTwoFactor, setNeedsTwoFactor] = React.useState(false);

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
        const { data: signUpData, error: signUpError } =
          await authClient.signUp.email({
            email,
            password,
            name,
            // Where the VERIFICATION email's link returns to. With email
            // verification on (production), this is the only thing that carries
            // an invite across the inbox round trip.
            callbackURL: redirectTo,
          });
        if (signUpError) {
          const msg = (signUpError.message ?? "").toLowerCase();
          // Surface real, actionable password problems; keep everything else
          // (including "user already exists") enumeration-safe.
          if (msg.includes("password")) {
            setError(
              `That password can't be used. Use at least ${PASSWORD_MIN_LENGTH} characters.`,
            );
          } else if (resumingInvite) {
            // ENUMERATION: in the invite flow the success path navigates to the
            // camp, so stopping here with a notice would make "already has an
            // account" observable to anyone holding an invite token — the exact
            // oracle SIGN_UP_GENERIC exists to prevent. It only bit when email
            // verification is off (local, preview, demo), because with it on no
            // session comes back either way; but the property must not depend
            // on a deployment setting. Both outcomes now go to the same url,
            // and `/join/continue` bounces a signed-out arrival to sign-in.
            navigateOnwards(router, redirectTo);
          } else {
            setNotice(SIGN_UP_GENERIC);
          }
          return;
        }
        // With verification REQUIRED (production) no session comes back, both
        // outcomes show the same generic notice, and nothing is observable —
        // the enumeration-safety property this copy exists for. When
        // verification is off, Better Auth signs the new account straight in;
        // an invitee must then be carried to their camp rather than left
        // staring at "check your inbox", so we follow the session we were
        // handed. (Only the invite flow moves; the plain sign-up path keeps its
        // existing stay-and-notice behaviour byte for byte.)
        // A SESSION CAME BACK — verification is off, so Better Auth signed the
        // new account straight in. Carry them onward.
        //
        // Showing SIGN_UP_GENERIC here instead was a dead end, and it is the
        // defect that running the suite against a real database finally
        // surfaced: the account existed, the session cookie was set, and the
        // user was left staring at "check your inbox" on the auth page for a
        // verification email that this deployment structurally cannot send.
        // Every new burner at a no-mail demo hit it. `redirectTo` defaults to
        // "/", and the blocking gate routes them to the Burner Bio from there.
        //
        // The cost is that with verification OFF, a new address navigates while
        // an existing one shows the notice, so sign-up becomes an
        // account-existence oracle. That trade is unavoidable — with no mail
        // there is no third outcome — and it is the honest way round: a usable
        // sign-up beats a private one that nobody can complete. With
        // verification ON (production) no session comes back either way, both
        // paths fall through to the notice, and enumeration-safety holds.
        if (signUpData?.token) {
          navigateOnwards(router, redirectTo);
          return;
        }
        if (resumingInvite) {
          // No session (verification on) but an invite is pending: still go to
          // the same url the already-registered branch uses, so the two are
          // indistinguishable. `/join/continue` bounces a signed-out arrival to
          // sign-in.
          navigateOnwards(router, redirectTo);
          return;
        }
        setNotice(SIGN_UP_GENERIC);
        router.refresh();
        return;
      }

      const { data, error: signInError } = await authClient.signIn.email({
        email,
        password,
        callbackURL: redirectTo,
      });
      if (signInError) {
        setError(SIGN_IN_FAILED);
        return;
      }
      // With 2FA on, a correct password returns a challenge, not a session yet.
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        setNeedsTwoFactor(true);
        return;
      }
      navigateOnwards(router, redirectTo);
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
      // Better Auth keeps this callback in ITS OWN server-side state record; the
      // value never travels to Google, so the invite round trip stays private.
      await authClient.signIn.social({
        provider: "google",
        callbackURL: redirectTo,
      });
    } catch {
      setError(GENERIC_PROBLEM);
      setGooglePending(false);
    }
  }

  const busy = pending || googlePending;

  // 2FA gate: password verified, now the second factor. The shared challenge
  // offers both an authenticator code and a backup code, so a lost authenticator
  // is never a dead end.
  if (needsTwoFactor) {
    return (
      <AccountTwoFactorChallenge
        client={authClient}
        onVerified={() => navigateOnwards(router, redirectTo)}
      />
    );
  }

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

      {isSignUp ? null : (
        <div className="-mt-1 text-right">
          <Link
            href={`/auth/forgot-password${authQuery}`}
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
              href={`/auth/sign-in${authQuery}`}
              className="font-medium text-primary hover:underline"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link
              href={`/auth/sign-up${authQuery}`}
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
