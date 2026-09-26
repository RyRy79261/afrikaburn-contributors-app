"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";

// "You registered last year — bring those answers across", for a mutant vehicle
// or an artwork (CREATIVE-019). The project twin of the camp banner
// (carry-forward-banner.tsx), with the same two promises:
//
//   · EXPLICIT, NOT AUTOMATIC — the lead presses a button;
//   · HONEST — it is a typing aid for a NEW registration, not a resubmission.
//     Nothing is submitted, and the questions that are new every year (and
//     every declaration) start empty, so the form cannot be submitted until
//     they are answered again.

export type ProjectCarryForwardActionResult =
  | {
      ok: true;
      filled: number;
      documents: number;
      documentsSkipped: number;
      source: { editionYear: number };
    }
  | { ok: false; error: string };

export function ProjectCarryForwardBanner({
  slug,
  sourceYear,
  editionYear,
  startsEmpty,
  action,
}: {
  slug: string;
  /** The edition being carried FROM. */
  sourceYear: number;
  /** The edition being registered FOR. */
  editionYear: number;
  /** Plain-language list of what starts empty for this kind. */
  startsEmpty: string;
  action: (slug: string) => Promise<ProjectCarryForwardActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [dismissed, setDismissed] = React.useState(false);

  if (dismissed) return null;

  function bringAcross() {
    startTransition(async () => {
      const result = await action(slug);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const docs =
        result.documents > 0
          ? ` and ${result.documents} safety document${result.documents === 1 ? "" : "s"} still in date`
          : "";
      const skipped =
        result.documentsSkipped > 0
          ? ` ${result.documentsSkipped} document${result.documentsSkipped === 1 ? " was" : "s were"} left behind — already attached, or the list is full.`
          : "";
      toast.success(
        `Brought ${result.filled} answer${result.filled === 1 ? "" : "s"}${docs} across from ${result.source.editionYear}. Check each one — nothing has been submitted.${skipped}`,
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
            You registered in {sourceYear}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            We can bring those answers across so you edit them instead of typing
            everything again.{" "}
            <strong>This is still a new registration for {editionYear}</strong>{" "}
            — you check every answer and submit it as usual. Only fields you
            haven&apos;t already answered get filled.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {startsEmpty} Safety documents come across only if they&apos;re
            still in force on the last day of {editionYear}&apos;s event.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              className="min-h-11"
              onClick={bringAcross}
              disabled={pending}
            >
              {pending
                ? "Bringing them across…"
                : `Bring ${sourceYear}'s answers across`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11"
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
