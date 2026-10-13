"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen, ShieldAlert } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";
import { setWapRequestWindow } from "@/lib/actions/wap";

// Open or close Work Access Pass requests for the edition (frame W3's edition
// bar). Opening notifies every lead and co-lead with a submitted registration,
// so it asks once more before it sends; closing does not need to.

export function WapWindowControl({
  editionId,
  action,
  refusal,
}: {
  editionId: string;
  action: "open" | "close";
  /** Why this viewer may not change it, or null when they may. */
  refusal: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function run() {
    startTransition(async () => {
      const result = await setWapRequestWindow({ editionId, action });
      setConfirming(false);
      if (result.ok) {
        toast.success(
          action === "open"
            ? "Requests are open. The projects' leads have been told."
            : "Requests are closed.",
        );
        router.refresh();
      } else {
        toast.error("Could not change requests", {
          description: result.error,
        });
      }
    });
  }

  const disabled = Boolean(refusal) || pending;
  const Icon = action === "open" ? LockOpen : Lock;

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Notify every lead now?
          </span>
          <Button size="sm" onClick={run} disabled={disabled}>
            <Icon aria-hidden />
            Open and notify
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirming(false)}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant={action === "open" ? "default" : "outline"}
          onClick={() => (action === "open" ? setConfirming(true) : run())}
          disabled={disabled}
        >
          <Icon aria-hidden />
          {action === "open" ? "Open requests" : "Close requests"}
        </Button>
      )}
      {refusal && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{refusal}</span>
        </p>
      )}
    </div>
  );
}
