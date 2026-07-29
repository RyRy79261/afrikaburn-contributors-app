"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldQuestion } from "lucide-react";
import { officerConsentCopy } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";
import type { respondToOfficerAction } from "@/app/(app)/camps/[slug]/actions";

interface Invitation {
  roleId: string;
  officerName: string;
  emoji: string | null;
  /** `pending` — awaiting an answer; `accepted` — consent already given. */
  consent: "pending" | "accepted";
}

/**
 * The member's own officer registrations — the consent moment
 * (questionnaire-spec §"Officers are ALSO registrations") AND the consent they
 * have already given.
 *
 * Accepted roles are listed because CONSENT THAT CANNOT BE WITHDRAWN IS NOT
 * CONSENT. This banner used to disappear the instant someone pressed Accept,
 * leaving their phone number shared with AfrikaBurn and no control anywhere
 * that could stop it: the only other unassign path belongs to the camp lead, on
 * a settings page that 404s a plain member. To stop sharing their own number, a
 * person had to go and ask the person who had assigned them.
 */
export function OfficerConsentBanner({
  slug,
  invitations,
  respondAction,
}: {
  slug: string;
  invitations: Invitation[];
  respondAction: typeof respondToOfficerAction;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  function respond(roleId: string, accept: boolean) {
    startTransition(async () => {
      const res = await respondAction({ slug, roleId, accept });
      if (res.ok) {
        toast.success(
          accept
            ? "Thanks — you're registered."
            : "Withdrawn. AfrikaBurn no longer has your contact for that role.",
        );
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const pending = invitations.filter((i) => i.consent === "pending");
  const accepted = invitations.filter((i) => i.consent === "accepted");

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent/50 bg-accent/10 p-4">
      <div className="flex items-center gap-2">
        {pending.length > 0 ? (
          <ShieldQuestion className="h-5 w-5 text-accent" aria-hidden />
        ) : (
          <ShieldCheck className="h-5 w-5 text-accent" aria-hidden />
        )}
        <h2 className="text-sm font-semibold">
          {pending.length > 0
            ? "You've been asked to be a camp officer"
            : "Your camp officer roles"}
        </h2>
      </div>
      <ul className="flex flex-col gap-3">
        {pending.map((inv) => (
          <li
            key={inv.roleId}
            className="flex flex-col gap-2 rounded-md border border-border bg-card p-3"
          >
            <p className="text-sm font-medium">
              {inv.emoji ? `${inv.emoji} ` : ""}
              {inv.officerName}
            </p>
            <p className="text-xs text-muted-foreground">
              {officerConsentCopy(inv.officerName)}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => respond(inv.roleId, true)}
                disabled={isPending}
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => respond(inv.roleId, false)}
                disabled={isPending}
              >
                Decline
              </Button>
            </div>
          </li>
        ))}
        {accepted.map((inv) => (
          <li
            key={inv.roleId}
            className="flex flex-col gap-2 rounded-md border border-border bg-card p-3"
          >
            <p className="text-sm font-medium">
              {inv.emoji ? `${inv.emoji} ` : ""}
              {inv.officerName}
            </p>
            <p className="text-xs text-muted-foreground">
              You accepted this role, so AfrikaBurn can reach you on the contact
              details in your bio for it. Withdrawing stops that and frees the
              slot — your camp can ask you again, or name someone else.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => respond(inv.roleId, false)}
                disabled={isPending}
              >
                Withdraw consent
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
