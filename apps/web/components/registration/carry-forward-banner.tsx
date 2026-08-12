"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";
import type { CarryForwardSource } from "@/lib/registration-store";
import { carryForwardRegistrationAction } from "@/app/(app)/camps/[slug]/registration/actions";

// "You registered last year — bring those answers across" (roadmap R1,
// previous-year duplication).
//
// THE OFFER IS EXPLICIT, NOT AUTOMATIC. Silently pre-filling a new year's form
// from an old one would mean a camp submitting last year's answers without ever
// deciding to, and a reviewer unable to tell a confirmed answer from a copied
// one. So the camp presses a button.
//
// AND THE COPY HAS TO BE HONEST ABOUT WHAT THIS IS. It is a typing aid, not a
// re-registration: the camp still makes a new proposal, still walks every step,
// still submits. Nothing is marked complete by carrying forward, and the banner
// says so — a camp that believed otherwise would sit on a draft it thought was
// finished until the deadline passed.

export function CarryForwardBanner({
  slug,
  source,
  editionYear,
}: {
  slug: string;
  source: CarryForwardSource;
  /** The edition being registered for — the year answers must be fresh FOR. */
  editionYear: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [dismissed, setDismissed] = React.useState(false);

  if (dismissed) return null;

  function bringAcross() {
    startTransition(async () => {
      const result = await carryForwardRegistrationAction(slug);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Brought ${result.filled} answer${result.filled === 1 ? "" : "s"} across from ${result.source.editionYear}. Go through each step and update it — nothing is marked complete.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="mb-6 rounded-lg border border-border bg-muted/40 p-4">
      <div className="flex items-start gap-3">
        <History
          className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            You registered in {source.editionYear}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            We can bring those answers across so you edit them instead of typing
            everything again. <strong>This is still a new registration for{" "}
            {editionYear}</strong> — you go through every step and submit it as
            usual. Nothing is marked done for you, and only fields you
            haven&apos;t already answered get filled.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Your size, arrival date, sound, placement preferences and layout
            diagram all start empty — those are new every year. So does the Plug
            &amp; Play acknowledgement, which you give fresh each edition.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={bringAcross} disabled={pending}>
              {pending
                ? "Bringing them across…"
                : `Bring ${source.editionYear}'s answers across`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDismissed(true)}
              disabled={pending}
            >
              Start fresh
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
