"use client";

import * as React from "react";
import { Check, Search } from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";
import { Input } from "@quagga/ui/components/input";
import type { SupplierOption } from "@/lib/registration-store";
import { TextAreaField } from "./field-kit";

const VETTING_LABEL: Record<string, { label: string; variant: "success" | "warning" | "outline" }> = {
  registered: { label: "Vetted", variant: "success" },
  flagged: { label: "Flagged", variant: "warning" },
  listed: { label: "Listed", variant: "outline" },
};

// Section 6 supplier picker: multi-select from the AB suppliers repository plus
// a free-text note for anything not on the list (build-spec §apps/web).

export function SupplierPicker({
  suppliers,
  selectedIds,
  onChangeSelected,
  onCommitSelected,
  note,
  onChangeNote,
  onCommitNote,
}: {
  suppliers: SupplierOption[];
  selectedIds: string[];
  onChangeSelected: (ids: string[]) => void;
  onCommitSelected: () => void;
  note: string | null;
  onChangeNote: (v: string) => void;
  onCommitNote: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const selected = new Set(selectedIds);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.services ?? "").toLowerCase().includes(q),
    );
  }, [suppliers, query]);

  function toggle(id: string) {
    const next = selected.has(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    onChangeSelected(next);
    setTimeout(onCommitSelected, 0);
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-foreground">
          Suppliers{" "}
          <span className="font-normal text-muted-foreground">
            ({selectedIds.length} selected)
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          Pick from AfrikaBurn&apos;s known suppliers. Anything else goes in the
          note below.
        </p>
      </div>

      {suppliers.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          No suppliers have been imported yet. Use the note below to list any
          external suppliers you&apos;re planning to use.
        </p>
      ) : (
        <>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search suppliers by name or service"
              className="pl-8"
            />
          </div>
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto rounded-lg border border-border p-1.5">
            {filtered.length === 0 && (
              <li className="p-2 text-xs text-muted-foreground">
                No suppliers match “{query}”.
              </li>
            )}
            {filtered.map((s) => {
              const on = selected.has(s.id);
              const vet = VETTING_LABEL[s.vettingStatus] ?? VETTING_LABEL.listed!;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => toggle(s.id)}
                    aria-pressed={on}
                    className={`flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                      on
                        ? "border-accent bg-accent/10"
                        : "border-transparent hover:bg-secondary/50"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        on ? "border-accent bg-accent text-accent-foreground" : "border-input"
                      }`}
                    >
                      {on && <Check className="h-3 w-3" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {s.name}
                        </span>
                        <Badge variant={vet.variant}>{vet.label}</Badge>
                      </span>
                      {s.services && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {s.services}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <TextAreaField
        id="s6-suppliers-note"
        label="Other suppliers / notes"
        hint="External suppliers not listed above (e.g. a specific stretch-tent hire), or any context for the ones you picked."
        value={note}
        onChange={onChangeNote}
        onCommit={onCommitNote}
        rows={3}
      />
    </div>
  );
}
