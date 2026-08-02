import { redirect } from "next/navigation";
import {
  AUTH_CAPABILITIES,
  capabilityPendingMessage,
  capabilityVerdict,
  EMAIL_CHANGE_REVOCATION_HOURS,
} from "@quagga/core";
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
import {
  getClaimedSupplier,
  listLinkedAccounts,
  resolvePortalAccount,
} from "@/lib/account";
import { NotConfiguredBanner } from "@/components/not-configured-banner";
import { AccountShell } from "@/components/account/account-shell";
import { SignInMethods } from "@/components/account/account-clients";

// /account — a supplier's own account, in the portal (roadmap M4-21).
//
// THE DISTINCTION THIS PAGE HAS TO HOLD: the person and the business are not the
// same record, and this app is otherwise almost entirely about the business.
// `suppliers.contact` is the BUSINESS's contact details — free text AfrikaBurn
// keeps about a vendor — while the email below is the PERSON's sign-in address.
// They are frequently the same string and are never the same thing, which is
// exactly why the claim path exists and why this page names which is which.
//
// Deliberately narrower than the participant app's version: change-email is a
// token-and-grace-period flow with one implementation, and this page names the
// address rather than offering a second way to change it.

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

export default async function SupplierAccountPage() {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/signin");

  if (!isDatabaseConfigured()) {
    return (
      <AccountShell
        active="manage"
        title="Account"
        description="Manage how you sign in to the supplier portal."
      >
        <NotConfiguredBanner />
      </AccountShell>
    );
  }

  const account = await resolvePortalAccount();
  if (!account) redirect("/signin");

  const [linked, supplier] = await Promise.all([
    listLinkedAccounts(),
    getClaimedSupplier(account.id),
  ]);

  const password = linked.find((a) => a.providerId === "credential");
  const google = linked.find((a) => a.providerId === "google");
  const emailChangeCap = AUTH_CAPABILITIES.emailChange;

  return (
    <AccountShell
      active="manage"
      title="Account"
      description="Manage how you sign in to the supplier portal. It's the same AfrikaBurn account you'd use anywhere else."
    >
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            How we reach you, and which listing this account holds.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col">
          <Row
            label="Sign-in email"
            value={
              account.email ?? (
                <span className="text-muted-foreground">
                  No email on record
                </span>
              )
            }
            help={`Yours, not your business's — it's how you sign in and where security notices go. When changing it lands, we'll confirm from the new address, warn the old one, and give you ${EMAIL_CHANGE_REVOCATION_HOURS} hours to undo it before the change sticks.`}
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
            label="Business listing"
            value={
              supplier?.name ?? (
                <span className="text-muted-foreground">
                  No listing claimed yet
                </span>
              )
            }
            help={
              supplier
                ? "Your business's own details — its name, contact and standing — live with the listing and are managed by AfrikaBurn, not from this page."
                : "Your account works either way. A listing is claimed when your verified email matches the contact details AfrikaBurn holds for a supplier."
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
    </AccountShell>
  );
}
