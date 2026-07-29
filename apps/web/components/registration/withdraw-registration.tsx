"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { canCampWithdraw } from "@quagga/core";
import type { RegistrationStatus } from "@quagga/types";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";
import type { TransitionResult } from "@/lib/registration-store";

// Withdrawal is the one camp-side action that survives into the LOCKED view.
// `approved → withdrawn` is a legal transition in the core state machine
// (registration-state.ts: "Approved — the entitlement-granting state; only a
// voluntary withdrawal"), but the only control that ever called it lived in the
// editable wizard, which an approved camp never sees. So a camp that pulled out
// after approval had no way to say so in the app at all.

/**
 * The confirm text for a withdrawal, per status. Shared with the wizard so the
 * same action never warns two different ways.
 *
 * Every claim here is checked against the schema and the state machine:
 * `registrations_group_edition_idx` is UNIQUE on (group, edition) so a camp
 * cannot hold a second registration for the edition — `registrations` is unique
 * on (group_id, edition_id) — so there is no "register again" in the sense of a
 * fresh row. What there IS, since `withdrawn → draft` became a legal transition,
 * is REOPENING the same registration from the locked summary: the answers are
 * kept and it goes back to the camp's own editable state, needing a fresh
 * submit and a fresh review. Approval does not survive that.
 */
export function withdrawConsequence(
  status: RegistrationStatus,
  editionYear: number,
): string {
  const finality =
    `A camp holds one registration per AfrikaBurn ${editionYear}, so this does ` +
    `not start a new one — it withdraws this one. You can reopen it from this ` +
    `page while the edition is open, which puts it back to a draft you have to ` +
    `submit and have reviewed again. Your camp itself stays, with its members ` +
    `and history.`;

  if (status === "approved") {
    return (
      `Withdraw this APPROVED registration?\n\n` +
      `You give up your camp's confirmed place for AfrikaBurn ${editionYear}, and ` +
      `the entitlements that approval unlocked go with it. Reopening does not ` +
      `give the approval back — it returns a draft.\n\n${finality}`
    );
  }
  if (status === "submitted" || status === "under_review") {
    return (
      `Withdraw this registration?\n\n` +
      `AfrikaBurn stops reviewing it and it won't be considered for placement.` +
      `\n\n${finality}`
    );
  }
  return (
    `Withdraw this registration?\n\n` +
    `It won't be considered for placement this edition.\n\n${finality}`
  );
}

/** Why the button is refused right now, or null when it isn't. */
function refusalReason(status: RegistrationStatus): string | null {
  if (canCampWithdraw(status)) return null;
  if (status === "under_review") {
    return "AfrikaBurn is reviewing this right now. You can withdraw once they've responded.";
  }
  return "This registration is already closed — there's nothing left to withdraw.";
}

export function WithdrawRegistrationButton({
  slug,
  status,
  editionYear,
  withdrawAction,
}: {
  slug: string;
  status: RegistrationStatus;
  editionYear: number;
  withdrawAction: (slug: string) => Promise<TransitionResult>;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  // Refused actions stay VISIBLE and disabled with the reason spelled out —
  // a camp lead hunting for a missing button learns nothing from an absence.
  const refusal = refusalReason(status);

  async function handleClick() {
    if (!window.confirm(withdrawConsequence(status, editionYear))) return;
    setBusy(true);
    const result = await withdrawAction(slug);
    setBusy(false);
    if (result.ok) {
      toast.success("Registration withdrawn.");
      router.refresh();
    } else {
      toast.error("Couldn't withdraw", { description: result.error });
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 border-t border-border pt-6">
      <Button
        type="button"
        variant="outline"
        onClick={handleClick}
        disabled={Boolean(refusal) || busy}
        className="text-muted-foreground hover:text-destructive"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Withdraw registration
      </Button>
      <p className="max-w-prose text-xs text-muted-foreground">
        {refusal ??
          `Withdrawing is final for AfrikaBurn ${editionYear} — a withdrawn registration can't be reopened or replaced.`}
      </p>
    </div>
  );
}
