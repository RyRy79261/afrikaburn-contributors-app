import Link from "next/link";
import { redirect } from "next/navigation";
import { AUTH_CAPABILITIES, EMAIL_CHANGE_REVOCATION_HOURS } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import { getBio } from "@/lib/bio-store";
import { buildEmailChangeView, listLinkedAccounts } from "@/lib/account";
import { PreviewNotice } from "@/components/preview-notice";
import { AccountShell } from "@/components/account/account-shell";
import { CapabilityNotice } from "@/components/account/capability-notice";
import { SignInMethods } from "@/components/account/sign-in-methods";

// /account — Manage My Account (canvas frame SjInE + mobile U6ixd).
//
// Display name, sign-in email, and the linked sign-in methods. Everything that
// our managed Neon Auth instance can actually do is a live control; everything
// it cannot is an honest, inert explanation driven by AUTH_CAPABILITIES.
//
// The DISPLAY NAME is deliberately read-only here with a link to the Burner Bio
// rather than a second editor: the bio owns it (it is what a camp roster and the
// public profile render), and two writers for one field is how they drift apart.

export const dynamic = "force-dynamic";

const PHASE_NOTE: Record<string, string> = {
  awaiting_confirm:
    "Waiting on the new address to confirm. Nothing has changed on your account yet.",
  expired:
    "That confirmation link expired before it was used. Nothing changed on your account.",
  revocable:
    "Confirmed recently — still reversible from the link we emailed your old address.",
  settled: "Confirmed.",
  revoked: "Reversed from your old address. Your sign-in email is unchanged.",
  cancelled: "Cancelled or superseded. Your sign-in email is unchanged.",
};

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

export default async function AccountPage() {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  if (!isDatabaseConfigured()) {
    return <PreviewNotice feature="Your account settings" />;
  }

  // The edition and the linked sign-in methods do not depend on each other, and
  // only the bio needs the edition — so everything that can go out together
  // does, and only the bio waits.
  const [user, edition, linked] = await Promise.all([
    requireCampUser(),
    getActiveEdition(),
    listLinkedAccounts(),
  ]);
  const [bio, emailChange] = await Promise.all([
    edition ? getBio(user.id, edition.id) : null,
    buildEmailChangeView(user.id),
  ]);

  // The account-level handle, and ONLY that: the old fallback to the identity
  // provider's `name` quietly surfaced whatever the sign-up form put there
  // (usually the email local-part), which is not a name the burner chose.
  const username = bio?.username?.trim() || user.username?.trim() || null;
  const email = user.email ?? authUser.primaryEmail;

  const password = linked.find((a) => a.providerId === "credential");
  const google = linked.find((a) => a.providerId === "google");
  const emailChangeCap = AUTH_CAPABILITIES.emailChange;

  return (
    <AccountShell
      active="manage"
      title="Account"
      description="Manage how you sign in and how we reach you. These are the settings behind your Burner profile."
    >
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            How you appear and how we reach you.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col">
          <Row
            label="Username"
            value={
              username ?? (
                <span className="text-muted-foreground">Not set yet</span>
              )
            }
            help="Optional. How you appear on your camp roster and your public Burner profile. It lives in your Burner Bio, so it's edited there."
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/profile?edit=1">Edit in your bio</Link>
              </Button>
            }
          />

          <Row
            label="Email"
            value={
              email ?? (
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
                title={emailChangeCap.userMessage}
              >
                Change email
              </Button>
            }
          />

          <div className="pt-4">
            <CapabilityNotice capability="emailChange" />
          </div>

          {emailChange.phase !== "none" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <Badge variant="outline">Email change on record</Badge>
              <span>
                {emailChange.newEmail ? `${emailChange.newEmail} — ` : ""}
                {PHASE_NOTE[emailChange.phase] ?? "Recorded."}
                {emailChange.phase === "settled" && !emailChange.providerApplied
                  ? " Our records say confirmed, but the sign-in provider never applied it — you still sign in with your current address."
                  : ""}
              </span>
            </div>
          ) : null}
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
    </AccountShell>
  );
}
