import { redirect } from "next/navigation";
import {
  AUTH_CAPABILITIES,
  capabilityVerdict,
  EMAIL_CHANGE_REVOCATION_HOURS,
  ORG_RANK_LABELS,
  capabilityPendingMessage,
} from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { AccountCapabilityNotice } from "@quagga/ui/components/account-capability-notice";

import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { resolveConsoleAccount, listLinkedAccounts } from "@/lib/account";
import { resolveOrgSession } from "@/lib/session";
import { NotConfiguredBanner } from "@/components/not-configured-banner";
import {
  githubConfigured,
  transcriptionConfigured,
} from "@quagga/core/report-server";
import { ReportSettingsCard } from "@quagga/ui/components/report-settings-card";
import { AccountShell } from "@/components/account/account-shell";
import { SignInMethods } from "@/components/account/account-clients";

// /account — a staff member's own account, in the console (roadmap M4-21).
//
// Deliberately NARROWER than the participant app's version of this page. That
// one also owns the email-change flow; this one names the sign-in email and
// stops, because change-email is a token-and-grace-period flow with one
// implementation and adding a second entry point would be adding a second place
// for its guards to be forgotten.
//
// The org standing shown here is READ-ONLY and is not a permission control: it
// tells the reader which door this account came in by, so "why can I see this?"
// has an answer on the page about the account rather than only in the console
// nav. Editing it lives in /accounts, guarded by the System manager.

export const dynamic = "force-dynamic";

function Row({
  label,
  value,
  help,
  action,
}: {
  label: string;
  value: React.ReactNode;
  help?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <div className="mt-1 text-sm text-foreground">{value}</div>
        {help ? (
          <div className="mt-1 text-xs text-muted-foreground">{help}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export default async function OrgAccountPage() {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  if (!isDatabaseConfigured()) {
    return (
      <AccountShell
        active="manage"
        title="Account"
        description="Manage how you sign in to the organiser console."
      >
        <NotConfiguredBanner />
      </AccountShell>
    );
  }

  const [account, linked, orgState] = await Promise.all([
    resolveConsoleAccount(),
    listLinkedAccounts(),
    resolveOrgSession(),
  ]);
  if (!account) redirect("/auth/sign-in");

  const password = linked.find((a) => a.providerId === "credential");
  const google = linked.find((a) => a.providerId === "google");
  const emailChangeCap = AUTH_CAPABILITIES.emailChange;

  return (
    <AccountShell
      active="manage"
      title="Account"
      description="Manage how you sign in to the organiser console. It's the same AfrikaBurn account you use everywhere else."
    >
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            How we reach you, and how you got in.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col">
          <Row
            label="Email"
            value={
              account.email ?? (
                <span className="text-muted-foreground">
                  No email on record
                </span>
              )
            }
            help={`How you sign in, and where security notices go. When changing it lands, we'll confirm from the new address, warn the old one, and give you ${EMAIL_CHANGE_REVOCATION_HOURS} hours to undo it before the change sticks.`}
            action={
              <Button
                variant="outline"
                size="sm"
                disabled
                title={capabilityPendingMessage(emailChangeCap)}
              >
                Change email
              </Button>
            }
          />

          <Row
            label="Console access"
            value={
              orgState.kind === "ok" ? (
                <Badge
                  variant={orgState.role === "god" ? "default" : "secondary"}
                >
                  {ORG_RANK_LABELS[orgState.role]}
                </Badge>
              ) : (
                <span className="text-muted-foreground">
                  No console access on this account
                </span>
              )
            }
            help={
              orgState.kind === "ok"
                ? orgState.actor.roles.length === 0
                  ? "You can open the console. What you may DO in it comes from your org roles, and you hold none yet — ask a System manager."
                  : `Your org roles: ${orgState.actor.roles.map((r) => r.name).join(" · ")}. They decide what you may do in the console; this page only covers how you sign in.`
                : "You can still manage your sign-in here. Console access is granted by a System manager on the Accounts page."
            }
          />

          <div className="pt-4">
            <AccountCapabilityNotice
              verdict={capabilityVerdict(emailChangeCap)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sign-in methods</CardTitle>
          <CardDescription>
            At least one method must stay active on your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignInMethods
            hasPassword={Boolean(password)}
            passwordAddedAt={password?.createdAt?.toISOString() ?? null}
            googleLinked={Boolean(google)}
            googleEmail={null}
            methodCount={linked.length}
          />
        </CardContent>
      </Card>

      {/* Last card on the page, as drawn. The corner pill is how a report gets
          filed; this is where somebody who wants to know what one SENDS can
          read it without starting one. */}
      <ReportSettingsCard
        filingEnabled={githubConfigured()}
        dictationEnabled={transcriptionConfigured()}
      />
    </AccountShell>
  );
}
