"use client";

import { ExternalLink, ShieldAlert, Trash2 } from "lucide-react";
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from "@quagga/ui/components/responsive-data-table";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { cn } from "@quagga/ui/lib/utils";
import { deriveOnboardingProgress, standingLabel } from "@quagga/core";
import type { SupplierOverviewRow } from "@/lib/queries";
import { SupplierStandingSelect } from "./supplier-standing-select";
import { SupplierNotesDrawer } from "./supplier-notes-drawer";
import { SupplierDeleteButton } from "./supplier-delete-button";
import { SupplierOnboardingStepList } from "./supplier-onboarding-steps";

/** The one restriction sentence every disabled bin icon points at. */
const DELETE_REFUSAL_ID = "supplier-delete-refusal";

/**
 * The supplier repository table (supplier model v2). Columns: supplier ·
 * onboarding n/7 (incomplete highlighted) · standing (inline select) · notes
 * (count → drawer). Each row expands to the per-step onboarding detail with the
 * org-side confirm/review actions. No source/vetting anywhere.
 *
 * Rendered through `ResponsiveDataTable`, so the same column declaration gives
 * the desktop table and the stacked card the mobile frame draws (`hSNjO`, whose
 * header row is disabled and whose rows stack Supplier / Onboarding / Standing
 * / Notes). Expansion, the standing select and the notes drawer all work in
 * both layouts — the primitive owns the chevron and the open set.
 *
 * REMOVAL IS RESTRICTED, VISIBLY — WHEN THE PAGE SAYS SO (`deleteRefusal`).
 * `deleteSupplier` asks for `delete` in the suppliers domain, and two kinds of
 * console account can never satisfy that: an engineer, whose rank carve-out
 * refuses deletion in every department, and anyone whose roles are scoped to a
 * department that does not own suppliers. The bin icon was offered to both, and
 * both could only learn the truth by pressing it and reading a toast — a
 * destructive-looking control that turns out to be decorative, which is the
 * worst of both worlds.
 *
 * Disabled rather than hidden, deliberately: the row still shows that removal
 * exists and the note under the table says whose job it is. A control that
 * vanishes teaches nobody that they were restricted — it teaches them the
 * console does not have the feature.
 */
export function SuppliersTable({
  suppliers,
  editionId,
  deleteRefusal,
}: {
  suppliers: SupplierOverviewRow[];
  editionId: string | null;
  /**
   * WHY THIS VIEWER MAY NOT REMOVE A SUPPLIER, in the words the server would
   * refuse them with — or null/omitted when they may.
   *
   * The page resolves it, because only the server has the actor:
   *
   *   deleteRefusal={
   *     orgCanInDomain(session.actor, "delete", "suppliers")
   *       ? null
   *       : orgCapabilityRefusal(session.actor, "delete", "suppliers")
   *   }
   *
   * OMITTING IT MEANS "NOT ASKED", and the control is offered exactly as it
   * always was — a caller that has not answered yet must not silently take a
   * removal away from the System managers and org staff who do hold it. That is
   * the only reason it is optional: a page that renders this table without
   * answering is a page that still shows a control it cannot honour.
   */
  deleteRefusal?: string | null;
}) {
  const columns: ResponsiveColumn<SupplierOverviewRow>[] = [
    {
      id: "supplier",
      header: "Supplier",
      role: "title",
      cellClassName: "font-medium",
      cell: (s) => (
        <div className="flex flex-col gap-1">
          <span>{s.name}</span>
          {(s.category || s.returning) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {s.category && <Badge variant="secondary">{s.category}</Badge>}
              {s.returning && (
                <Badge variant="outline">
                  {s.returning === "returning" ? "Returning" : "Newbie"}
                </Badge>
              )}
            </div>
          )}
          {s.services && (
            <span className="max-w-xs truncate text-xs font-normal text-muted-foreground">
              {s.services}
            </span>
          )}
          {s.website && (
            <a
              href={s.website}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1 text-xs font-normal text-accent hover:underline"
            >
              <ExternalLink className="h-3 w-3" aria-hidden />
              Website
            </a>
          )}
        </div>
      ),
    },
    {
      id: "onboarding",
      header: "Onboarding",
      align: "left",
      cell: (s) => {
        const progress = deriveOnboardingProgress(s.steps);
        return (
          <div className="flex flex-col items-start gap-1.5">
            <Badge variant={progress.isOnboarded ? "success" : "warning"}>
              {progress.completed}/{progress.total}
              {progress.isOnboarded ? " onboarded" : " incomplete"}
            </Badge>
            <div
              className="h-1.5 w-32 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={progress.completed}
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-label={`Onboarding ${progress.completed} of ${progress.total} steps`}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  progress.isOnboarded ? "bg-success" : "bg-warning",
                )}
                style={{
                  width: `${(progress.completed / progress.total) * 100}%`,
                }}
              />
            </div>
            {progress.awaiting > 0 && (
              <span className="text-xs text-muted-foreground">
                {progress.awaiting} awaiting confirmation
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "standing",
      header: "Standing",
      align: "left",
      cell: (s) => (
        <SupplierStandingSelect supplierId={s.id} value={s.standing} />
      ),
    },
    {
      id: "notes",
      header: "Notes",
      align: "right",
      cell: (s) => (
        <div className="flex items-center justify-end gap-1">
          <SupplierNotesDrawer
            supplierId={s.id}
            supplierName={s.name}
            count={s.notesCount}
          />
          {deleteRefusal ? (
            // The reason is stated ONCE under the table rather than on every
            // row — it is the same sentence for all of them, and a dense table
            // that repeats a paragraph per row is a table nobody reads. The
            // control is described by `aria-describedby` so a screen reader
            // reaches that sentence from the row it is on.
            <Button
              variant="ghost"
              size="sm"
              disabled
              aria-label={`Remove ${s.name} — not available to you`}
              aria-describedby={DELETE_REFUSAL_ID}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          ) : (
            <SupplierDeleteButton supplierId={s.id} supplierName={s.name} />
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <ResponsiveDataTable
        columns={columns}
        data={suppliers}
        getRowKey={(s) => s.id}
        caption="Supplier repository"
        renderExpanded={(s) => (
          <SupplierExpansion supplier={s} editionId={editionId} />
        )}
      />
      {deleteRefusal && (
        <p
          id={DELETE_REFUSAL_ID}
          className="flex items-start gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground"
        >
          <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{deleteRefusal}</span>
        </p>
      )}
    </>
  );
}

/** The per-step onboarding detail revealed under an expanded supplier row. */
function SupplierExpansion({
  supplier: s,
  editionId,
}: {
  supplier: SupplierOverviewRow;
  editionId: string | null;
}) {
  const progress = deriveOnboardingProgress(s.steps);
  const outstanding = progress.total - progress.completed;

  if (!editionId) {
    return (
      <p className="text-sm text-muted-foreground">
        No active edition — onboarding steps appear once an edition is active.
      </p>
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Onboarding status · {progress.completed}/{progress.total}
        </p>
        <p className="text-sm text-muted-foreground">
          {standingLabel(s.standing)} —{" "}
          {progress.isOnboarded
            ? "fully onboarded"
            : `${outstanding} step${outstanding === 1 ? "" : "s"} outstanding`}
        </p>
      </div>
      <SupplierOnboardingStepList
        supplierId={s.id}
        editionId={editionId}
        steps={s.steps}
      />
    </>
  );
}
