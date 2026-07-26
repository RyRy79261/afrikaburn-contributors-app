"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "@quagga/ui/components/toast";
import { Button } from "@quagga/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quagga/ui/components/dialog";
import { deleteSupplier } from "@/lib/actions/suppliers";

// Removing a catalogue entry — for duplicates and bad imports.
//
// Confirmed, never one-click: this is destructive and irreversible, and the
// rows sit in a dense table where the delete control is a few pixels from the
// notes control. The dialog names the supplier so a misclick is caught by
// reading rather than by remembering which row you were on.
//
// The server decides whether it is allowed at all (a claimed listing, or one a
// camp declared on its registration, is refused with the reason). This button
// deliberately does not pre-empt that check — the refusal message IS the
// explanation, and duplicating the rule here would let the two drift.

export function SupplierDeleteButton({
  supplierId,
  supplierName,
}: {
  supplierId: string;
  supplierName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await deleteSupplier({ supplierId });
      if (result.ok) {
        toast.success(`Removed ${supplierName}.`);
        setConfirming(false);
      } else {
        // Kept open: the refusal explains what to do instead (rename it,
        // suspend the account), and closing would throw that away.
        toast.error("Could not remove this supplier", {
          description: result.error,
        });
      }
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        aria-label={`Remove ${supplierName}`}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </Button>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {supplierName}?</DialogTitle>
            <DialogDescription>
              This deletes the catalogue entry and its onboarding progress. It
              cannot be undone. A listing a supplier has claimed, or that a camp
              declared on its registration, will be refused — that history is
              not this screen&rsquo;s to erase.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={pending}
            >
              {pending ? "Removing…" : "Remove supplier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
