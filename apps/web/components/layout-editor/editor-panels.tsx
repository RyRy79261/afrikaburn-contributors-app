"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  ChevronRight,
  Copy,
  GripVertical,
  Info,
  PanelTop,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Input } from "@quagga/ui/components/input";
import { cn } from "@quagga/ui/lib/utils";
import {
  LAYOUT_CATALOG_GROUP_LABELS,
  paletteFor,
  type LayoutCatalogEntry,
  type LayoutCatalogGroup,
  type LayoutWarning,
} from "@quagga/core";
import { LAYOUT_LABEL_MAX } from "@quagga/types";
import {
  dimsText,
  parseMetresInput,
  type AnyLayoutObject,
  type ObjectPatch,
} from "@/lib/layout-editor-model";
import { layoutIcon } from "@quagga/ui/components/layout-icons";
import { PALETTE_DRAG_TYPE } from "./palette-drag";

// The DOM side of the editor: the palette, the inspector and the warnings.
// THE INPUTS ARE THE ACCESSIBLE PATH to every edit the canvas makes — every
// position, size, angle and label can be typed, and every palette entry can
// be added with a click or Enter, so nothing needs a pointer.

// --- Palette ----------------------------------------------------------------

const GROUP_ORDER: LayoutCatalogGroup[] = [
  "shelter",
  "vehicles",
  "infrastructure",
  "safety",
  "areas",
  "inside",
];

/** The palette of catalogue objects that can be placed at this level, by
 * group. */
export function LayoutPalette({
  catalog,
  level,
  onAdd,
  disabled,
}: {
  catalog: readonly LayoutCatalogEntry[];
  level: "plot" | "nested";
  onAdd: (entry: LayoutCatalogEntry) => void;
  disabled: boolean;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return paletteFor(catalog, level).filter(
      (e) => !q || e.label.toLowerCase().includes(q) || e.key.includes(q),
    );
  }, [catalog, level, query]);

  // Inside a covered area the palette is one list ("Inside a Bedouin"), as
  // the frame draws it; on the whole camp, the catalogue's groups.
  const groups =
    level === "nested"
      ? [{ group: "inside" as const, items: entries }]
      : GROUP_ORDER.map((group) => ({
          group,
          items: entries.filter((e) => e.group === group),
        })).filter((g) => g.items.length > 0);

  return (
    <section
      aria-labelledby={`${searchId}-h`}
      className="flex flex-col gap-3 self-start rounded-xl border border-border bg-card p-4"
    >
      <h2 id={`${searchId}-h`} className="font-semibold">
        Add to the plan
      </h2>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search objects"
          aria-label="Search objects"
          className="pl-9"
        />
      </div>
      <div className="flex max-h-[34rem] flex-col gap-3 overflow-y-auto pr-1">
        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing matches.</p>
        )}
        {groups.map(({ group, items }) => (
          <div key={group}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {LAYOUT_CATALOG_GROUP_LABELS[group]}
            </h3>
            <ul className="flex flex-col">
              {items.map((e) => {
                const Icon = layoutIcon(e.icon);
                return (
                  <li key={e.key}>
                    <button
                      type="button"
                      draggable={!disabled}
                      disabled={disabled}
                      onDragStart={(ev) => {
                        ev.dataTransfer.setData(PALETTE_DRAG_TYPE, e.key);
                        ev.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => onAdd(e)}
                      aria-label={`Add ${e.label}, ${dimsText(e)}`}
                      className="flex w-full items-center gap-3 rounded-md px-1 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {e.label}
                        </span>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {dimsText(e)}
                          {e.safetyM > 0 ? ` · ${e.safetyM} m clear` : ""}
                        </span>
                      </span>
                      <GripVertical
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <p className="flex gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Sizes are estimates — check your own.
          {level === "nested" &&
            " Kitchens, vehicles and the rest go on the whole camp."}
        </span>
      </p>
    </section>
  );
}

// --- Number field --------------------------------------------------------------

/** "21.0", "4.25": one decimal at least, two at most. */
export function formatFieldNumber(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r * 10) ? r.toFixed(1) : String(r);
}

/**
 * A metre (or degree) input that commits on Enter or blur — one edit, one
 * undo step — and reverts on Escape or on anything that is not a number.
 */
export function MetreField({
  id,
  label,
  value,
  unit = "m",
  onCommit,
  integer = false,
}: {
  id: string;
  label: string;
  value: number;
  unit?: "m" | "°";
  onCommit: (v: number) => void;
  integer?: boolean;
}) {
  const shown = integer ? String(Math.round(value)) : formatFieldNumber(value);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);

  /** Commits the typed value on blur or Enter; text that is not one number
   * reverts. */
  const commit = () => {
    setEditing(false);
    const v = parseMetresInput(text);
    if (v === null) {
      setText(shown);
      return;
    }
    if (v !== value) onCommit(v);
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onFocus={() => setEditing(true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setText(shown);
              setEditing(false);
              e.currentTarget.blur();
            }
          }}
          className="pr-8"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
        >
          {unit}
        </span>
      </div>
    </div>
  );
}

// --- Inspector -------------------------------------------------------------------

/**
 * The selected object's fields (size, position, rotation, halos, label) and
 * its duplicate, delete and open-covered-area actions.
 */
export function LayoutInspector({
  object,
  entry,
  name,
  context,
  onPatch,
  onDuplicate,
  onDelete,
  onOpen,
  canDuplicate,
}: {
  object: AnyLayoutObject | null;
  entry: LayoutCatalogEntry | undefined;
  name: string;
  /** "Infrastructure" on the whole camp; "inside Bedouin 1" in a covered
   * area. */
  context: string;
  onPatch: (patch: ObjectPatch) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpen: (() => void) | null;
  canDuplicate: boolean;
}) {
  const ids = useId();
  const [label, setLabel] = useState(object?.label ?? "");
  useEffect(() => setLabel(object?.label ?? ""), [object?.id, object?.label]);

  if (!object) {
    return (
      <section className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <h2 className="mb-1 font-semibold text-foreground">Nothing selected</h2>
        Select an object on the plan to change it, or add one from the
        palette. Arrow keys move the selected object; Delete removes it.
      </section>
    );
  }
  const Icon = layoutIcon(entry?.icon);
  const isCircle = object.shape === "circle";

  return (
    <section
      aria-label={`${name} — position and size`}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-accent">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{name}</h2>
          <p className="text-xs text-muted-foreground">
            {context}
            {entry?.estimate ? " · estimated size" : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetreField
          id={`${ids}-x`}
          label="Centre X"
          value={object.centre[0]}
          onCommit={(v) => onPatch({ centreX: v })}
        />
        <MetreField
          id={`${ids}-y`}
          label="Centre Y"
          value={object.centre[1]}
          onCommit={(v) => onPatch({ centreY: v })}
        />
        {isCircle ? (
          <MetreField
            id={`${ids}-d`}
            label="Diameter"
            value={object.diameter ?? object.width}
            onCommit={(v) => onPatch({ diameter: v })}
          />
        ) : (
          <>
            <MetreField
              id={`${ids}-w`}
              label="Width"
              value={object.width}
              onCommit={(v) => onPatch({ width: v })}
            />
            <MetreField
              id={`${ids}-l`}
              label="Depth"
              value={object.length}
              onCommit={(v) => onPatch({ length: v })}
            />
            <MetreField
              id={`${ids}-r`}
              label="Rotation"
              unit="°"
              integer
              value={object.rotationDeg}
              onCommit={(v) => onPatch({ rotationDeg: v })}
            />
          </>
        )}
        <MetreField
          id={`${ids}-c`}
          label="Clearance"
          value={object.clearanceM}
          onCommit={(v) => onPatch({ clearanceM: v })}
        />
        {object.safetyM > 0 || entry?.safetyM ? (
          <MetreField
            id={`${ids}-s`}
            label="Safety zone"
            value={object.safetyM}
            onCommit={(v) => onPatch({ safetyM: v })}
          />
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${ids}-label`} className="text-sm font-medium">
          Label
        </label>
        <Input
          id={`${ids}-label`}
          value={label}
          maxLength={LAYOUT_LABEL_MAX}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            if (label !== (object.label ?? "")) onPatch({ label });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          aria-describedby={`${ids}-label-help`}
        />
        <p id={`${ids}-label-help`} className="text-xs text-muted-foreground">
          Free text, not linked to anyone. Every member of the camp sees it.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {onOpen && (
          <Button type="button" size="sm" onClick={onOpen}>
            <PanelTop aria-hidden />
            Open inside
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDuplicate}
          disabled={!canDuplicate}
        >
          <Copy aria-hidden />
          Duplicate
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 aria-hidden />
          Delete
        </Button>
      </div>
    </section>
  );
}

// --- Warnings (editors only) -------------------------------------------------------

/** The editors' list of layout warnings; picking one selects its object. */
export function LayoutWarningsPanel({
  warnings,
  areaName,
  onPick,
}: {
  warnings: readonly LayoutWarning[];
  /** The covered area a warning belongs to, by structure id. */
  areaName: (areaId: string) => string;
  onPick: (w: LayoutWarning) => void;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4"
    >
      <h2 id={headingId} className="flex items-center gap-2 font-semibold">
        <TriangleAlert className="h-4 w-4 text-warning" aria-hidden />
        Warnings
        <span className="rounded-full bg-warning/20 px-2 text-xs font-semibold text-warning">
          {warnings.length}
        </span>
      </h2>
      {warnings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No warnings on this plan.
        </p>
      ) : (
        <ul className="flex max-h-[36rem] flex-col gap-2 overflow-y-auto pr-1">
          {warnings.map((w, i) => (
            <li key={`${w.code}-${w.objectIds.join("-")}-${i}`}>
              <button
                type="button"
                onClick={() => onPick(w)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg bg-muted/60 p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  w.severity === "note" && "bg-muted/30",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {w.message}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {w.areaId ? `Inside ${areaName(w.areaId)} · ` : ""}
                    {w.detail}
                  </span>
                </span>
                <ChevronRight
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="pt-1 text-xs text-muted-foreground">
        Advice only: warnings never stop you saving or submitting.
      </p>
    </section>
  );
}
