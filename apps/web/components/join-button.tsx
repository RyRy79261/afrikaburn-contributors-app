"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";
import type { RedeemActionResult } from "@/app/join/[token]/actions";

interface JoinButtonProps {
  token: string;
  label: string;
  action: (raw: unknown) => Promise<RedeemActionResult>;
}

export function JoinButton({ token, label, action }: JoinButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  function redeem() {
    startTransition(async () => {
      const result = await action({ token });
      if (result.ok) {
        toast.success("Welcome aboard");
        router.push(`/camps/${result.slug}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button onClick={redeem} disabled={isPending} size="lg">
      {isPending ? "Joining…" : label}
    </Button>
  );
}
