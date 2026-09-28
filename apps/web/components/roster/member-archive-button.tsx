"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";

// Archive / restore a camp member from the roster (CDB-036, epic #55).
// NEEDS DESIGN REVIEW — built from existing components without a canvas frame:
// the button + inline "Sure?" confirm is the Leave-camp control's pattern
// (components/leave-camp-button.tsx), reused rather than a new dialog.
//
// Decides nothing. The row only renders this when the server's
// @quagga/core predicate said this viewer may act on it, and the action
// re-decides from the database on every call.

export type MemberArchiveAction = (
  raw: unknown,
) => Promise<{ ok: true } | { ok: false; error: string }>;

export function MemberArchiveButton({
  slug,
  membershipId,
  displayName,
  mode,
  action,
}: {
  slug: string;
  membershipId: string;
  displayName: string;
  mode: "archive" | "restore";
  action: MemberArchiveAction;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const archive = mode === "archive";

  function run() {
    startTransition(async () => {
      const result = await action({ slug, membershipId });
      if (result.ok) {
        toast.success(
          archive
            ? `${displayName} is now a former member`
            : `${displayName} is back in the camp`,
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
      setConfirming(false);
    });
  }

  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        aria-label={`${archive ? "Archive" : "Restore"} ${displayName}`}
      >
        {archive ? (
          <Archive className="h-4 w-4" aria-hidden />
        ) : (
          <ArchiveRestore className="h-4 w-4" aria-hidden />
        )}
        {archive ? "Archive" : "Restore"}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">
        {archive
          ? "They lose access to the camp. Sure?"
          : "They come back as a member, without their old roles. Sure?"}
      </span>
      <Button
        variant={archive ? "destructive" : "default"}
        size="sm"
        onClick={run}
        disabled={isPending}
      >
        {isPending
          ? archive
            ? "Archiving…"
            : "Restoring…"
          : archive
            ? "Archive"
            : "Restore"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}
