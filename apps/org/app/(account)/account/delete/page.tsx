import { redirect } from "next/navigation";
import { ORG_RANK_LABELS, type OrgRank } from "@quagga/core";
import { AccountDeleteElsewhere } from "@quagga/ui/components/account-delete-elsewhere";

import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured, participantAppUrl } from "@/lib/config";
import { getOrgAccountHoldings, resolveConsoleAccount } from "@/lib/account";
import { NotConfiguredBanner } from "@/components/not-configured-banner";
import { AccountShell } from "@/components/account/account-shell";

// /account/delete — present, honest, and not the place it happens (M4-21).
//
// The tab exists because leaving it out would say "an organiser account cannot
// be deleted", which is false: there is one AfrikaBurn account and it is
// deletable from the participant app. What this page adds is the part only the
// console knows — what the org loses — stated BEFORE somebody walks to another
// app and confirms.
//
// It states, it does not guard. `assessDeletionEligibility` runs over there,
// against camps led, registrations, supplier listings and org standing all at
// once, and it runs AGAIN at erasure time. A second guard here would be a second
// thing to keep in step with the first, for no extra safety.

export const dynamic = "force-dynamic";

function rankLabel(rank: string | null): string | null {
  if (!rank) return null;
  return ORG_RANK_LABELS[rank as OrgRank] ?? rank;
}

export default async function OrgAccountDeletePage() {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

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

  const account = await resolveConsoleAccount();
  if (!account) redirect("/auth/sign-in");

  const holdings = await getOrgAccountHoldings(account.id);
  const label = rankLabel(holdings.rank);

  // THE ONE CASE THAT IS A REFUSAL RATHER THAN A COST. A deployment with no live
  // System manager cannot be recovered from any screen — the console is
  // deliberately forbidden from granting `god` — so the participant app blocks
  // this deletion outright. Saying so here saves a wasted trip, and saying it
  // in the same words the block uses means the two cannot read as different
  // rules.
  const isLastSystemManager =
    holdings.isSystemManager && holdings.liveSystemManagers <= 1;

  return (
    <AccountShell
      active="delete"
      title="Delete your account"
      description="You can delete your AfrikaBurn account. It's done on the participant app, where the checks live."
    >
      <AccountDeleteElsewhere
        href={`${participantAppUrl()}/account/delete`}
        consequences={
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
            <li>
              {label
                ? `Your console access (${label}) is revoked — you lose the organiser console.`
                : "You have no console access on this account, so the console loses nothing."}
            </li>
            {holdings.roleCount > 0 ? (
              <li>
                Your {holdings.roleCount} org{" "}
                {holdings.roleCount === 1 ? "role" : "roles"}{" "}
                {holdings.roleCount === 1 ? "is" : "are"} released. Anything only
                you could do needs someone else assigned to it first.
              </li>
            ) : null}
            <li>
              Any camp you were wrangling is left unassigned — the camp keeps its
              registration, but nobody is shepherding it until a reviewer picks
              it up.
            </li>
            <li>
              Decisions you made stay in the audit trail. They are a record of
              what AfrikaBurn did, not personal data, so deleting your account
              does not rewrite them.
            </li>
          </ul>
        }
      />

      {isLastSystemManager ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm"
        >
          <p className="font-medium text-foreground">
            You are the only System manager, so this deletion will be refused.
          </p>
          <p className="mt-1 text-muted-foreground">
            A deployment with no System manager cannot be repaired from any
            screen — the console is deliberately not allowed to grant that rank,
            so the only way back would be an environment change and a fresh
            sign-up. Make somebody else a System manager first, then come back to
            this.
          </p>
        </div>
      ) : null}
    </AccountShell>
  );
}
