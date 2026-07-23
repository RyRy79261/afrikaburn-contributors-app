"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";

interface LeaveCampButtonProps {
  slug: string;
  action: (raw: unknown) => Promise<{ ok: boolean; error?: string }>;
}

export function LeaveCampButton({ slug, action }: LeaveCampButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  function leave() {
    startTransition(async () => {
      const result = await action({ slug });
      if (result.ok) {
        toast.success("You've left the camp");
        router.push("/directory");
      } else {
        toast.error(result.error ?? "Couldn't leave the camp");
        setConfirming(false);
      }
    });
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        <LogOut className="h-4 w-4" aria-hidden />
        Leave camp
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Sure?</span>
      <Button variant="destructive" size="sm" onClick={leave} disabled={isPending}>
        {isPending ? "Leaving…" : "Leave"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}
