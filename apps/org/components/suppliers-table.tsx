"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quagga/ui/components/table";
import { Badge } from "@quagga/ui/components/badge";
import { deriveOnboardingProgress } from "@quagga/core";
import type { SupplierOverviewRow } from "@/lib/queries";
import { SupplierStandingSelect } from "./supplier-standing-select";
import { SupplierNotesDrawer } from "./supplier-notes-drawer";
import { SupplierOnboardingStepList } from "./supplier-onboarding-steps";

/**
 * The supplier repository table (supplier model v2). Columns: supplier ·
 * onboarding n/7 (incomplete highlighted) · standing (inline select) · notes
 * (count → drawer). Each row expands to the per-step onboarding detail with the
 * org-side confirm/review actions. No source/vetting anywhere.
 */
export function SuppliersTable({
  suppliers,
  editionId,
}: {
  suppliers: SupplierOverviewRow[];
  editionId: string | null;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>Supplier</TableHead>
          <TableHead>Onboarding</TableHead>
          <TableHead>Standing</TableHead>
          <TableHead className="text-right">Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {suppliers.map((s) => {
          const progress = deriveOnboardingProgress(s.steps);
          const isOpen = expanded === s.id;
          return (
            <SupplierRows
              key={s.id}
              supplier={s}
              editionId={editionId}
              isOpen={isOpen}
              onToggle={() => setExpanded(isOpen ? null : s.id)}
              completed={progress.completed}
              total={progress.total}
              awaiting={progress.awaiting}
              isOnboarded={progress.isOnboarded}
            />
          );
        })}
      </TableBody>
    </Table>
  );
}

function SupplierRows({
  supplier: s,
  editionId,
  isOpen,
  onToggle,
  completed,
  total,
  awaiting,
  isOnboarded,
}: {
  supplier: SupplierOverviewRow;
  editionId: string | null;
  isOpen: boolean;
  onToggle: () => void;
  completed: number;
  total: number;
  awaiting: number;
  isOnboarded: boolean;
}) {
  return (
    <>
      <TableRow>
        <TableCell className="align-top">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-label={isOpen ? "Collapse onboarding" : "Expand onboarding"}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            {isOpen ? (
              <ChevronDown className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden />
            )}
          </button>
        </TableCell>
        <TableCell className="font-medium align-top">
          <div className="flex flex-col gap-0.5">
            <span>{s.name}</span>
            {s.services && (
              <span className="max-w-xs truncate text-xs text-muted-foreground">
                {s.services}
              </span>
            )}
            {s.website && (
              <a
                href={s.website}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-1 text-xs text-accent hover:underline"
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
                Website
              </a>
            )}
          </div>
        </TableCell>
        <TableCell className="align-top">
          <div className="flex flex-col items-start gap-1">
            <Badge variant={isOnboarded ? "success" : "warning"}>
              {completed}/{total}
              {isOnboarded ? " onboarded" : " incomplete"}
            </Badge>
            {awaiting > 0 && (
              <span className="text-xs text-muted-foreground">
                {awaiting} awaiting confirmation
              </span>
            )}
          </div>
        </TableCell>
        <TableCell className="align-top">
          <SupplierStandingSelect supplierId={s.id} value={s.standing} />
        </TableCell>
        <TableCell className="text-right align-top">
          <div className="flex justify-end">
            <SupplierNotesDrawer
              supplierId={s.id}
              supplierName={s.name}
              count={s.notesCount}
            />
          </div>
        </TableCell>
      </TableRow>
      {isOpen && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={5} className="bg-muted/30 p-4">
            {editionId ? (
              <SupplierOnboardingStepList
                supplierId={s.id}
                editionId={editionId}
                steps={s.steps}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No active edition — onboarding steps appear once an edition is
                active.
              </p>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
