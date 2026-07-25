import { redirect } from "next/navigation";
import { ShieldCheck, ShieldQuestion } from "lucide-react";
import { AUTH_CAPABILITIES } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { requireCampUser } from "@/lib/session";
import { deviceLabel, listAccountSessions } from "@/lib/account";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { AccountShell } from "@/components/account/account-shell";
import { CapabilityNotice } from "@/components/account/capability-notice";
import { SessionList } from "@/components/account/session-list";
import { listSecurityEvents } from "./events";

// /account/security — Security (canvas frame G35eq + mobile JbB35).
//
// ⚠️ THE ONE THING THIS PAGE MUST NOT DO. The canvas shows a full three-step 2FA
// enrolment flow: QR code, secret key, 6-digit verification, eight backup codes.
// NONE of it can work. We run MANAGED Neon Auth, which does not permit Better
// Auth server plugins, and 2FA/TOTP and backup codes ship exclusively inside one
// (probe evidence: docs/accounts-security-spec.md §"Provider capability probe";
// zero occurrences of twoFactor/totp/backupCode anywhere in the SDK's types).
// A QR code we cannot verify, or eight "backup codes" that unlock nothing, would
// be worse than no 2FA at all: it would tell a burner their account is protected
// when it is not. So the card keeps the canvas SHAPE and the honest state, and
// carries no enrolment UI whatsoever. When Neon ships MFA, `twoFactor` flips to
// `supported` in @quagga/core AUTH_CAPABILITIES and the enrolment flow gets built
// behind that flag.
//
// Active sessions and revocation below ARE real — both are in the server
// endpoint allowlist.

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
  const [sessions, events] = await Promise.all([
    listAccountSessions(),
    listSecurityEvents(user.id),
  ]);

  const backupCodes = AUTH_CAPABILITIES.backupCodes;

  return (
    <AccountShell
      active="security"
      title="Security"
      description="Keep an eye on where you're signed in, and see what's happened to your account."
    >
      {/* --- Two-factor: honest unavailable state, no enrolment UI. --- */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <ShieldQuestion
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden
                />
                Two-factor authentication
              </CardTitle>
              <CardDescription className="mt-1.5">
                One-time codes from an authenticator app. We will never use SMS —
                SIM swaps are a real, common attack in South Africa.
              </CardDescription>
            </div>
            <Badge variant="outline">Not available</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <CapabilityNotice capability="twoFactor" />
          <p className="text-xs text-muted-foreground">
            {backupCodes.userMessage} This is blocked on our sign-in provider,
            not on us — there is no endpoint to call — and we&rsquo;d rather show
            you nothing than an enrolment screen that couldn&rsquo;t protect
            anything. Until it lands, the strongest thing you can do is a long,
            unique password and an occasional look at the session list below.
          </p>
        </CardContent>
      </Card>

      {/* --- Passkeys: same treatment, already phase 2 in the spec. --- */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden
                />
                Passkeys
              </CardTitle>
              <CardDescription className="mt-1.5">
                Sign in with your fingerprint or face instead of a password.
              </CardDescription>
            </div>
            <Badge variant="outline">Phase 2</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <CapabilityNotice capability="passkeys" />
        </CardContent>
      </Card>

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
            This feed is built from the security notices we&rsquo;ve actually
            sent you — we don&rsquo;t keep a separate event log. New-device
            sign-in alerts aren&rsquo;t switched on yet (we&rsquo;d have to
            remember every device you&rsquo;ve used, and we don&rsquo;t), so the
            active-session list above is the reliable place to spot a sign-in you
            don&rsquo;t recognise.
          </p>
        </CardContent>
      </Card>
    </AccountShell>
  );
}
