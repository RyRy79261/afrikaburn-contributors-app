"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWideEnough } from "./wide-only";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  CloudCheck,
  Fullscreen,
  ImageDown,
  Info,
  LoaderCircle,
  Magnet,
  Map as MapIcon,
  Pencil,
  Printer,
  Redo2,
  RefreshCw,
  Tent,
  TriangleAlert,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@quagga/ui/components/popover";
import { cn } from "@quagga/ui/lib/utils";
import {
  boundaryDimensions,
  childBoundaryRing,
  coveredAreaSummary,
  defaultChildArea,
  findCatalogEntry,
  formatMetres,
  frontageSegment,
  getLayoutCatalog,
  LAYOUT_CATALOG_GROUP_LABELS,
  layoutObjectName,
  layoutWarnings,
  plotSummary,
  boundaryRing,
  type LayoutCatalogEntry,
  type LayoutWarning,
} from "@quagga/core";
import { footprintRing, inflate, SNAP_LENGTH_M, type Vec } from "@quagga/geo";
import type { LayoutDocument, LayoutObject } from "@quagga/types";
import {
  addObject,
  canAddObject,
  duplicateObject,
  getArea,
  initHistory,
  newObjectFromEntry,
  nextLabel,
  nudgeObject,
  pushHistory,
  redo as redoHistory,
  removeObject,
  setCoveredSize,
  setPlotSize,
  snapCentre,
  stepZoom,
  undo as undoHistory,
  updateObject,
  type AreaRef,
  type ObjectPatch,
} from "@/lib/layout-editor-model";
import { saveCampLayoutAction } from "@/app/(app)/camps/[slug]/layout/actions";
import {
  createLayoutAutosave,
  type AutosaveState,
} from "@/lib/layout-autosave";
import type { StageApi, StageTheme } from "./editor-stage";
import {
  LayoutInspector,
  LayoutPalette,
  LayoutWarningsPanel,
  MetreField,
} from "./editor-panels";
import { LayoutMiniMap } from "./mini-map";

// The camp layout editor (docs/camp-layout-spec.md §Surfaces; frames L1
// f3jmCq, L2 LcZsE). Editors only — the page decides that on the server, and
// every save is decided again by the store.
//
// STATE. The document lives here, with undo/redo (client-side only). Every
// change autosaves after a short pause, one save in flight at a time, each a
// compare-and-set on the version the last save returned. Someone else's
// newer save refuses ours: we say so and offer Reload, never merge.
//
// WARNINGS are computed here from the same pure @quagga/core function the
// server uses. They are shown because this component only ever renders for an
// editor (14 Oct decision: warnings are for editors only).

const EditorStage = dynamic(() => import("./editor-stage"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[540px] items-center justify-center text-sm text-muted-foreground">
      Loading the plan…
    </div>
  ),
});

const STAGE_HEIGHT = 540;
const AUTOSAVE_MS = 800;
const RETRY_MS = 10_000;
const TZ = "Africa/Johannesburg";

type SaveState = AutosaveState;

/** "14:05" in South African time. */
function timeOf(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(new Date(iso));
}

/** "3 Mar 2027" in South African time. */
function dateOf(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  }).format(new Date(iso));
}

/** A fresh object id. */
function newId(): string {
  return crypto.randomUUID();
}

const FALLBACK_THEME: StageTheme = {
  background: "#17191b",
  card: "#1f2326",
  foreground: "#f4f0e8",
  muted: "#adb6b3",
  border: "#323a3f",
  primary: "#2d7696",
  accent: "#f4b672",
  destructive: "#c24438",
  sage: "#b6d090",
  font: "ui-sans-serif, system-ui, sans-serif",
  mono: "ui-monospace, monospace",
};

/** The canvas cannot read CSS classes, so it is handed the theme's colours —
 * re-read when the theme class on <html> changes. */
function useStageTheme(): StageTheme {
  const [theme, setTheme] = useState<StageTheme>(FALLBACK_THEME);
  useEffect(() => {
    /** Reads the theme's CSS variables into the canvas palette. */
    const read = () => {
      const s = getComputedStyle(document.documentElement);
      /** A CSS variable's value, or the fallback when unset. */
      const v = (name: string, fb: string) =>
        s.getPropertyValue(name).trim() || fb;
      setTheme({
        background: v("--color-background", FALLBACK_THEME.background),
        card: v("--color-card", FALLBACK_THEME.card),
        foreground: v("--color-foreground", FALLBACK_THEME.foreground),
        muted: v("--color-muted-foreground", FALLBACK_THEME.muted),
        border: v("--color-border", FALLBACK_THEME.border),
        primary: v("--color-primary", FALLBACK_THEME.primary),
        accent: v("--color-ab-apricot", FALLBACK_THEME.accent),
        destructive: v("--color-destructive", FALLBACK_THEME.destructive),
        sage: v("--color-ab-sage", FALLBACK_THEME.sage),
        font: getComputedStyle(document.body).fontFamily || FALLBACK_THEME.font,
        mono: v("--font-mono", FALLBACK_THEME.mono),
      });
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => mo.disconnect();
  }, []);
  return theme;
}

/** True when focus is in a text field, so editor shortcuts stand aside. */
function isTyping(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el as HTMLElement).isContentEditable
  );
}

export interface CampLayoutEditorProps {
  slug: string;
  campName: string;
  editionName: string;
  editionYear: number;
  initial: {
    document: LayoutDocument;
    version: number;
    updatedAt: string;
    updatedByName: string | null;
  };
  /** When AfrikaBurn's copy was pinned (registration submit), if ever. */
  snapshotPinnedAt: string | null;
}

/**
 * The camp layout editor: palette, canvas, inspector and warnings, with
 * undo/redo, keyboard nudging and autosave. Wide screens only.
 */
export function CampLayoutEditor({
  slug,
  campName,
  editionName,
  editionYear,
  initial,
  snapshotPinnedAt,
}: CampLayoutEditorProps) {
  const catalog = useMemo(() => getLayoutCatalog(editionYear), [editionYear]);
  const theme = useStageTheme();
  const wide = useWideEnough();

  const [history, setHistory] = useState(() => initHistory(initial.document));
  const doc = history.present;
  const [areaRef, setAreaRef] = useState<AreaRef>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [fitNonce, setFitNonce] = useState(0);
  const [lastSaved, setLastSaved] = useState({
    at: initial.updatedAt,
    by: initial.updatedByName,
    version: initial.version,
  });
  const [save, setSave] = useState<SaveState>({ kind: "saved" });
  const [notice, setNotice] = useState<string | null>(null);
  const stageApi = useRef<StageApi | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // --- Edits ---------------------------------------------------------------------

  /** Applies an edit to the present document as one undo step. */
  const commit = useCallback((fn: (d: LayoutDocument) => LayoutDocument) => {
    setHistory((h) => pushHistory(h, fn(h.present)));
  }, []);

  const area = getArea(doc, areaRef, catalog);
  // A structure undone or deleted while open: back to the whole camp.
  useEffect(() => {
    if (areaRef !== null && !area) setAreaRef(null);
  }, [areaRef, area]);
  const current = area ?? getArea(doc, null, catalog)!;
  const selected = current.objects.find((o) => o.id === selectedId) ?? null;
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  /** Switches the canvas to the plot (null) or a covered area, refitted,
   * nothing selected. */
  const openArea = useCallback((ref: AreaRef) => {
    setAreaRef(ref);
    setSelectedId(null);
    setZoom(1);
    setFitNonce((n) => n + 1);
  }, []);

  /**
   * Places a new object from the palette, at the drop point (snapped when
   * snapping is on) or the area's centre, and selects it. Refuses past the
   * object limit.
   */
  const addEntry = useCallback(
    (entry: LayoutCatalogEntry, at?: Vec) => {
      if (!canAddObject(doc)) {
        setNotice("A layout holds at most 400 objects.");
        return;
      }
      const dims = boundaryDimensions(current.boundary);
      const raw: Vec = at ?? [dims.width / 2, dims.depth / 2];
      // A drop lands on the grid like a drag does.
      const centre =
        at && snap
          ? snapCentre({ ...entry, rotationDeg: 0 }, raw, SNAP_LENGTH_M)
          : raw;
      const o = newObjectFromEntry(
        entry,
        centre,
        newId(),
        nextLabel(current.objects, entry),
      );
      commit((d) => addObject(d, current.ref, o));
      setSelectedId(o.id);
    },
    [doc, current, commit, snap],
  );

  /** Applies an inspector change to the selected object. */
  const patchSelected = (patch: ObjectPatch) => {
    if (!selected) return;
    commit((d) => updateObject(d, current.ref, selected.id, patch));
  };

  /** Copies the selected object and selects the copy; refuses past the object
   * limit. */
  const duplicateSelected = () => {
    if (!selected) return;
    const r = duplicateObject(doc, current.ref, selected.id, newId, catalog);
    if (r.id) {
      commit(() => r.doc);
      setSelectedId(r.id);
    } else {
      setNotice("A layout holds at most 400 objects.");
    }
  };

  /** Removes the selected object (a shade structure with everything under
   * it). */
  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    commit((d) => removeObject(d, current.ref, selectedId));
    setSelectedId(null);
  }, [selectedId, current.ref, commit]);

  // --- Autosave --------------------------------------------------------------------
  // The controller (lib/layout-autosave.ts) owns the timers, the version and
  // the "sent but never heard back" document; this only wires it to React.

  const [autosave] = useState(() =>
    createLayoutAutosave<LayoutDocument>({
      initial: initial.document,
      version: initial.version,
      send: (document, expectedVersion) =>
        saveCampLayoutAction({ slug, expectedVersion, document }),
      onState: setSave,
      onSaved: (v) =>
        setLastSaved({ at: new Date().toISOString(), by: null, version: v }),
      debounceMs: AUTOSAVE_MS,
      retryMs: RETRY_MS,
    }),
  );

  useEffect(() => {
    autosave.change(doc);
  }, [autosave, doc]);

  /** "Try again" on the save chip. */
  const retry = () => autosave.retry();

  // Leaving sends what is unsaved instead of dropping it: on unmount (an
  // in-app link — App Router navigation fires no beforeunload) and on
  // pagehide. A full unload with a change still unsaved also asks first.
  useEffect(() => {
    /** Asks before unloading while there is an unsaved change worth keeping. */
    const onLeave = (e: BeforeUnloadEvent) => {
      if (autosave.shouldWarnOnLeave()) e.preventDefault();
    };
    /** Sends what is unsaved as the page goes away. */
    const onPageHide = () => autosave.leave();
    window.addEventListener("beforeunload", onLeave);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      window.removeEventListener("pagehide", onPageHide);
      autosave.leave();
    };
  }, [autosave]);

  // --- Keyboard ---------------------------------------------------------------------

  useEffect(() => {
    /**
     * Undo/redo anywhere; arrows nudge, Delete removes and Escape deselects
     * only while the plan (or nothing) has focus.
     */
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(document.activeElement)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        setHistory((h) => (e.shiftKey ? redoHistory(h) : undoHistory(h)));
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        setHistory(redoHistory);
        return;
      }
      // Moving and deleting need the plan focused (or nothing focused), so
      // arrow keys still scroll the page from anywhere else.
      const active = document.activeElement;
      const onPlan =
        !active ||
        active === document.body ||
        (canvasRef.current?.contains(active) ?? false);
      if (!onPlan || !selectedId) return;
      const step = snap ? 0.5 : 0.1;
      const moves: Record<string, Vec> = {
        arrowleft: [-step, 0],
        arrowright: [step, 0],
        arrowup: [0, -step],
        arrowdown: [0, step],
      };
      const m = moves[key];
      if (m) {
        e.preventDefault();
        commit((d) => nudgeObject(d, current.ref, selectedId, m[0], m[1]));
      } else if (key === "delete" || key === "backspace") {
        e.preventDefault();
        deleteSelected();
      } else if (key === "escape") {
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, snap, current.ref, commit, deleteSelected]);

  // --- Derived ----------------------------------------------------------------------

  const warnings = useMemo(() => layoutWarnings(doc, catalog), [doc, catalog]);
  const warnedIds = useMemo(() => {
    const s = new Set<string>();
    for (const w of warnings) {
      if (w.severity !== "warning" || w.areaId !== current.ref) continue;
      for (const id of w.objectIds) s.add(id);
    }
    return s;
  }, [warnings, current.ref]);

  const parent = current.parent;
  const parentWithChild = parent
    ? ({
        ...parent,
        child: parent.child ?? defaultChildArea(parent),
      } as LayoutObject & {
        child: NonNullable<LayoutObject["child"]>;
      })
    : null;
  const ring = parentWithChild
    ? childBoundaryRing(parentWithChild, parentWithChild.child)
    : boundaryRing(doc.plot.boundary);
  const dims = boundaryDimensions(current.boundary);

  const guyZone = (() => {
    if (!parentWithChild) return null;
    const mid: Vec = [dims.width / 2, dims.depth / 2];
    const fp =
      parentWithChild.shape === "circle"
        ? {
            kind: "circle" as const,
            centre: mid,
            radius: (parentWithChild.diameter ?? parentWithChild.width) / 2,
          }
        : {
            kind: "rect" as const,
            centre: mid,
            width: parentWithChild.width,
            length: parentWithChild.length,
            rotationDeg: 0,
          };
    return {
      ring: footprintRing(inflate(fp, parentWithChild.clearanceM), 48),
      clearanceM: parentWithChild.clearanceM,
    };
  })();

  const nestedCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of doc.plot.objects) m.set(o.id, o.child?.objects.length ?? 0);
    return m;
  }, [doc]);

  const summary = parentWithChild
    ? coveredAreaSummary(parentWithChild, catalog)
    : plotSummary(doc, catalog);

  const parentName = parent ? layoutObjectName(parent, catalog) : "";
  const selectedEntry = selected
    ? findCatalogEntry(catalog, selected.catalogKey)
    : undefined;

  /** Keeps the stage's handle for PNG export. */
  const onReady = useCallback((api: StageApi) => {
    stageApi.current = api;
  }, []);

  /** Opens the warning's area and selects its first object. */
  const onPickWarning = (w: LayoutWarning) => {
    if (w.areaId !== current.ref) openArea(w.areaId);
    setSelectedId(w.objectIds[0] ?? null);
    canvasRef.current?.focus();
  };

  /** Downloads the current area as a PNG named after the camp, year and
   * area. */
  const downloadPng = async () => {
    const url = await stageApi.current?.exportPng();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    const where = parent ? `-${parentName}` : "";
    a.download = `${slug}-layout-${editionYear}${where}.png`
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, "-");
    a.click();
  };

  // --- Render -----------------------------------------------------------------------

  const saveChip = (() => {
    switch (save.kind) {
      case "saved":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-sm font-medium text-success">
            <CloudCheck className="h-4 w-4" aria-hidden />
            Saved
          </span>
        );
      case "pending":
      case "saving":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm font-medium">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            Saving…
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-3 py-1 text-sm font-medium text-destructive">
            <TriangleAlert className="h-4 w-4" aria-hidden />
            Not saved
          </span>
        );
    }
  })();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
            <Link href={`/camps/${slug}`}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {campName}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Camp layout</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {editionName} · your camp drawn to scale, in metres. Drag objects
            from the palette onto the plot.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5" aria-live="polite">
          {saveChip}
          <p className="text-xs text-muted-foreground">
            Last saved {timeOf(lastSaved.at)}
            {lastSaved.by === null && lastSaved.version !== initial.version
              ? " by you"
              : lastSaved.by
                ? ` by ${lastSaved.by}`
                : ""}{" "}
            · version {lastSaved.version}
          </p>
        </div>
      </div>

      {save.kind === "offline" && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/50 bg-card p-4 text-sm"
        >
          <span className="flex-1">
            Couldn&apos;t save your last change. We&apos;ll keep trying while
            this page is open.
          </span>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            <RefreshCw aria-hidden />
            Try again
          </Button>
        </div>
      )}
      {save.kind === "refused" && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/50 bg-card p-4 text-sm"
        >
          <span className="flex-1">{save.message}</span>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            <RefreshCw aria-hidden />
            Try again
          </Button>
        </div>
      )}
      {save.kind === "conflict" && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-xl border border-warning/60 bg-warning/10 p-4"
        >
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="h-4 w-4 text-warning" aria-hidden />
            This layout changed since you opened it
          </p>
          <p className="text-sm text-muted-foreground">
            {save.byName ?? "Someone"} saved a newer version
            {save.at ? ` at ${timeOf(save.at)}` : ""}. Reload to carry on from
            theirs. Your last change wasn&apos;t kept.
          </p>
          <div>
            <Button
              type="button"
              size="sm"
              onClick={() => window.location.reload()}
            >
              <RefreshCw aria-hidden />
              Reload the layout
            </Button>
          </div>
        </div>
      )}

      <p className="flex items-start gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 py-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        {snapshotPinnedAt
          ? `AfrikaBurn sees the plan you sent with your registration on ${dateOf(snapshotPinnedAt)}. Changes you make here reach them when you resubmit.`
          : "AfrikaBurn sees this plan when you submit your registration. Until then only your camp sees it."}
      </p>

      {/* Toolbar */}
      <div
        role="toolbar"
        aria-label="Layout tools"
        className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card p-2"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          disabled={history.past.length === 0}
          onClick={() => setHistory(undoHistory)}
        >
          <Undo2 aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Redo"
          title="Redo (Ctrl+Y)"
          disabled={history.future.length === 0}
          onClick={() => setHistory(redoHistory)}
        >
          <Redo2 aria-hidden />
        </Button>
        <span className="mx-1 h-6 w-px bg-border" aria-hidden />
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={snap}
          onClick={() => setSnap((s) => !s)}
          className={cn(snap && "border-primary text-primary")}
        >
          <Magnet aria-hidden />
          Snap 0.5 m · 15°
        </Button>
        <span className="mx-1 h-6 w-px bg-border" aria-hidden />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Zoom out"
          onClick={() => setZoom((z) => stepZoom(z, -1))}
        >
          <ZoomOut aria-hidden />
        </Button>
        <span className="w-14 text-center font-mono text-sm" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => stepZoom(z, 1))}
        >
          <ZoomIn aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setZoom(1);
            setFitNonce((n) => n + 1);
          }}
        >
          <Fullscreen aria-hidden />
          Fit
        </Button>
        <div className="ml-auto flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void downloadPng()}
          >
            <ImageDown aria-hidden />
            Download PNG
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/camps/${slug}/layout/print`} target="_blank">
              <Printer aria-hidden />
              Print plan
            </Link>
          </Button>
        </div>
      </div>

      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_17.5rem]">
        <LayoutPalette
          catalog={catalog}
          level={current.level}
          onAdd={(e) => addEntry(e)}
          disabled={!canAddObject(doc)}
        />

        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {parent ? (
                <nav
                  aria-label="Breadcrumb"
                  className="flex items-center gap-2 font-semibold"
                >
                  <button
                    type="button"
                    onClick={() => openArea(null)}
                    className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                  >
                    <MapIcon className="h-4 w-4" aria-hidden />
                    Whole camp
                  </button>
                  <ChevronRight
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="flex items-center gap-2" aria-current="page">
                    <Tent className="h-4 w-4 text-primary" aria-hidden />
                    {parentName}
                  </span>
                </nav>
              ) : (
                <h2 className="flex items-center gap-2 font-semibold">
                  <MapIcon className="h-4 w-4 text-primary" aria-hidden />
                  Whole camp
                </h2>
              )}
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs">
                  {parent ? "Covered area" : "Plot"} {formatMetres(dims.width)}{" "}
                  × {formatMetres(dims.depth)} ·{" "}
                  {Math.round(dims.areaM2).toLocaleString("en-US")} m²
                </span>
                {!parent && doc.plot.boundary.kind === "rect" && (
                  <PlotSizePopover
                    width={dims.width}
                    depth={dims.depth}
                    onChange={(w, d) => commit((x) => setPlotSize(x, w, d))}
                  />
                )}
              </div>
            </div>

            <div
              ref={canvasRef}
              tabIndex={0}
              role="application"
              aria-label={`${parent ? parentName : "Whole camp"} plan. Select an object, then use the arrow keys to move it and Delete to remove it. Every change can also be typed in the inspector.`}
              onPointerDown={() => canvasRef.current?.focus()}
              className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {wide ? (
                <EditorStage
                  objects={current.objects}
                  ring={ring}
                  level={current.level}
                  catalog={catalog}
                  selectedId={selectedId}
                  warnedIds={warnedIds}
                  snap={snap}
                  zoom={zoom}
                  fitKey={`${current.ref ?? "plot"}:${fitNonce}`}
                  frontage={parent ? null : frontageSegment(doc.plot)}
                  guyZone={guyZone}
                  nestedCounts={nestedCounts}
                  theme={theme}
                  maxHeight={STAGE_HEIGHT}
                  onSelect={setSelectedId}
                  onMove={(id, centre) =>
                    commit((d) => updateObject(d, current.ref, id, { centre }))
                  }
                  onTransform={(id, next) =>
                    commit((d) =>
                      updateObject(d, current.ref, id, {
                        centre: next.centre,
                        width: next.width,
                        length: next.length,
                        rotationDeg: next.rotationDeg,
                      }),
                    )
                  }
                  onOpen={openArea}
                  onDropEntry={(key, at) => {
                    const e = findCatalogEntry(catalog, key);
                    if (e) addEntry(e, at);
                  }}
                  onZoom={setZoom}
                  onReady={onReady}
                />
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {parent
                  ? `${summary.tentCount} ${summary.tentCount === 1 ? "tent" : "tents"} · ${Math.round(summary.tentFootprintM2)} m² of the ${Math.round(summary.areaM2)} m² covered`
                  : `${current.objects.length} ${current.objects.length === 1 ? "object" : "objects"} · footprints ${Math.round(summary.footprintM2)} m² · ${summary.coveredPct}% of the plot`}
              </span>
              <span className="flex items-center gap-4">
                {parent ? (
                  <>
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full bg-foreground"
                        aria-hidden
                      />
                      Pole
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-4 bg-ab-apricot" aria-hidden />
                      Guy ropes
                    </span>
                  </>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-4 bg-ab-apricot" aria-hidden />
                    Frontage
                  </span>
                )}
              </span>
            </div>
          </section>

          {parentWithChild && (
            <section className="grid gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="rounded-lg bg-background p-3">
                <LayoutMiniMap
                  doc={doc}
                  highlightId={parentWithChild.id}
                  className="h-auto w-full"
                />
              </div>
              <div className="flex flex-col gap-3">
                <h2 className="flex items-center gap-2 font-semibold">
                  <MapIcon className="h-4 w-4 text-primary" aria-hidden />
                  {parentName} on the whole camp
                </h2>
                <p className="text-sm text-muted-foreground">
                  The rest of the camp, with {parentName} highlighted.
                </p>
                {parentWithChild.child.boundary.kind === "rect" && (
                  <div className="grid grid-cols-2 gap-3">
                    <MetreField
                      id="covered-width"
                      label="Covered width"
                      value={parentWithChild.child.boundary.width}
                      onCommit={(v) =>
                        commit((d) =>
                          setCoveredSize(d, parentWithChild.id, v, dims.depth),
                        )
                      }
                    />
                    <MetreField
                      id="covered-depth"
                      label="Covered depth"
                      value={parentWithChild.child.boundary.depth}
                      onCommit={(v) =>
                        commit((d) =>
                          setCoveredSize(d, parentWithChild.id, dims.width, v),
                        )
                      }
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  The usable area under the shade. It is smaller than the
                  structure&apos;s footprint with its guy ropes.
                </p>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openArea(null)}
                  >
                    <ArrowLeft aria-hidden />
                    Back to whole camp
                  </Button>
                </div>
              </div>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <LayoutInspector
            object={selected}
            entry={selectedEntry}
            name={selected ? layoutObjectName(selected, catalog) : ""}
            context={
              parent
                ? `${selectedEntry ? selectedEntry.label.split("·")[0]!.trim() : "Object"} · inside ${parentName}`
                : selectedEntry
                  ? LAYOUT_CATALOG_GROUP_LABELS[selectedEntry.group]
                  : "Object"
            }
            onPatch={patchSelected}
            onDuplicate={duplicateSelected}
            onDelete={deleteSelected}
            onOpen={
              selected && !parent && selectedEntry?.nestable
                ? () => openArea(selected.id)
                : null
            }
            canDuplicate={canAddObject(doc)}
          />
          <LayoutWarningsPanel
            warnings={warnings}
            areaName={(id) => {
              const o = doc.plot.objects.find((x) => x.id === id);
              return o ? layoutObjectName(o, catalog) : "a covered area";
            }}
            onPick={onPickWarning}
          />
        </div>
      </div>
    </div>
  );
}

/** The "Plot size" popover: width and depth inputs, in metres. */
function PlotSizePopover({
  width,
  depth,
  onChange,
}: {
  width: number;
  depth: number;
  onChange: (w: number, d: number) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <Pencil aria-hidden />
          Plot size
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="grid grid-cols-2 gap-3">
          <MetreField
            id="plot-width"
            label="Width"
            value={width}
            onCommit={(v) => onChange(v, depth)}
          />
          <MetreField
            id="plot-depth"
            label="Depth"
            value={depth}
            onCommit={(v) => onChange(width, v)}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Width runs along the frontage. Objects stay where they are.
        </p>
      </PopoverContent>
    </Popover>
  );
}
