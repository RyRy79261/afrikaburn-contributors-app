"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pin, PinOff } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";
import type { AnnouncementActionResult } from "@/app/(app)/camps/[slug]/announcements/actions";

// Pin / unpin a delivered announcement. The server's compare-and-set names the
// state it expects, so a stale page (someone else already pinned it) gets a
// sentence rather than silently overwriting.

export function AnnouncementPinToggle({
  slug,
  id,
  pinned,
  action,
}: {
  slug: string;
  id: string;
  pinned: boolean;
  action: (raw: unknown) => Promise<AnnouncementActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function toggle() {
    startTransition(async () => {
      const result = await action({ slug, id, pinned: !pinned });
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success(pinned ? "Unpinned." : "Pinned to the camp dashboard.");
      }
      router.refresh();
    });
  }

  return (
    <Button variant="secondary" size="sm" onClick={toggle} disabled={pending}>
      {pinned ? (
        <PinOff className="h-4 w-4" aria-hidden />
      ) : (
        <Pin className="h-4 w-4" aria-hidden />
      )}
      {pinned ? "Unpin" : "Pin to dashboard"}
    </Button>
  );
}
