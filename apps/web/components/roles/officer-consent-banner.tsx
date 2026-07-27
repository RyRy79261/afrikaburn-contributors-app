"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldQuestion } from "lucide-react";
import { officerConsentCopy } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";
import type { respondToOfficerAction } from "@/app/(app)/camps/[slug]/actions";

interface Invitation {
  roleId: string;
  officerName: string;
  emoji: string | null;
}

/**
 * Surfaces pending officer registrations to the assigned member — the consent
 * moment (questionnaire-spec §"Officers are ALSO registrations"). Accepting
 * shares their contact with AfrikaBurn for the role; declining frees the slot.
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
        toast.success(accept ? "Thanks — you're registered." : "Declined.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent/50 bg-accent/10 p-4">
      <div className="flex items-center gap-2">
        <ShieldQuestion className="h-5 w-5 text-accent" aria-hidden />
        <h2 className="text-sm font-semibold">
          You&apos;ve been asked to be a camp officer
        </h2>
      </div>
      <ul className="flex flex-col gap-3">
        {invitations.map((inv) => (
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
      </ul>
    </div>
  );
}
