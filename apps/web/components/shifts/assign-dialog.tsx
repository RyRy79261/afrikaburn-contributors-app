"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@quagga/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import { toast } from "@quagga/ui/components/toast";
import { cn } from "@quagga/ui/lib/utils";
import { assignToShiftAction } from "@/app/(app)/camps/[slug]/shifts/actions";

// A lead puts someone on a shift (epic #57). The candidate list is computed on
// the server with the same @quagga/core predicate the action enforces — people
// already on it, without the shift's camp role, or on another shift at that
// time are left out — so the picker never offers what would be refused.

export interface AssignCandidate {
  membershipId: string;
  displayName: string;
}

export function AssignDialog({
  slug,
  shiftId,
  shiftLabel,
  candidates,
  excludedNote,
  className,
  fullWidth,
}: {
  slug: string;
  shiftId: string;
  shiftLabel: string;
  candidates: AssignCandidate[];
  /** Why some members are not listed, when any are not. */
  excludedNote: string | null;
  className?: string;
  fullWidth?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [membershipId, setMembershipId] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const selectId = `assign-${shiftId}`;

  function submit() {
    if (!membershipId) return;
    startTransition(async () => {
      const result = await assignToShiftAction({
        slug,
        shiftId,
        membershipId,
      });
      if (!result.ok) {
        toast.error(result.error);
        router.refresh();
        return;
      }
      const who = candidates.find((c) => c.membershipId === membershipId);
      toast.success(`${who?.displayName ?? "They"} is on ${shiftLabel}.`);
      setOpen(false);
      setMembershipId("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(fullWidth && "w-full", className)}
        >
          <UserPlus className="h-4 w-4" aria-hidden />
          {fullWidth ? "Assign someone" : "Assign"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign someone</DialogTitle>
          <DialogDescription>
            {shiftLabel}. They get an in-app notice that you put them on it.
          </DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody in the camp can take this shift right now.
            {excludedNote ? ` ${excludedNote}` : ""}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <label htmlFor={selectId} className="text-sm font-medium">
              Who
            </label>
            <Select value={membershipId} onValueChange={setMembershipId}>
              <SelectTrigger id={selectId} aria-label="Who">
                <SelectValue placeholder="Pick a campmate" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.membershipId} value={c.membershipId}>
                    {c.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {excludedNote && (
              <p className="text-xs text-muted-foreground">{excludedNote}</p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || !membershipId}
          >
            {pending ? "Assigning…" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
