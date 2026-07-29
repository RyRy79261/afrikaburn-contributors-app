"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";
import type { closeQuestionnaireAction } from "@/app/(app)/camps/[slug]/questionnaires/actions";

/**
 * Recall an open camp questionnaire. Two-step, like the camp's other
 * irreversible control (`LeaveCampButton`) — closing cannot be undone from the
 * UI, and on a blocking send it changes what every recipient sees.
 *
 * `refusal` is the honest reason the viewer may not close this one (see the
 * owner's rule: restricted, not hidden). Passing it disables the button and
 * prints the reason beside it rather than making the control disappear.
 */
export function CloseQuestionnaireButton({
  slug,
  activationId,
  blocking,
  refusal,
  action,
}: {
  slug: string;
  activationId: string;
  /** A blocking send is currently locking recipients out of the app. */
  blocking: boolean;
  refusal?: string | null;
  action: typeof closeQuestionnaireAction;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  if (refusal) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled>
          <Lock className="h-4 w-4" aria-hidden />
          Close
        </Button>
        <span className="text-xs text-muted-foreground">{refusal}</span>
      </div>
    );
  }

  function close() {
    startTransition(async () => {
      const result = await action({ slug, activationId });
      if (result.ok) {
        toast.success("Questionnaire closed", {
          description:
            "Nobody still has to answer it. Answers already given are kept.",
        });
        setConfirming(false);
        router.refresh();
      } else {
        toast.error(result.error);
        setConfirming(false);
      }
    });
  }

  if (!confirming) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        <Lock className="h-4 w-4" aria-hidden />
        Close
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">
        {blocking
          ? "Close it? Recipients stop being blocked and can no longer answer."
          : "Close it? Nobody will be able to answer after this."}
      </span>
      <Button
        variant="destructive"
        size="sm"
        onClick={close}
        disabled={isPending}
      >
        {isPending ? "Closing…" : "Close"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(false)}
        disabled={isPending}
      >
        Cancel
      </Button>
    </div>
  );
}
