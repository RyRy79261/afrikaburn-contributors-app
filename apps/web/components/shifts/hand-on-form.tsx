"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Info, Megaphone, Send } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import { toast } from "@quagga/ui/components/toast";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import {
  handShiftToAction,
  offerShiftAction,
} from "@/app/(app)/camps/[slug]/shifts/actions";
import type { AssignCandidate } from "./assign-dialog";

// Hand on a shift (canvas S4 `UkKb6` / `iS0Nv`). No approval from a lead:
// either hand it to a campmate who has agreed (they accept, then it moves), or
// put it up as "needs a replacement" and the first eligible person to take it
// gets it. Either way the holder stays on it until it moves.

const optionCard =
  "h-auto flex-1 basis-56 flex-col items-start justify-start gap-0.5 border border-input px-3 py-2.5 text-left whitespace-normal";

export function HandOnForm({
  slug,
  shiftId,
  shiftName,
  candidates,
}: {
  slug: string;
  shiftId: string;
  shiftName: string;
  /** Campmates who can take it and are free then (server-computed). */
  candidates: AssignCandidate[];
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"hand" | "offer">(
    candidates.length > 0 ? "hand" : "offer",
  );
  const [to, setTo] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const back = `/camps/${slug}/shifts/mine`;

  function submit() {
    startTransition(async () => {
      const result =
        mode === "hand"
          ? await handShiftToAction({ slug, shiftId, toMembershipId: to })
          : await offerShiftAction({ slug, shiftId });
      if (!result.ok) {
        toast.error(result.error);
        router.refresh();
        return;
      }
      toast.success(
        mode === "hand"
          ? "Request sent — it's still yours until they accept."
          : "Posted to Open shifts — it's still yours until someone takes it.",
      );
      router.push(back);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium" id="hand-on-mode">
          What do you want to do?
        </span>
        <ToggleGroup
          type="single"
          aria-labelledby="hand-on-mode"
          value={mode}
          onValueChange={(v) => v && setMode(v as "hand" | "offer")}
          className="items-stretch"
        >
          <ToggleGroupItem value="hand" className={optionCard}>
            <span className="font-medium">Hand to someone</span>
            <span className="text-xs text-muted-foreground">
              Pick a campmate who has agreed. It moves to them when they
              accept.
            </span>
          </ToggleGroupItem>
          <ToggleGroupItem value="offer" className={optionCard}>
            <span className="font-medium">Needs a replacement</span>
            <span className="text-xs text-muted-foreground">
              It goes up in Open shifts. The first person to take it gets it.
            </span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {mode === "hand" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="hand-to" className="text-sm font-medium">
            Hand to
          </label>
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody else in the camp can take it at that time. Put it up for a
              replacement instead.
            </p>
          ) : (
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger id="hand-to" aria-label="Hand to">
                <SelectValue placeholder="Pick a campmate" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.membershipId} value={c.membershipId}>
                    {c.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-muted-foreground">
            Only campmates who are free then (and hold the role, if the shift
            needs one) are listed. Ask them first — they still have to accept.
          </p>
        </div>
      )}

      <p className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
        {mode === "hand" ? (
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        ) : (
          <Megaphone
            className="mt-0.5 h-4 w-4 shrink-0 text-primary"
            aria-hidden
          />
        )}
        <span>
          No approval needed. You stay on {shiftName} until{" "}
          {mode === "hand" ? "they accept" : "someone takes it"}, then
          it&apos;s theirs. Your camp&apos;s leads get a notice that it changed
          hands.
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={submit}
          disabled={pending || (mode === "hand" && !to)}
        >
          <Send className="h-4 w-4" aria-hidden />
          {pending
            ? "Sending…"
            : mode === "hand"
              ? "Send request"
              : "Put it up for a replacement"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push(back)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
