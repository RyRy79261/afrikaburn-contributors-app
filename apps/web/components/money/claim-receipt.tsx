import { FileX } from "lucide-react";
import { ReceiptTile } from "./money-ui";
import { AttachReceiptButton } from "./receipt-input";

/** The receipt column of a claim (M3/M4): the tile when there is one; "Add"
 * for the claimant while it waits; otherwise a plain "No receipt". */
export function ClaimReceipt({
  slug,
  id,
  label,
  canAttach,
}: {
  slug: string;
  id: string;
  label: string | null;
  canAttach: boolean;
}) {
  if (label) return <ReceiptTile kind="claim" id={id} label={label} />;
  return (
    <div className="flex w-14 shrink-0 flex-col items-center gap-1 text-center text-[10px] text-muted-foreground">
      <span className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-border">
        <FileX className="h-4 w-4" aria-hidden />
      </span>
      {canAttach ? (
        <AttachReceiptButton slug={slug} kind="claim" id={id} label="Add" />
      ) : (
        <span>No receipt</span>
      )}
    </div>
  );
}
