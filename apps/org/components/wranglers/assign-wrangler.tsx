"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, UserCog, UserMinus } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import { toast } from "@quagga/ui/components/toast";
import { assignWrangler, unassignWrangler } from "@/lib/actions/wranglers";
import type { WranglerCandidate } from "@/lib/queries";

/** The one restriction sentence a refused control points at. */
const REFUSAL_ID = "wrangler-assign-refusal";

/**
 * Assign a camp's wrangler, on the registration review screen.
 *
 * This replaced a permanently DISABLED button that had promised "unlocks after
 * approval" since it was a stub — it never unlocked for anyone, at any status,
 * because there was nothing behind it (migration 0026 is what put something
 * there). Two different refusals now, and they say which one applies:
 *
 *   · NOT APPROVED YET. Real, and it is the server's rule, not this screen's:
 *     `assignWrangler` refuses anything that is not `approved`. AfrikaBurn
 *     assigns the wrangler when the Theme Camp Committee accepts, and our
 *     approval is that acceptance.
 *   · NOT YOURS. The viewer lacks `update` in the `registrations` domain — the
 *     same capability that decides the registration, because wrangling is the
 *     continuation of the review.
 *
 * DISABLED AND EXPLAINED rather than hidden, per Ryan (28 Jul 2026): "I'd rather
 * things be transparent with restrictions than completely obfuscated, except for
 * private personal information." Who wrangles a camp is not private.
 */
export function AssignWrangler({
  registrationId,
  candidates,
  currentWranglerUserId,
  isApproved,
  refusal,
}: {
  registrationId: string;
  candidates: WranglerCandidate[];
  currentWranglerUserId: string | null;
  isApproved: boolean;
  /** Why this viewer may not assign, or null when they may. */
  refusal: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string>(currentWranglerUserId ?? "");

  const blocked = Boolean(refusal) || !isApproved;
  const blockedReason = refusal
    ? refusal
    : "A camp gets its wrangler when its registration is approved.";

  function assign(userId: string) {
    setSelected(userId);
    startTransition(async () => {
      const result = await assignWrangler({
        registrationId,
        wranglerUserId: userId,
      });
      if (result.ok) {
        toast.success("Wrangler assigned.", {
          description: "The camp and the wrangler have both been told.",
        });
        router.refresh();
      } else {
        toast.error("Could not assign", { description: result.error });
        setSelected(currentWranglerUserId ?? "");
      }
    });
  }

  function unassign() {
    startTransition(async () => {
      const result = await unassignWrangler({ registrationId });
      if (result.ok) {
        // No notification goes out on removal, and the toast says so — a camp
        // told their guardian angel has gone, with no word on who is next, is
        // worse off than a camp told nothing.
        toast.success("Wrangler removed.", {
          description: "Nobody was notified — tell them yourself.",
        });
        setSelected("");
        router.refresh();
      } else {
        toast.error("Could not remove", { description: result.error });
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        A wrangler shepherds the camp through build week and check-in. One camp,
        one wrangler — assigning a different person replaces them.
      </p>

      <Select
        value={selected}
        onValueChange={assign}
        disabled={blocked || pending || candidates.length === 0}
      >
        <SelectTrigger
          id="wrangler-select"
          aria-label={
            blocked
              ? "Assign wrangler — not available to you"
              : "Assign wrangler"
          }
          aria-describedby={blocked ? REFUSAL_ID : undefined}
        >
          <UserCog className="h-4 w-4 text-muted-foreground" aria-hidden />
          <SelectValue placeholder="Nobody assigned" />
        </SelectTrigger>
        <SelectContent>
          {candidates.map((c) => (
            <SelectItem key={c.userId} value={c.userId}>
              {c.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {currentWranglerUserId && !blocked ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={unassign}
          disabled={pending}
          className="self-start"
        >
          <UserMinus className="h-4 w-4" aria-hidden />
          {pending ? "Removing…" : "Remove wrangler"}
        </Button>
      ) : null}

      {candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nobody can be assigned yet. An org account needs a username before it
          can hold a camp — otherwise the camp is told &ldquo;Unnamed burner is
          now your wrangler&rdquo; — and they set one in their own Burner Bio.
        </p>
      ) : null}

      {blocked ? (
        <p
          id={REFUSAL_ID}
          className="flex items-start gap-2 text-xs text-muted-foreground"
        >
          <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{blockedReason}</span>
        </p>
      ) : null}
    </div>
  );
}
