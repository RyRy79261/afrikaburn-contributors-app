"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";
import { closeActivation } from "@/lib/questionnaires/actions";

/** Close an open activation from the results view. */
export function CloseActivationButton({
  activationId,
}: {
  activationId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function close() {
    startTransition(async () => {
      const result = await closeActivation({ activationId });
      if (result.ok) {
        toast.success("Activation closed.");
        router.refresh();
      } else {
        toast.error("Could not close", { description: result.error });
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={close} disabled={pending}>
      <Lock aria-hidden />
      {pending ? "Closing…" : "Close"}
    </Button>
  );
}
