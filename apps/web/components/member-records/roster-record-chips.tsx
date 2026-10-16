"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, NotebookPen, UsersRound } from "lucide-react";
import type { DuplicateCandidate } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@quagga/ui/components/popover";
import { toast } from "@quagga/ui/components/toast";
import { duplicateHintSentence } from "@/lib/member-records-view";

// The roster's member-records chips (docs/member-records-spec.md, frame R2
// `cMHOt` desktop / `Xdabl` mobile 360).
//
// · "Notes N" — a COUNT, never text, rendered only when the server put a
//   count in `noteCounts` (note people only, never the viewer's own row).
// · "Possible duplicate" — a hint from similar names only, with a popover
//   whose one action hides the pair for the whole camp. Rendered only when
//   the server put the row in `duplicates` (roster viewers only); the
//   dismissal re-decides from the database on every call.

/** A dismissal server action taking an untrusted payload. */
export type DismissDuplicateAction = (
  raw: unknown,
) => Promise<{ ok: true } | { ok: false; error: string }>;

/** The "Notes N" count chip. */
export function NoteCountChip({ count }: { count: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
      data-testid="roster-note-count"
    >
      <NotebookPen className="h-3 w-3" aria-hidden />
      Notes {count}
      <span className="sr-only">
        {count === 1 ? "private note" : "private notes"}
      </span>
    </span>
  );
}

function DismissPair({
  slug,
  name,
  userId,
  other,
  dismiss,
}: {
  slug: string;
  name: string;
  userId: string;
  other: DuplicateCandidate;
  dismiss: DismissDuplicateAction;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  function run() {
    startTransition(async () => {
      const result = await dismiss({ slug, userIds: [userId, other.userId] });
      if (result.ok) {
        toast.success("Hint hidden for the camp");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 border-border [&:not(:first-of-type)]:border-t [&:not(:first-of-type)]:pt-3">
      <p className="text-sm">{duplicateHintSentence(name, other)}</p>
      <p className="text-xs text-muted-foreground">
        This is only a hint from the names. Nothing is merged or changed.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="self-start max-sm:self-stretch"
        onClick={run}
        disabled={isPending}
      >
        {isPending ? "Hiding…" : "Not the same person"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Hides this hint for the whole camp.
      </p>
    </div>
  );
}

/**
 * The "Possible duplicate" chip and its dismiss popover: one sentence per
 * similar-named member (usually one), each with "Not the same person".
 */
export function PossibleDuplicateChip({
  slug,
  userId,
  name,
  others,
  dismiss,
}: {
  slug: string;
  userId: string;
  name: string;
  others: DuplicateCandidate[];
  dismiss: DismissDuplicateAction;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="roster-possible-duplicate"
        >
          <UsersRound className="h-3 w-3" aria-hidden />
          Possible duplicate
          <ChevronDown className="h-3 w-3" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3"
      >
        <p className="flex items-center gap-2 text-sm font-semibold">
          <UsersRound className="h-4 w-4 text-warning" aria-hidden />
          Possible duplicate
        </p>
        {others.map((other) => (
          <DismissPair
            key={other.userId}
            slug={slug}
            name={name}
            userId={userId}
            other={other}
            dismiss={dismiss}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}
