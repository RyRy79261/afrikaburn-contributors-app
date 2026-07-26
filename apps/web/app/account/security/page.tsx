import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@quagga/ui/components/card";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { requireCampUser } from "@/lib/session";
import {
  deviceLabel,
  getTwoFactorEnabled,
  listAccountPasskeys,
  listAccountSessions,
  listLinkedAccounts,
} from "@/lib/account";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { AccountShell } from "@/components/account/account-shell";
import { SessionList } from "@/components/account/session-list";
import { PasskeysCard, TwoFactorCard } from "@/components/account/security-factors";
import { listSecurityEvents } from "./events";

// /account/security — Security (canvas frame G35eq + mobile JbB35).
//
// SELF-HOSTED, SO THE REAL FLOWS SHIP. This page used to render honest "not
// available" cards for 2FA and passkeys because managed Neon Auth forbade Better
// Auth server plugins. Now that we self-host (@quagga/auth), migration 0015 wired
// the twoFactor and @better-auth/passkey plugins, so both cards are the genuine
// article: the canvas 2FA flow (QR + setup key + 6-digit verify + backup codes
// shown once) and passkey registration/removal. The cards live in @quagga/ui so
// org. and suppliers. render exactly the same UI. AUTH_CAPABILITIES marks all of
// them `supported`; if that ever regresses, the shared components fail closed via
// the client's own `{ data, error }` results.
//
// Active sessions and revocation remain real (database sessions).

export const dynamic = "force-dynamic";

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function AccountSecurityPage() {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Your account security" />
      </AppShell>
    );
  }

  const user = await requireCampUser();
  const [sessions, events, twoFactorEnabled, passkeys, linked] =
    await Promise.all([
      listAccountSessions(),
      listSecurityEvents(user.id),
      getTwoFactorEnabled(user.authUserId),
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
      {/* --- Two-factor: the real TOTP enrolment flow (shared component). --- */}
      <TwoFactorCard
        enabled={twoFactorEnabled}
        requiresPassword={requiresPassword}
      />

      {/* --- Passkeys: real registration/removal (shared component). --- */}
      <PasskeysCard passkeys={passkeys} />

      {/* --- Active sessions: REAL. --- */}
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

      {/* --- Security events: real rows only, with the gap named. --- */}
      <Card>
        <CardHeader>
          <CardTitle>Recent security events</CardTitle>
          <CardDescription>
            What&rsquo;s happened to your account. We email you when these occur.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {events.length === 0 ? (
            <EmptyState
              title="Nothing to report"
              description="Password changes, password resets, email-change requests and deletion requests all land here — and in your inbox — the moment they happen."
            />
          ) : (
            <ul className="flex flex-col">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-start justify-between gap-3 border-b border-border py-3 last:border-b-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{event.title}</p>
                    {event.body ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {event.body}
                      </p>
                    ) : null}
                  </div>
                  <p className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(event.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            This is a log of security actions on your account — password changes,
            sign-outs, email-change steps and deletion requests — recorded as they
            happen. New-device sign-in alerts aren&rsquo;t switched on yet
            (we&rsquo;d have to remember every device you&rsquo;ve used, and we
            don&rsquo;t), so the active-session list above is the reliable place to
            spot a sign-in you don&rsquo;t recognise.
          </p>
        </CardContent>
      </Card>
    </AccountShell>
  );
}
