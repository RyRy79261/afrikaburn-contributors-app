"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";

import { markAllNotificationsRead } from "@/lib/actions/notifications";

/**
 * "Mark all read" — the toolbar action on the portal inbox (canvas `swSq4`).
 * The server action clears only the gated supplier's own unread rows.
 */
export function MarkAllReadButton({
  unreadCount,
  className,
  onDone,
}: {
  unreadCount: number;
  className?: string;
  /** Fired after a successful mark-all (e.g. so the header panel can refetch). */
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      disabled={pending || unreadCount === 0}
      onClick={() =>
        startTransition(async () => {
          const result = await markAllNotificationsRead();
          if (result.ok) {
            toast.success("All caught up", {
              description: "Every notification is marked read.",
            });
            router.refresh();
            onDone?.();
            return;
          }
          toast.error("Could not mark them read", {
            description: result.error,
          });
        })
      }
    >
      <CheckCheck className="mr-1.5 h-4 w-4" aria-hidden />
      Mark all read
    </Button>
  );
}
