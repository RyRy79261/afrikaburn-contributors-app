"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";
import type { carryForwardOnboardingAction } from "@/app/(app)/camps/[slug]/questionnaires/onboarding-actions";

/** "Carry forward from <edition>" (canvas A5): makes a DRAFT for this edition
 * and opens it in the builder. Sends nothing. */
export function CarryForwardButton({
  slug,
  sourceActivationId,
  editionName,
  action,
}: {
  slug: string;
  sourceActivationId: string;
  editionName: string;
  action: typeof carryForwardOnboardingAction;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  return (
    <Button
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await action({ slug, sourceActivationId });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          router.push(
            `/camps/${slug}/questionnaires/onboarding/${result.activationId}?carried=1`,
          );
        })
      }
    >
      <Copy className="h-4 w-4" aria-hidden />
      {isPending ? "Carrying forward…" : `Carry forward from ${editionName}`}
    </Button>
  );
}
