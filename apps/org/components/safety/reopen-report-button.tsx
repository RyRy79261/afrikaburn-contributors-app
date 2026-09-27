"use client";

import { useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "@quagga/ui/components/toast";
import { Button } from "@quagga/ui/components/button";
import { reopenMessageReportAction } from "@/lib/actions/message-reports";

/** Reopen a resolved direct-message report — the undo for a resolve made by
 * mistake. The server re-checks the safety capability; this button decides
 * nothing. Canvas: Org Safety Report Detail (dp5Yd / zsnrZ). */
export function ReopenReportButton({ reportId }: { reportId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await reopenMessageReportAction({ reportId });
          if (result.ok) toast.success("Report reopened.");
          else
            toast.error("Could not reopen this report", {
              description: result.error,
            });
        })
      }
    >
      <RotateCcw className="h-4 w-4" aria-hidden />
      Reopen
    </Button>
  );
}
