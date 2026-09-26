"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { AckRow } from "@quagga/ui/components/checkbox";
import { toast } from "@quagga/ui/components/toast";
import type { AcknowledgeResult } from "@/app/(app)/bulletins/[id]/actions";

// The must-acknowledge gate's control (epic #56), ported from Camp 404's
// acknowledgement gate. A tick box and one button — the ONLY way forward. The
// shell has already stripped its navigation (the gate is active), so the only
// other reachable action is signing out, exactly as on a blocking
// questionnaire. The button stays disabled until the box is ticked, and the
// server insists on the tick too.

export function AcknowledgeGate({
  announcementId,
  afterHref,
  action,
}: {
  announcementId: string;
  /** Where to go once acknowledged (the next gate, if any, takes over). */
  afterHref: string;
  action: (raw: unknown) => Promise<AcknowledgeResult>;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function acknowledge() {
    startTransition(async () => {
      const result = await action({ id: announcementId, confirmed });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Thanks — acknowledged.");
      router.push(afterHref);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <AckRow
        checked={confirmed}
        onChange={(e) => setConfirmed(e.currentTarget.checked)}
        disabled={pending}
      >
        I&apos;ve read and understood this announcement.
      </AckRow>
      <Button
        onClick={acknowledge}
        disabled={!confirmed || pending}
        className="self-start"
      >
        Acknowledge
      </Button>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Your camp needs you to acknowledge this before you carry on.
      </p>
    </div>
  );
}
