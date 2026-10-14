// The camp layout EDITOR's document operations (docs/camp-layout-spec.md
// §Surfaces "Editor"). PURE — no React, no Konva, no I/O — so every edit the
// canvas or an input makes is the same function, tested in Vitest.
//
// The canvas only draws and hands back positions in METRES. Everything that
// decides where a thing lands — snapping, clamping to the limits the server's
// Zod schema enforces, the covered area of a shade structure, undo and redo —
// is here. A value the server would refuse is never produced: sizes are
// clamped to 0.1–500 m, halos to 0–50 m, positions to ±2,000 m, angles to
// [0, 360), labels to their cap. Advice (overlaps, out of bounds) is never
// clamped away; that is what the warnings are for.
//
// AREAS. The editor edits one AREA at a time: the whole camp (`null`) or the
// covered area of one shade structure (its object id). A nested area's
// objects are stored in that area's own metres (origin at its corner), so
// the editor shows a covered area exactly as it shows a plot.

import {
  defaultChildArea,
  findCatalogEntry,
  type LayoutCatalogEntry,
} from "@quagga/core";
import {
  LAYOUT_LABEL_MAX,
  LAYOUT_MAX_COORD_M,
  LAYOUT_MAX_HALO_M,
  LAYOUT_MAX_OBJECTS,
  LAYOUT_MAX_PLOT_M,
  LAYOUT_MAX_SIZE_M,
  LAYOUT_MIN_SIZE_M,
  countLayoutObjects,
  type LayoutChildArea,
  type LayoutDocument,
  type LayoutObject,
  type NestedLayoutObject,
} from "@quagga/types";
import { normaliseDeg, snapTo, type Vec } from "@quagga/geo";

export type AnyLayoutObject = LayoutObject | NestedLayoutObject;

/** Which area the editor shows: the whole camp, or a shade structure's
 * covered area by the structure's id. */
export type AreaRef = string | null;

export interface EditorArea {
  ref: AreaRef;
  level: "plot" | "nested";
  boundary: LayoutChildArea["boundary"];
  objects: readonly AnyLayoutObject[];
  /** The shade structure, inside a covered area. */
  parent: LayoutObject | null;
}

// --- Clamping to what the server accepts ------------------------------------

/** Round away float noise at a micrometre, the precision of a metre value
 * typed or dragged — never a change a person could see. */
function tidy(v: number): number {
  return Number(v.toFixed(6)) + 0;
}

export function clampSize(v: number): number {
  if (!Number.isFinite(v)) return LAYOUT_MIN_SIZE_M;
  return tidy(Math.min(LAYOUT_MAX_SIZE_M, Math.max(LAYOUT_MIN_SIZE_M, v)));
}

export function clampPlotSide(v: number): number {
  if (!Number.isFinite(v)) return LAYOUT_MIN_SIZE_M;
  return tidy(Math.min(LAYOUT_MAX_PLOT_M, Math.max(LAYOUT_MIN_SIZE_M, v)));
}

export function clampHalo(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return tidy(Math.min(LAYOUT_MAX_HALO_M, Math.max(0, v)));
}

export function clampCoord(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return tidy(Math.min(LAYOUT_MAX_COORD_M, Math.max(-LAYOUT_MAX_COORD_M, v)));
}

export function clampRotation(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return tidy(normaliseDeg(v)) % 360;
}

/** A number typed into an inspector field: "6", "6.5", "6,5", "6.5 m",
 * "15°". Null for anything that is not one number. */
export function parseMetresInput(raw: string): number | null {
  const s = raw.trim().replace(",", ".").replace(/\s*(m|°)$/i, "");
  if (!/^-?\d+(\.\d+)?$|^-?\.\d+$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

// --- Areas --------------------------------------------------------------------

/** The area the editor shows, or null for a shade structure that no longer
 * exists (undone, deleted) or an object that is not a shade structure. A
 * structure that was never opened shows its default covered area — its own
 * footprint (TENT-002) — and gets it written on its first edit. */
export function getArea(
  doc: LayoutDocument,
  ref: AreaRef,
  catalog: readonly LayoutCatalogEntry[],
): EditorArea | null {
  if (ref === null) {
    return {
      ref,
      level: "plot",
      boundary: doc.plot.boundary,
      objects: doc.plot.objects,
      parent: null,
    };
  }
  const parent = doc.plot.objects.find((o) => o.id === ref);
  if (!parent || !findCatalogEntry(catalog, parent.catalogKey)?.nestable) {
    return null;
  }
  const child = parent.child ?? defaultChildArea(parent);
  return {
    ref,
    level: "nested",
    boundary: child.boundary,
    objects: child.objects,
    parent,
  };
}

function withAreaObjects(
  doc: LayoutDocument,
  ref: AreaRef,
  fn: (objects: readonly AnyLayoutObject[]) => AnyLayoutObject[],
): LayoutDocument {
  if (ref === null) {
    return {
      ...doc,
      plot: {
        ...doc.plot,
        objects: fn(doc.plot.objects) as LayoutObject[],
      },
    };
  }
  return {
    ...doc,
    plot: {
      ...doc.plot,
      objects: doc.plot.objects.map((o) => {
        if (o.id !== ref) return o;
        const child = o.child ?? defaultChildArea(o);
        return {
          ...o,
          child: {
            ...child,
            objects: fn(child.objects).map(stripChild),
          },
        };
      }),
    },
  };
}

/** Nesting is one level deep: an object inside a covered area never holds
 * one of its own (the server's strict schema refuses the key). */
function stripChild(o: AnyLayoutObject): NestedLayoutObject {
  if (!("child" in o)) return o;
  const { child: _child, ...rest } = o;
  void _child;
  return rest;
}

export function findObject(
  doc: LayoutDocument,
  ref: AreaRef,
  id: string,
  catalog: readonly LayoutCatalogEntry[],
): AnyLayoutObject | null {
  return getArea(doc, ref, catalog)?.objects.find((o) => o.id === id) ?? null;
}

/** Which area an object lives in, wherever it is in the document. */
export function areaOfObject(doc: LayoutDocument, id: string): AreaRef | undefined {
  if (doc.plot.objects.some((o) => o.id === id)) return null;
  for (const o of doc.plot.objects) {
    if (o.child?.objects.some((c) => c.id === id)) return o.id;
  }
  return undefined;
}

// --- Labels ---------------------------------------------------------------------

/** "Tent · 4 person" → "Tent": the short name a numbered label starts with. */
export function baseLabel(entry: Pick<LayoutCatalogEntry, "label">): string {
  return entry.label.split("·")[0]!.trim();
}

/** The next free "Tent 3" in an area — the frames number like objects. */
export function nextLabel(
  objects: readonly Pick<AnyLayoutObject, "label">[],
  entry: Pick<LayoutCatalogEntry, "label">,
): string {
  const base = baseLabel(entry);
  const pattern = new RegExp(`^${escapeRegExp(base)} (\\d+)$`);
  let max = 0;
  for (const o of objects) {
    const m = o.label?.match(pattern);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${base} ${max + 1}`.slice(0, LAYOUT_LABEL_MAX);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Snapping -------------------------------------------------------------------

/** Half the axis-aligned extent of a footprint, when it HAS an axis-aligned
 * box of its own (a rectangle at a quarter turn, or a circle). */
function halfExtents(
  o: Pick<AnyLayoutObject, "shape" | "width" | "length" | "diameter" | "rotationDeg">,
): Vec | null {
  if (o.shape === "circle") {
    const r = (o.diameter ?? o.width) / 2;
    return [r, r];
  }
  const r = normaliseDeg(o.rotationDeg);
  if (r === 0 || r === 180) return [o.width / 2, o.length / 2];
  if (r === 90 || r === 270) return [o.length / 2, o.width / 2];
  return null;
}

/**
 * Where a dragged object lands with snapping on. A square-on rectangle snaps
 * its CORNER to the grid, so a 2.5 m tent sits between grid lines rather
 * than straddling one; a circle snaps its centre (the centre is what a fire
 * pit is placed by); a rectangle at any other angle snaps its centre.
 */
export function snapCentre(
  o: Pick<AnyLayoutObject, "shape" | "width" | "length" | "diameter" | "rotationDeg">,
  centre: Vec,
  step: number,
): Vec {
  if (!(step > 0)) return [clampCoord(centre[0]), clampCoord(centre[1])];
  const half = o.shape === "rect" ? halfExtents(o) : null;
  if (!half) {
    return [clampCoord(snapTo(centre[0], step)), clampCoord(snapTo(centre[1], step))];
  }
  return [
    clampCoord(snapTo(centre[0] - half[0], step) + half[0]),
    clampCoord(snapTo(centre[1] - half[1], step) + half[1]),
  ];
}

// --- Edits -----------------------------------------------------------------------

/** A new object from a palette entry, centred at `centre`, at the entry's
 * default (estimated) sizes. */
export function newObjectFromEntry(
  entry: LayoutCatalogEntry,
  centre: Vec,
  id: string,
  label?: string,
): AnyLayoutObject {
  const o: AnyLayoutObject = {
    id,
    catalogKey: entry.key,
    shape: entry.shape,
    centre: [clampCoord(centre[0]), clampCoord(centre[1])],
    width: clampSize(entry.width),
    length: clampSize(entry.length),
    rotationDeg: 0,
    clearanceM: clampHalo(entry.clearanceM),
    safetyM: clampHalo(entry.safetyM),
    visibility: entry.visibility,
  };
  if (entry.shape === "circle") {
    o.diameter = clampSize(entry.diameter ?? entry.width);
  }
  if (label) o.label = label.slice(0, LAYOUT_LABEL_MAX);
  return o;
}

export function canAddObject(doc: LayoutDocument): boolean {
  return countLayoutObjects(doc.plot) < LAYOUT_MAX_OBJECTS;
}

export function addObject(
  doc: LayoutDocument,
  ref: AreaRef,
  obj: AnyLayoutObject,
): LayoutDocument {
  if (!canAddObject(doc)) return doc;
  return withAreaObjects(doc, ref, (objs) => [...objs, obj]);
}

/** What the inspector and the canvas change. Every field optional; every
 * value clamped. `diameter` keeps a circle's width and length equal to it. */
export interface ObjectPatch {
  centre?: Vec;
  centreX?: number;
  centreY?: number;
  width?: number;
  length?: number;
  diameter?: number;
  rotationDeg?: number;
  clearanceM?: number;
  safetyM?: number;
  label?: string;
}

export function applyPatch<T extends AnyLayoutObject>(o: T, patch: ObjectPatch): T {
  const next: T = { ...o };
  let [x, y] = o.centre;
  if (patch.centre) [x, y] = patch.centre;
  if (patch.centreX !== undefined) x = patch.centreX;
  if (patch.centreY !== undefined) y = patch.centreY;
  next.centre = [clampCoord(x), clampCoord(y)];
  if (o.shape === "circle") {
    const d = patch.diameter ?? patch.width ?? patch.length;
    if (d !== undefined) {
      const c = clampSize(d);
      next.diameter = c;
      next.width = c;
      next.length = c;
    }
  } else {
    if (patch.width !== undefined) next.width = clampSize(patch.width);
    if (patch.length !== undefined) next.length = clampSize(patch.length);
    if (patch.rotationDeg !== undefined) {
      next.rotationDeg = clampRotation(patch.rotationDeg);
    }
  }
  if (patch.clearanceM !== undefined) next.clearanceM = clampHalo(patch.clearanceM);
  if (patch.safetyM !== undefined) next.safetyM = clampHalo(patch.safetyM);
  if (patch.label !== undefined) {
    const label = patch.label.trim().slice(0, LAYOUT_LABEL_MAX);
    if (label) next.label = label;
    else delete next.label;
  }
  return next;
}

export function updateObject(
  doc: LayoutDocument,
  ref: AreaRef,
  id: string,
  patch: ObjectPatch,
): LayoutDocument {
  return withAreaObjects(doc, ref, (objs) =>
    objs.map((o) => (o.id === id ? applyPatch(o, patch) : o)),
  );
}

/** Remove an object. A shade structure goes with everything under it. */
export function removeObject(
  doc: LayoutDocument,
  ref: AreaRef,
  id: string,
): LayoutDocument {
  return withAreaObjects(doc, ref, (objs) => objs.filter((o) => o.id !== id));
}

/** A copy 1 m along and 1 m in, with new ids — the structure's covered area
 * and everything under it included. Returns the copy's id, or null when the
 * document is full. */
export function duplicateObject(
  doc: LayoutDocument,
  ref: AreaRef,
  id: string,
  newId: () => string,
  catalog: readonly LayoutCatalogEntry[],
  offset = 1,
): { doc: LayoutDocument; id: string | null } {
  const area = getArea(doc, ref, catalog);
  const src = area?.objects.find((o) => o.id === id);
  if (!area || !src) return { doc, id: null };
  const extra = 1 + ("child" in src && src.child ? src.child.objects.length : 0);
  if (countLayoutObjects(doc.plot) + extra > LAYOUT_MAX_OBJECTS) {
    return { doc, id: null };
  }
  const copyId = newId();
  const entry = findCatalogEntry(catalog, src.catalogKey);
  const copy: AnyLayoutObject = {
    ...src,
    id: copyId,
    centre: [clampCoord(src.centre[0] + offset), clampCoord(src.centre[1] + offset)],
  };
  if (entry && src.label) copy.label = nextLabel(area.objects, entry);
  if ("child" in src && src.child) {
    (copy as LayoutObject).child = {
      boundary: src.child.boundary,
      objects: src.child.objects.map((c) => ({ ...c, id: newId() })),
    };
  }
  return { doc: withAreaObjects(doc, ref, (objs) => [...objs, copy]), id: copyId };
}

/** Arrow keys: move by `dx`, `dy` metres. */
export function nudgeObject(
  doc: LayoutDocument,
  ref: AreaRef,
  id: string,
  dx: number,
  dy: number,
): LayoutDocument {
  return withAreaObjects(doc, ref, (objs) =>
    objs.map((o) =>
      o.id === id
        ? applyPatch(o, { centre: [o.centre[0] + dx, o.centre[1] + dy] })
        : o,
    ),
  );
}

/** The whole camp's size ("Plot size"). Only a rectangle is editable; a GIS
 * outline is AfrikaBurn's, not the camp's. */
export function setPlotSize(
  doc: LayoutDocument,
  width: number,
  depth: number,
): LayoutDocument {
  if (doc.plot.boundary.kind !== "rect") return doc;
  return {
    ...doc,
    plot: {
      ...doc.plot,
      boundary: { kind: "rect", width: clampPlotSide(width), depth: clampPlotSide(depth) },
    },
  };
}

/** A shade structure's covered area: smaller than its outer footprint, which
 * includes guy ropes (spec §Model). The area stays centred on the structure,
 * so the tents keep their places relative to its middle. */
export function setCoveredSize(
  doc: LayoutDocument,
  parentId: string,
  width: number,
  depth: number,
): LayoutDocument {
  return {
    ...doc,
    plot: {
      ...doc.plot,
      objects: doc.plot.objects.map((o) => {
        if (o.id !== parentId) return o;
        const child = o.child ?? defaultChildArea(o);
        if (child.boundary.kind !== "rect") return o;
        const w = clampSize(width);
        const d = clampSize(depth);
        const dx = (w - child.boundary.width) / 2;
        const dy = (d - child.boundary.depth) / 2;
        return {
          ...o,
          child: {
            boundary: { kind: "rect", width: w, depth: d },
            objects: child.objects.map((c) =>
              applyPatch(c, { centre: [c.centre[0] + dx, c.centre[1] + dy] }),
            ),
          },
        };
      }),
    },
  };
}

// --- Undo / redo (client-side only, spec §Rules) -------------------------------

export const HISTORY_LIMIT = 100;

export interface History {
  past: readonly LayoutDocument[];
  present: LayoutDocument;
  future: readonly LayoutDocument[];
}

export function initHistory(doc: LayoutDocument): History {
  return { past: [], present: doc, future: [] };
}

/** Record an edit. An edit that changes nothing records nothing. */
export function pushHistory(h: History, doc: LayoutDocument): History {
  if (doc === h.present) return h;
  if (JSON.stringify(doc) === JSON.stringify(h.present)) return h;
  const past = [...h.past, h.present];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(-HISTORY_LIMIT) : past,
    present: doc,
    future: [],
  };
}

export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return {
    past: h.past.slice(0, -1),
    present: prev,
    future: [h.present, ...h.future],
  };
}

export function redo(h: History): History {
  const next = h.future[0];
  if (!next) return h;
  return {
    past: [...h.past, h.present],
    present: next,
    future: h.future.slice(1),
  };
}

// --- View maths ---------------------------------------------------------------

/** The ruler step, in metres: the smallest "nice" step at least `minPx`
 * pixels apart at this scale. */
export function rulerStep(pxPerMetre: number, minPx = 40): number {
  for (const step of [0.5, 1, 2, 5, 10, 20, 50, 100, 200]) {
    if (step * pxPerMetre >= minPx) return step;
  }
  return 500;
}

/** The scale (pixels per metre) that fits `width` × `depth` metres into a
 * viewport, leaving `margin` pixels on every side. */
export function fitScale(
  width: number,
  depth: number,
  viewW: number,
  viewH: number,
  margin: number,
): number {
  const w = Math.max(1, viewW - 2 * margin);
  const h = Math.max(1, viewH - 2 * margin);
  return Math.max(0.01, Math.min(w / Math.max(width, 0.1), h / Math.max(depth, 0.1)));
}

/**
 * The editor stage's height: what the area needs once fitted to the stage's
 * width, clamped to [min, max]. A wide plot gets a shorter stage rather than
 * an empty band between the top ruler and the plot (frame f3jmCq).
 */
export function stageHeight(
  areaW: number,
  areaD: number,
  stageW: number,
  o: { ruler: number; margin: number; min: number; max: number },
): number {
  const fit = Math.max(1, stageW - o.ruler - 2 * o.margin) / Math.max(areaW, 0.1);
  const natural = o.ruler + 2 * o.margin + Math.max(areaD, 0.1) * fit;
  return Math.round(Math.min(o.max, Math.max(o.min, natural)));
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8;

export function stepZoom(zoom: number, direction: 1 | -1): number {
  const next = direction > 0 ? zoom * 1.25 : zoom / 1.25;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(next.toFixed(4))));
}

/** "6.0 m × 4.0 m", the live readout on the handles; "Ø 6.0 m" for a
 * circle. */
export function sizeReadout(
  shape: "rect" | "circle",
  width: number,
  length: number,
): string {
  const m = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)} m`;
  return shape === "circle" ? `Ø ${m(width)}` : `${m(width)} × ${m(length)}`;
}

/** "6 × 4 m" / "Ø 3 m", the dimension line under a label on the plan. */
export function dimsText(
  o: Pick<AnyLayoutObject, "shape" | "width" | "length" | "diameter">,
): string {
  const t = (v: number) => String(Math.round(v * 10) / 10);
  return o.shape === "circle"
    ? `Ø ${t(o.diameter ?? o.width)} m`
    : `${t(o.width)} × ${t(o.length)} m`;
}
