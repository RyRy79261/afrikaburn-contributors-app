"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarX } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@quagga/ui/components/dialog";
import { toast } from "@quagga/ui/components/toast";
import { cn } from "@quagga/ui/lib/utils";
import { cancelMeetingAction } from "@/app/(app)/camps/[slug]/meetings/actions";
import { useMeetingVersion } from "./meeting-version";

/** "Cancel meeting" with its confirm dialog (frame G2 state 2). */
export function CancelMeetingButton({
  slug,
  meetingId,
  className,
}: {
  slug: string;
  meetingId: string;
  /** Extra classes for the trigger button (e.g. its width on a phone). */
  className?: string;
}) {
  const router = useRouter();
  const { version, announceWrite } = useMeetingVersion();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  /** Cancels at the version this page holds, then re-renders the page. */
  function confirm() {
    startTransition(async () => {
      const r = await cancelMeetingAction({
        slug,
        id: meetingId,
        expectedVersion: version,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      announceWrite(version, r.version);
      setOpen(false);
      toast.success("Meeting cancelled. Everyone it was for got a notice.");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className={cn("text-destructive", className)}>
          <CalendarX className="h-4 w-4" aria-hidden />
          Cancel meeting
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this meeting?</DialogTitle>
          <DialogDescription>
            Everyone it&apos;s for gets a notice. The agenda and notes stay
            readable, and the meeting moves to Past and cancelled. A cancelled
            meeting can&apos;t be brought back.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Keep meeting
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? "Cancelling…" : "Cancel meeting"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
