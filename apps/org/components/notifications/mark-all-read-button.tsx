"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";

import { markAllNotificationsRead } from "@/lib/actions/notifications";

/** "Mark all read" — own inbox only (the action scopes to the session user). */
export function MarkAllReadButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled || pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markAllNotificationsRead();
          if (!result.ok) {
            toast.error("Could not mark them read", {
              description: result.error,
            });
            return;
          }
          router.refresh();
        })
      }
    >
      <CheckCheck aria-hidden />
      Mark all read
    </Button>
  );
}
