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
  resolvePortalAccount,
} from "@/lib/account";
import { NotConfiguredBanner } from "@/components/not-configured-banner";
import { AccountShell } from "@/components/account/account-shell";
import {
  PasskeysCard,
  SessionList,
  TwoFactorCard,
} from "@/components/account/account-clients";

// /account/security — two-factor, passkeys, sessions and the security log, for
// a supplier (roadmap M4-21).
//
// A supplier account holds a business's onboarding, its uploaded documents and
// AfrikaBurn's correspondence about it — and until now had no way to put a
// second factor on any of that from the app where the work happens. The cards
// are the shared ones, so the enrolment flow here is the same flow a burner and
// an organiser walk: no second implementation to drift, and no second place for
// a 2FA bug to hide.

export const dynamic = "force-dynamic";

/** Compose the one-line detail from the request context the log captured. */
function eventBody(userAgent: string | null, ip: string | null): string | null {
  const parts: string[] = [];
  if (userAgent) parts.push(deviceLabel(userAgent));
  if (ip) parts.push(ip);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export default async function SupplierAccountSecurityPage() {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/signin");

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

  const account = await resolvePortalAccount();
  if (!account) redirect("/signin");

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
            the organiser console shows up here too, because it happened to this
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
