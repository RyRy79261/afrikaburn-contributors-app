"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, MessageCircle } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Message / Block / Unblock on another burner's profile (epic #69). The
 * server decided `canMessage` (@quagga/core `canStartConversation`, or an
 * existing chat); the start action re-checks it. NEEDS DESIGN REVIEW.
 */
export function ProfileMessageActions({
  targetUserId,
  name,
  canMessage,
  blockedByViewer,
  start,
  block,
  unblock,
}: {
  targetUserId: string;
  name: string;
  canMessage: boolean;
  blockedByViewer: boolean;
  start: (formData: FormData) => Promise<void>;
  block: (input: { targetUserId: string }) => Promise<Result>;
  unblock: (input: { targetUserId: string }) => Promise<Result>;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function toggleBlock() {
    setBusy(true);
    try {
      const result = blockedByViewer
        ? await unblock({ targetUserId })
        : await block({ targetUserId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        blockedByViewer ? `${name} is unblocked.` : `${name} is blocked.`,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canMessage && !blockedByViewer && (
        <form action={start}>
          <input type="hidden" name="targetUserId" value={targetUserId} />
          <Button type="submit" size="sm">
            <MessageCircle className="h-4 w-4" aria-hidden />
            Message
          </Button>
        </form>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => void toggleBlock()}
      >
        <Ban className="h-4 w-4" aria-hidden />
        {blockedByViewer ? `Unblock ${name}` : `Block ${name}`}
      </Button>
    </div>
  );
}
