import { redirect } from "next/navigation";
import { describeSecurityEvent } from "@quagga/core";
import {
  deviceLabel,
  getTwoFactorEnabled,
  listSecurityEvents,
} from "@quagga/auth/account";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { AccountSecurityEvents } from "@quagga/ui/components/account-security-events";

import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import {
  listAccountPasskeys,
  listAccountSessions,
  listLinkedAccounts,
  resolveConsoleAccount,
} from "@/lib/account";
import { NotConfiguredBanner } from "@/components/not-configured-banner";
import { AccountShell } from "@/components/account/account-shell";
import {
  PasskeysCard,
  SessionList,
  TwoFactorCard,
} from "@/components/account/account-clients";

// /account/security — two-factor, passkeys, sessions and the security log, for
// an organiser (roadmap M4-21).
//
// THIS IS THE PAGE THE WHOLE TASK WAS FOR. Two-factor was the headline reason
// for self-hosting Better Auth, and until now it was reachable only from the
// participant app — which meant the accounts with the MOST power in this
// deployment, the ones that can approve registrations, read medical notes and
// grant org roles, were the accounts with no way to switch it on where they
// work. A System manager could lock down a burner's account and not their own.
//
// The cards are the shared ones, so the enrolment flow an organiser walks is
// byte-for-byte the flow a burner walks — no second implementation to drift, and
// no second place for a 2FA bug to hide.

export const dynamic = "force-dynamic";

/** Compose the one-line detail from the request context the log captured. */
function eventBody(userAgent: string | null, ip: string | null): string | null {
  const parts: string[] = [];
  if (userAgent) parts.push(deviceLabel(userAgent));
  if (ip) parts.push(ip);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export default async function OrgAccountSecurityPage() {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  if (!isDatabaseConfigured()) {
    return (
      <AccountShell
        active="security"
        title="Security"
        description="Keep an eye on where you're signed in."
      >
        <NotConfiguredBanner />
      </AccountShell>
    );
  }

  const account = await resolveConsoleAccount();
  if (!account) redirect("/auth/sign-in");

  const [sessions, events, twoFactorEnabled, passkeys, linked] =
    await Promise.all([
      listAccountSessions(),
      listSecurityEvents(account.id),
      getTwoFactorEnabled(account.authUserId),
      listAccountPasskeys(),
      listLinkedAccounts(),
    ]);

  // A password must be supplied to enable/disable 2FA only when the account
  // actually has a password credential; Google-only accounts enrol passwordless
  // (allowPasswordless in @quagga/auth).
  const requiresPassword = linked.some((a) => a.providerId === "credential");

  return (
    <AccountShell
      active="security"
      title="Security"
      description="Keep an eye on where you're signed in, and see what's happened to your account."
    >
      {/* --- The reason this suite exists in the console at all. --- */}
      <TwoFactorCard
        enabled={twoFactorEnabled}
        requiresPassword={requiresPassword}
      />

      <PasskeysCard passkeys={passkeys} />

      <Card>
        <CardHeader>
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>
            Devices signed in to your account. Revoke anything you don&rsquo;t
            recognise.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SessionList
            sessions={sessions.map((s) => ({
              token: s.token,
              label: deviceLabel(s.userAgent),
              ipAddress: s.ipAddress,
              lastSeen: (s.updatedAt ?? s.createdAt)?.toISOString() ?? null,
              current: s.current,
            }))}
          />
        </CardContent>
      </Card>

      <AccountSecurityEvents
        events={events.map((e) => ({
          id: e.id,
          title: describeSecurityEvent(e.kind),
          body: eventBody(e.userAgent, e.ip),
          createdAt: e.createdAt,
        }))}
        emptyDescription="Password changes, password resets and sign-outs all land here the moment they happen — whichever of the three apps you did them in."
        note={
          <>
            One account, one log: an action you took on the participant app or
            the supplier portal shows up here too, because it happened to this
            same account. New-device sign-in alerts aren&rsquo;t switched on yet
            (we&rsquo;d have to remember every device you&rsquo;ve used, and we
            don&rsquo;t), so the active-session list above is the reliable place
            to spot a sign-in you don&rsquo;t recognise.
          </>
        }
      />
    </AccountShell>
  );
}
