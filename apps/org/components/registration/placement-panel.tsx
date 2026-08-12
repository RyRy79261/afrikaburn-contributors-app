"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@quagga/ui/components/button";
import { Input } from "@quagga/ui/components/input";
import { toast } from "@quagga/ui/components/toast";
import { assignPlacement } from "@/lib/actions/placement";

/**
 * Staff-assigned camp code + erf (roadmap R1).
 *
 * NOT A PLACEMENT TOOL, and the copy says so rather than implying a map exists.
 * The erf is whatever AfrikaBurn's placement process decides it is — a free-text
 * label typed by the person who made the decision — because no structured erf
 * data exists to validate against (App Spec §13 is blocked on AB's mapping
 * process).
 *
 * DISABLED AND EXPLAINED rather than hidden when the viewer lacks the
 * capability, matching the wrangler panel beside it.
 */
export function PlacementPanel({
  registrationId,
  campCode,
  erf,
  suggestedCode,
  refusal,
}: {
  registrationId: string;
  campCode: string | null;
  erf: string | null;
  /** A code derived from the camp name, offered when none is set yet. */
  suggestedCode: string;
  /** Why this viewer may not assign, or null when they may. */
  refusal: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [codeDraft, setCodeDraft] = useState(campCode ?? "");
  const [erfDraft, setErfDraft] = useState(erf ?? "");

  const blocked = Boolean(refusal);
  const dirty = codeDraft !== (campCode ?? "") || erfDraft !== (erf ?? "");

  function save() {
    startTransition(async () => {
      const result = await assignPlacement({
        registrationId,
        campCode: codeDraft,
        erf: erfDraft,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Placement details saved.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="placement-camp-code"
          className="text-xs font-medium text-muted-foreground"
        >
          Camp code
        </label>
        <Input
          id="placement-camp-code"
          value={codeDraft}
          onChange={(e) => setCodeDraft(e.target.value)}
          placeholder={suggestedCode}
          disabled={blocked || pending}
          maxLength={8}
          aria-describedby={blocked ? "placement-refusal" : undefined}
        />
        <p className="text-xs text-muted-foreground">
          2–8 letters or digits, unique for this edition. Long-running camps keep
          the code they already answer to — {suggestedCode} is only a suggestion.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="placement-erf"
          className="text-xs font-medium text-muted-foreground"
        >
          Erf
        </label>
        <Input
          id="placement-erf"
          value={erfDraft}
          onChange={(e) => setErfDraft(e.target.value)}
          placeholder="e.g. K12"
          disabled={blocked || pending}
          maxLength={32}
          aria-describedby={blocked ? "placement-refusal" : undefined}
        />
        <p className="text-xs text-muted-foreground">
          Free text — whatever the placement meeting decided. There is no map
          behind this field yet.
        </p>
      </div>

      {blocked ? (
        <p id="placement-refusal" className="text-xs text-muted-foreground">
          {refusal}
        </p>
      ) : (
        <Button size="sm" onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save placement details"}
        </Button>
      )}
    </div>
  );
}
