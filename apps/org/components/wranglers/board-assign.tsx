"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import { toast } from "@quagga/ui/components/toast";
import { assignWrangler } from "@/lib/actions/wranglers";
import type { WranglerCandidate } from "@/lib/queries";

/**
 * The board's per-row assign control.
 *
 * Every row on this screen is an APPROVED camp — the query says so — so unlike
 * the review screen there is no not-yet-approved refusal to draw here. The only
 * refusal is the capability one, and it disables the control in place with the
 * page's own sentence above rather than removing it: a reviewer who cannot
 * assign still needs to see WHO IS ASSIGNED, which is most of what this board is
 * for.
 *
 * The accessible name carries the camp so a screen-reader user working down the
 * table knows which row they are on — "Wrangler for Mad Hatters", not the
 * fifteenth unlabelled combobox on the page.
 */
export function BoardAssignWrangler({
  registrationId,
  campName,
  candidates,
  currentWranglerUserId,
  refusal,
}: {
  registrationId: string;
  campName: string;
  candidates: WranglerCandidate[];
  currentWranglerUserId: string | null;
  refusal: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string>(currentWranglerUserId ?? "");

  function assign(userId: string) {
    setSelected(userId);
    startTransition(async () => {
      const result = await assignWrangler({
        registrationId,
        wranglerUserId: userId,
      });
      if (result.ok) {
        toast.success(`Wrangler assigned to ${campName}.`);
        router.refresh();
      } else {
        toast.error("Could not assign", { description: result.error });
        setSelected(currentWranglerUserId ?? "");
      }
    });
  }

  return (
    <Select
      value={selected}
      onValueChange={assign}
      disabled={Boolean(refusal) || pending || candidates.length === 0}
    >
      <SelectTrigger
        aria-label={
          refusal
            ? `Wrangler for ${campName} — not available to you`
            : `Wrangler for ${campName}`
        }
      >
        <SelectValue placeholder="Nobody yet" />
      </SelectTrigger>
      <SelectContent>
        {candidates.map((c) => (
          <SelectItem key={c.userId} value={c.userId}>
            {c.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
