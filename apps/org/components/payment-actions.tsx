"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Ban, RotateCcw } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";
import type { PaymentStatus } from "@quagga/types";
import { setPaymentStatus } from "@/lib/actions/payments";

/** Reconcile / waive / reopen controls for a payment reference. */
export function PaymentActions({
  paymentId,
  status,
}: {
  paymentId: string;
  status: PaymentStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function set(next: PaymentStatus, verb: string) {
    startTransition(async () => {
      const result = await setPaymentStatus({ paymentId, status: next });
      if (result.ok) {
        toast.success(verb);
        router.refresh();
      } else {
        toast.error("Could not update payment", {
          description: result.error,
        });
      }
    });
  }

  if (status === "pending") {
    return (
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => set("reconciled", "Marked reconciled.")}
        >
          <Check aria-hidden />
          Reconcile
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => set("waived", "Waived.")}
        >
          <Ban aria-hidden />
          Waive
        </Button>
      </div>
    );
  }

  return (
    <div className="flex justify-end">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => set("pending", "Reopened as pending.")}
      >
        <RotateCcw aria-hidden />
        Reopen
      </Button>
    </div>
  );
}
