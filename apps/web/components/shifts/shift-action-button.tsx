"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";
import type { ShiftActionResult } from "@/app/(app)/camps/[slug]/shifts/actions";

// One button that runs one shift action (epic #57): sign up, take it, accept,
// decline, withdraw, take someone off, delete. The server decides; this only
// says what happened. A `confirm` label turns it into a two-step button for
// the destructive ones (the pattern LeaveCampButton uses).

export function ShiftActionButton({
  action,
  payload,
  children,
  pendingLabel,
  successMessage,
  confirm,
  redirectTo,
  variant = "secondary",
  size = "sm",
  className,
}: {
  action: (raw: unknown) => Promise<ShiftActionResult>;
  payload: Record<string, unknown>;
  children: React.ReactNode;
  pendingLabel?: string;
  successMessage?: string;
  /** Ask "Sure?" first, with this label on the confirming button. */
  confirm?: string;
  redirectTo?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState(false);

  function run() {
    startTransition(async () => {
      const result = await action(payload);
      setConfirming(false);
      if (!result.ok) {
        toast.error(result.error);
        router.refresh();
        return;
      }
      if (successMessage) toast.success(successMessage);
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    });
  }

  if (confirm && confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Sure?</span>
        <Button
          type="button"
          variant="destructive"
          size={size}
          onClick={run}
          disabled={pending}
        >
          {pending ? (pendingLabel ?? "Working…") : confirm}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size={size}
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={pending}
      onClick={confirm ? () => setConfirming(true) : run}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </Button>
  );
}
