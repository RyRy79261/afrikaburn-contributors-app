"use client";

import * as React from "react";
import Link from "next/link";
import { Fingerprint, KeyRound } from "lucide-react";
import { AUTH_CAPABILITIES } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { ChangePasswordForm } from "./change-password-form";

// Sign-in methods list (canvas SjInE §"Sign-in methods"): password, Google,
// passkeys.
//
// What is REAL here and what is not, per the capability probe:
//  • Password change — SUPPORTED. The inline form below genuinely changes it.
//  • Setting a FIRST password — not offered. The only password endpoint we have
//    is `change-password`, which requires the current one; a Google-only account
//    has none, and there is no `set-password` on a managed instance. Rather than
//    a form that would always fail, the row says so.
//  • Unlink — `client_only`, i.e. exposed on the browser client but absent from
//    the server allowlist and unverifiable server-side. The button is disabled
//    and carries the capability's own message.
//  • Passkeys — now REAL (self-hosted @better-auth/passkey, migration 0015). They
//    are set up and managed on the Security page, so this row just links there.
//
// The last-method rule is shown as a note AND enforced server-side in
// @quagga/core `canUnlinkSignInMethod` / `assessDeletionEligibility` — this list
// is not the security boundary.

export interface SignInMethodsProps {
  hasPassword: boolean;
  /** When the password credential was added, ISO — we do not know when it last CHANGED. */
  passwordAddedAt: string | null;
  googleEmail: string | null;
  googleLinked: boolean;
  /** Total linked methods, for the last-method rule. */
  methodCount: number;
}

function MethodRow({
  icon,
  title,
  detail,
  badge,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  detail: React.ReactNode;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 text-muted-foreground" aria-hidden>
            {icon}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{title}</p>
              {badge}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function SignInMethods({
  hasPassword,
  passwordAddedAt,
  googleEmail,
  googleLinked,
  methodCount,
}: SignInMethodsProps) {
  const [changing, setChanging] = React.useState(false);
  const isLastMethod = methodCount <= 1;
  const unlinkCap = AUTH_CAPABILITIES.unlinkAccount;

  return (
    <div className="flex flex-col">
      <MethodRow
        icon={<KeyRound className="h-4 w-4" />}
        title="Password"
        badge={
          hasPassword ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="outline">Not set</Badge>
          )
        }
        detail={
          hasPassword ? (
            passwordAddedAt ? (
              <>
                Added{" "}
                {new Date(passwordAddedAt).toLocaleDateString("en-ZA", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
                . We don&rsquo;t record when it last changed.
              </>
            ) : (
              <>You sign in with your email address and a password.</>
            )
          ) : (
            <>
              You sign in with Google. Adding a password isn&rsquo;t available
              yet — our sign-in provider only exposes a &ldquo;change
              password&rdquo; step, which needs a password to start from.
            </>
          )
        }
        action={
          hasPassword ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setChanging((v) => !v)}
            >
              {changing ? "Close" : "Change"}
            </Button>
          ) : null
        }
      >
        {hasPassword && changing ? (
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <ChangePasswordForm onDone={() => setChanging(false)} />
          </div>
        ) : null}
      </MethodRow>

      <MethodRow
        icon={
          <span className="flex h-4 w-4 items-center justify-center text-xs font-bold">
            G
          </span>
        }
        title="Google"
        badge={
          googleLinked ? (
            <Badge variant="success">Connected</Badge>
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )
        }
        detail={
          googleLinked ? (
            <>Connected{googleEmail ? ` · ${googleEmail}` : ""}.</>
          ) : (
            <>
              Not connected. Signing in with Google links it to this account
              automatically.
            </>
          )
        }
        action={
          googleLinked ? (
            <Button
              variant="ghost"
              size="sm"
              disabled
              title={unlinkCap.userMessage}
            >
              Unlink
            </Button>
          ) : null
        }
      />

      <MethodRow
        icon={<Fingerprint className="h-4 w-4" />}
        title="Passkeys"
        detail={
          <>
            Sign in with your fingerprint, face or device PIN. Set them up and
            manage them on the Security page.
          </>
        }
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href="/account/security">Manage</Link>
          </Button>
        }
      />

      <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        {isLastMethod
          ? "This is your only way to sign in — it can't be removed. Add another method first."
          : "At least one sign-in method must stay active on your account."}{" "}
        {unlinkCap.userMessage}
      </div>
    </div>
  );
}
