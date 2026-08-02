import { redirect } from "next/navigation";
import { AccountDeleteElsewhere } from "@quagga/ui/components/account-delete-elsewhere";

import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured, participantAppUrl } from "@/lib/config";
import { getClaimedSupplier, resolvePortalAccount } from "@/lib/account";
import { NotConfiguredBanner } from "@/components/not-configured-banner";
import { AccountShell } from "@/components/account/account-shell";

// /account/delete — present, honest, and not the place it happens (M4-21).
//
// The tab exists because leaving it out would say "a supplier account cannot be
// deleted", which is false. What this page adds is the part only the portal
// knows: what happens to the LISTING, which is the question a supplier will
// actually have and the one the participant app's generic copy cannot answer.
//
// It states, it does not guard. `assessDeletionEligibility` runs over there,
// over the whole account at once, and again at erasure time.

export const dynamic = "force-dynamic";

export default async function SupplierAccountDeletePage() {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/signin");

  if (!isDatabaseConfigured()) {
    return (
      <AccountShell
        active="delete"
        title="Delete your account"
        description="Deleting your AfrikaBurn account is handled on the participant app."
      >
        <NotConfiguredBanner />
      </AccountShell>
    );
  }

  const account = await resolvePortalAccount();
  if (!account) redirect("/signin");

  const supplier = await getClaimedSupplier(account.id);

  return (
    <AccountShell
      active="delete"
      title="Delete your account"
      description="You can delete your AfrikaBurn account. It's done on the participant app, where the checks live."
    >
      <AccountDeleteElsewhere
        href={`${participantAppUrl()}/account/delete`}
        consequences={
          supplier ? (
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
              <li>
                <strong className="font-medium text-foreground">
                  {supplier.name}
                </strong>{" "}
                is not deleted. The listing stays on AfrikaBurn&rsquo;s books —
                it&rsquo;s their record of a supplier, not your personal data —
                and its onboarding, documents and standing stay with it.
              </li>
              <li>
                What is released is your CLAIM on it. The listing goes back to
                unclaimed, and nobody can sign in to manage it until someone
                claims it again.
              </li>
              <li>
                It is re-claimed the same way you claimed it: whoever verifies an
                email address that the listing&rsquo;s contact details name can
                take it over. If that address was yours, it stays on the business
                record after your account is erased — so deleting your account
                does not stop the listing being claimed with it.
              </li>
            </ul>
          ) : (
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
              <li>
                This account holds no supplier listing, so nothing here is
                released.
              </li>
              <li>
                Deleting it still deletes your AfrikaBurn account everywhere —
                including anything you hold as a participant.
              </li>
            </ul>
          )
        }
      />
    </AccountShell>
  );
}
