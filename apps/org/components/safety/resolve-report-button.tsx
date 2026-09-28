"use client";

import { useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { toast } from "@quagga/ui/components/toast";
import { Button } from "@quagga/ui/components/button";
import { resolveMessageReportAction } from "@/lib/actions/message-reports";

/** Mark a direct-message report resolved. The server re-checks the safety
 * capability; this button decides nothing. Canvas: dp5Yd / zsnrZ. */
export function ResolveReportButton({ reportId }: { reportId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await resolveMessageReportAction({ reportId });
          if (result.ok) toast.success("Report marked resolved.");
          else
            toast.error("Could not resolve this report", {
              description: result.error,
            });
        })
      }
    >
      <CheckCircle2 className="h-4 w-4" aria-hidden />
      Mark resolved
    </Button>
  );
}
