"use client";

import { useEffect, useState, useTransition } from "react";
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
 * capability — but the CAPABILITY SENTENCE ITSELF IS NOT REPEATED HERE.
 *
 * This panel takes a boolean, not the refusal prose, and that is deliberate. The
 * rail already prints the department refusal once, in whichever card is showing
 * it: the Decision card while the registration is undecided, the Wrangler card
 * once it is approved. Passing the same paragraph into every card is how a rail
 * becomes something nobody reads — `assign-wrangler.tsx` and `suppliers-table.tsx`
 * both say so ("the reason is stated ONCE"), and a strict-mode e2e assertion
 * caught the third copy before a person had to.
 */
export function PlacementPanel({
  registrationId,
  campCode,
  erf,
  suggestedCode,
  canAssign,
}: {
  registrationId: string;
  campCode: string | null;
  erf: string | null;
  /** A code derived from the camp name, offered when none is set yet. */
  suggestedCode: string;
  /** Whether this viewer may assign. The WHY is stated once elsewhere in the rail. */
  canAssign: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [codeDraft, setCodeDraft] = useState(campCode ?? "");
  const [erfDraft, setErfDraft] = useState(erf ?? "");

  const blocked = !canAssign;
  const dirty = codeDraft !== (campCode ?? "") || erfDraft !== (erf ?? "");

  // Adopt the persisted values when the row changes underneath us (another
  // reviewer's save, or our own after `router.refresh()`).
  useEffect(() => {
    setCodeDraft(campCode ?? "");
    setErfDraft(erf ?? "");
  }, [campCode, erf]);

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
      // ADOPT THE STORED FORM. The action normalizes (`mah-1` becomes `MAH1`),
      // and leaving the typed text on screen would show a value that was never
      // saved while `dirty` stayed true against no remaining change.
      setCodeDraft(result.campCode ?? "");
      setErfDraft(result.erf ?? "");
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
          Assigning placement needs the same access as deciding this
          registration.
        </p>
      ) : (
        <Button size="sm" onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save placement details"}
        </Button>
      )}
    </div>
  );
}
