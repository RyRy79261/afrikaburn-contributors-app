"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  FileText,
  Link2,
  Pencil,
  Trash2,
} from "lucide-react";
import type { SupplierDocumentSourceType } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@quagga/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";
import { Switch } from "@quagga/ui/components/switch";
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from "@quagga/ui/components/responsive-data-table";
import { toast } from "@quagga/ui/components/toast";

import {
  deleteSupplierDocument,
  updateSupplierDocument,
  type OrgSupplierDocumentRow,
} from "@/lib/actions/supplier-documents";
import { DocumentForm } from "./document-form";
import { BINDABLE_STEPS, UNBOUND_VALUE, asStepKey, stepLabel } from "./steps";

// The per-edition document table (canvas `U7929T`): title + source, source
// chip, required-ack toggle, bound-step select, reorder, edit, delete.
//
// RESPONSIVE. Declared once through `ResponsiveDataTable`, so the desktop table
// and the stacked card the mobile frame draws (`D6IGel`, row `QD5Dv`) come from
// the same column set. The mobile card drops the reorder column — the frame
// disables its drag grip there too, and up/down arrows are meaningless once the
// rows are cards — while the inline toggle, the step select and edit/delete all
// stay reachable.
//
// REORDERING. The canvas draws a drag grip. @quagga/ui ships no drag-and-drop
// primitive and this slice may not add dependencies, so the same intent is
// served by explicit move-up / move-down buttons — which are also the
// keyboard-accessible form of the interaction. Each move swaps the two rows'
// `sort` values through the ordinary update action, so ordering stays a stored
// fact rather than a client illusion.
//
// The inline toggle and step select are conveniences over the SAME
// `updateSupplierDocument` action the edit dialog uses: org-gated, validated in
// @quagga/core, audited. A rejected change (e.g. unbinding acknowledgement from
// a bound document) surfaces its real reason rather than silently reverting.

function sourceIcon(sourceType: SupplierDocumentSourceType) {
  return sourceType === "file" ? FileText : Link2;
}

/** Trim a URL to something readable in a table cell. */
function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const tail = `${parsed.pathname}${parsed.search}`;
    const path = tail === "/" ? "" : tail;
    const shown = `${parsed.host}${path}`;
    return shown.length > 64 ? `${shown.slice(0, 63)}…` : shown;
  } catch {
    return url.length > 64 ? `${url.slice(0, 63)}…` : url;
  }
}

export function DocumentsTable({
  documents,
  blobConfigured = false,
}: {
  documents: OrgSupplierDocumentRow[];
  blobConfigured?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editing, setEditing] = React.useState<OrgSupplierDocumentRow | null>(
    null,
  );

  /** Persist a change to one document, carrying its untouched fields through. */
  function save(
    doc: OrgSupplierDocumentRow,
    patch: Partial<
      Pick<OrgSupplierDocumentRow, "requiredAck" | "stepKey" | "sort">
    >,
    successMessage: string,
  ) {
    startTransition(async () => {
      const result = await updateSupplierDocument({
        documentId: doc.id,
        title: doc.title,
        sourceType: doc.sourceType,
        url: doc.url,
        requiredAck: patch.requiredAck ?? doc.requiredAck,
        stepKey: asStepKey(patch.stepKey ?? doc.stepKey),
        sort: patch.sort ?? doc.sort,
      });
      if (!result.ok) {
        toast.error("Could not save that change", { description: result.error });
        return;
      }
      toast.success(successMessage);
      router.refresh();
    });
  }

  /** Swap this row's sort with its neighbour in the given direction. */
  function move(index: number, direction: -1 | 1) {
    const doc = documents[index];
    const neighbour = documents[index + direction];
    if (!doc || !neighbour) return;
    startTransition(async () => {
      // Two updates, neighbour first: if the second fails the list is still
      // ordered (both rows may briefly share a sort value, which the catalog
      // ordering tie-breaks by title — never a crash, never a silent reorder).
      const first = await updateSupplierDocument({
        documentId: neighbour.id,
        title: neighbour.title,
        sourceType: neighbour.sourceType,
        url: neighbour.url,
        requiredAck: neighbour.requiredAck,
        stepKey: asStepKey(neighbour.stepKey),
        sort: doc.sort,
      });
      if (!first.ok) {
        toast.error("Could not reorder", { description: first.error });
        return;
      }
      const second = await updateSupplierDocument({
        documentId: doc.id,
        title: doc.title,
        sourceType: doc.sourceType,
        url: doc.url,
        requiredAck: doc.requiredAck,
        stepKey: asStepKey(doc.stepKey),
        sort: neighbour.sort,
      });
      if (!second.ok) {
        toast.error("Could not reorder", { description: second.error });
        return;
      }
      router.refresh();
    });
  }

  function remove(doc: OrgSupplierDocumentRow) {
    const warning =
      doc.ackCount > 0
        ? `\n\n${doc.ackCount} supplier acknowledgement${
            doc.ackCount === 1 ? "" : "s"
          } will be discarded with it, and any step it completes re-opens.`
        : "";
    if (
      !window.confirm(
        `Withdraw "${doc.title}" from this edition's document list?${warning}`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteSupplierDocument({ documentId: doc.id });
      if (!result.ok) {
        toast.error("Could not withdraw the document", {
          description: result.error,
        });
        return;
      }
      toast.success("Document withdrawn");
      router.refresh();
    });
  }

  const columns: ResponsiveColumn<OrgSupplierDocumentRow>[] = [
    {
      id: "order",
      header: "Order",
      // Reorder is a desktop-only affordance: the mobile frame disables its
      // drag grip, and up/down arrows say nothing once rows are stacked cards.
      mobileHidden: true,
      headClassName: "w-[72px]",
      cell: (doc) => {
        const index = documents.findIndex((d) => d.id === doc.id);
        return (
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={pending || index <= 0}
              onClick={() => move(index, -1)}
              aria-label={`Move "${doc.title}" up`}
            >
              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={pending || index === documents.length - 1}
              onClick={() => move(index, 1)}
              aria-label={`Move "${doc.title}" down`}
            >
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        );
      },
    },
    {
      id: "document",
      header: "Document",
      role: "title",
      cell: (doc) => {
        const SourceIcon = sourceIcon(doc.sourceType);
        return (
          <>
            <p className="font-medium text-foreground">{doc.title}</p>
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <SourceIcon className="h-3 w-3" aria-hidden />
              {displayUrl(doc.url)}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
            {doc.ackCount > 0 ? (
              <p className="mt-1 text-xs font-normal text-muted-foreground">
                {doc.ackCount} supplier
                {doc.ackCount === 1 ? "" : "s"} acknowledged
              </p>
            ) : null}
          </>
        );
      },
    },
    {
      id: "source",
      header: "Source",
      role: "badge",
      headClassName: "w-[110px]",
      cell: (doc) => {
        const SourceIcon = sourceIcon(doc.sourceType);
        return (
          <Badge variant="outline">
            <SourceIcon className="h-3 w-3" aria-hidden />
            {doc.sourceType === "file" ? "File" : "Link"}
          </Badge>
        );
      },
    },
    {
      id: "requiredAck",
      header: "Required ack",
      align: "left",
      headClassName: "w-[190px]",
      cell: (doc) => (
        <div className="flex items-center gap-2.5">
          <Switch
            checked={doc.requiredAck}
            disabled={pending}
            onCheckedChange={(next) =>
              save(
                doc,
                { requiredAck: next },
                next
                  ? "Acknowledgement now required"
                  : "Acknowledgement no longer required",
              )
            }
            aria-label={`Require acknowledgement of "${doc.title}"`}
          />
          <span className="text-sm text-muted-foreground">
            {doc.requiredAck ? "Required" : "Optional"}
          </span>
        </div>
      ),
    },
    {
      id: "stepKey",
      header: "Binds to step",
      align: "left",
      headClassName: "w-[240px]",
      cell: (doc) => (
        <Select
          value={doc.stepKey ?? UNBOUND_VALUE}
          disabled={pending}
          onValueChange={(next) =>
            save(
              doc,
              {
                stepKey: next === UNBOUND_VALUE ? null : next,
                // Binding always implies the acknowledgement.
                requiredAck: next === UNBOUND_VALUE ? doc.requiredAck : true,
              },
              next === UNBOUND_VALUE
                ? "Binding removed"
                : `Bound to "${stepLabel(next)}"`,
            )
          }
        >
          <SelectTrigger aria-label={`Onboarding step bound to "${doc.title}"`}>
            <SelectValue placeholder="Not bound" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNBOUND_VALUE}>Not bound</SelectItem>
            {BINDABLE_STEPS.map((step) => (
              <SelectItem key={step.key} value={step.key}>
                {step.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      role: "actions",
      hideHeader: true,
      align: "right",
      headClassName: "w-[100px]",
      cell: (doc) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={pending}
            onClick={() => setEditing(doc)}
            aria-label={`Edit "${doc.title}"`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => remove(doc)}
            aria-label={`Withdraw "${doc.title}"`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <ResponsiveDataTable
        columns={columns}
        data={documents}
        getRowKey={(doc) => doc.id}
        caption="Supplier sign-up documents"
      />

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit document</DialogTitle>
            <DialogDescription>
              Changes apply to every supplier onboarding for this edition. Adding
              a requirement legitimately re-opens the step it binds to.
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <DocumentForm
              mode="edit"
              documentId={editing.id}
              blobConfigured={blobConfigured}
              initial={{
                title: editing.title,
                sourceType: editing.sourceType,
                url: editing.url,
                requiredAck: editing.requiredAck,
                stepKey: asStepKey(editing.stepKey),
              }}
              onDone={() => setEditing(null)}
              onCancel={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
