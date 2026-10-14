import {
  boundaryRing,
  childBoundaryRing,
  findCatalogEntry,
  frontageSegment,
  layoutObjectName,
  objectFootprint,
  type LayoutCatalogEntry,
} from "@quagga/core";
import {
  bbox,
  footprintRing,
  inflate,
  type BBox,
  type Footprint,
  type Ring,
  type Vec,
} from "@quagga/geo";
import type {
  LayoutDocument,
  LayoutObject,
  NestedLayoutObject,
} from "@quagga/types";

// The read-only plan's geometry (docs/camp-layout-spec.md §Surfaces; frame
// L3 QZeG7 / t7aOZ3). PURE — no React, no DOM. `<LayoutPlan>` draws what
// this returns, so the member view, the phone view, the print page, the
// camp tile's thumbnail and the org console's snapshot are one drawing of
// one metre document.
//
// UNITS. The document is metres (plot-local, origin at the frontage-left
// corner, y into the depth). The plan is drawn in SVG user units at a scale
// that puts the longer side of the content at `PLAN_TARGET_PX`, so labels
// keep a sane size against the plot whatever its size, and the SVG then
// scales to its container.
//
// NO WARNINGS. Nothing here computes or draws a warning: the read-only plan
// reaches plain members and AfrikaBurn's reviewers, and warnings are for the
// camp's editors only (14 Oct decision).

type AnyObject = LayoutObject | NestedLayoutObject;

/** The colour family an object is drawn in — the editor's, by role and
 * palette group. */
export type PlanTone =
  "shelter" | "infrastructure" | "vehicle" | "safety" | "area" | "pole";

export function planTone(e: LayoutCatalogEntry | undefined): PlanTone {
  if (!e) return "vehicle";
  if (e.role === "pole") return "pole";
  if (e.role === "path" || e.role === "area" || e.role === "entrance") {
    return "area";
  }
  switch (e.group) {
    case "vehicles":
      return "vehicle";
    case "infrastructure":
      return "infrastructure";
    case "safety":
      return "safety";
    case "areas":
      return "area";
    default:
      return "shelter";
  }
}

/** "6 × 4 m" / "Ø 3 m": the dimension line on the plan and in the list. */
export function planDims(
  o: Pick<AnyObject, "shape" | "width" | "length" | "diameter">,
): string {
  const t = (v: number) => String(Math.round(v * 10) / 10);
  return o.shape === "circle"
    ? `Ø ${t(o.diameter ?? o.width)} m`
    : `${t(o.width)} × ${t(o.length)} m`;
}

/** What one plan shows: the whole camp, or one shade structure's covered
 * area opened as its own small plot. */
export interface PlanAreaSource {
  ring: Ring;
  objects: readonly AnyObject[];
  frontage: readonly [Vec, Vec] | null;
  /** The shade structure whose covered area this is; null on the whole
   * camp. */
  parent: LayoutObject | null;
}

/**
 * The area to draw. `null` is the whole camp. An id that names no shade
 * structure with a covered area is null — the caller's "not found".
 */
export function planArea(
  doc: LayoutDocument,
  areaId: string | null,
): PlanAreaSource | null {
  if (areaId === null) {
    return {
      ring: boundaryRing(doc.plot.boundary),
      objects: doc.plot.objects,
      frontage: frontageSegment(doc.plot),
      parent: null,
    };
  }
  const parent = doc.plot.objects.find((o) => o.id === areaId);
  if (!parent?.child) return null;
  return {
    ring: childBoundaryRing(parent, parent.child),
    objects: parent.child.objects,
    frontage: null,
    parent,
  };
}

/** The longer side of the drawn content, in SVG user units. */
export const PLAN_TARGET_PX = 800;

export function planScale(box: BBox, target = PLAN_TARGET_PX): number {
  const side = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  return target / Math.max(side, 0.1);
}

const NICE_STEPS = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 250, 500];

/** The smallest "nice" step, in metres, that is at least `minPx` apart. */
export function niceStep(scale: number, minPx: number): number {
  return NICE_STEPS.find((s) => s * scale >= minPx) ?? 500;
}

/** Multiples of `step` from `min` to `max`, inclusive. */
export function ticks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  const first = Math.ceil((min - 1e-9) / step);
  const last = Math.floor((max + 1e-9) / step);
  // By index, not by adding: no drift, and `|| 0` turns -0 into 0.
  for (let i = first; i <= last; i++) {
    out.push(Math.round(i * step * 1000) / 1000 || 0);
  }
  return out;
}

/** How much text an object's drawn box has room for. */
export type LabelFit = "full" | "name" | "icon" | "none";

/** An estimate of a label's width: SVG text is measured only once drawn. */
export function textWidth(text: string, fontPx: number): number {
  return text.length * fontPx * 0.58;
}

export function labelFit(
  wPx: number,
  hPx: number,
  name: string,
  dims: string,
  fontPx: number,
): LabelFit {
  const room = wPx - fontPx * 0.8;
  const nameFits = room >= textWidth(name, fontPx);
  if (
    nameFits &&
    room >= textWidth(dims, fontPx * 0.85) &&
    hPx >= fontPx * 2.9
  ) {
    return "full";
  }
  if (nameFits && hPx >= fontPx * 1.5) return "name";
  if (Math.min(wPx, hPx) >= fontPx * 1.1) return "icon";
  return "none";
}

export type PlanShape =
  | { kind: "polygon"; points: string }
  | { kind: "circle"; cx: number; cy: number; r: number };

export interface PlanItem {
  id: string;
  name: string;
  dims: string;
  tone: PlanTone;
  /** The catalogue's lucide icon name. */
  icon: string | undefined;
  shape: PlanShape;
  /** The footprint's centre, in user units. */
  centre: readonly [number, number];
  /** The footprint's axis-aligned box, in user units. */
  boxW: number;
  boxH: number;
  /** The safety zone (a fire pit's, a generator's), drawn as a faint halo. */
  safety: PlanShape | null;
  /** A shade structure with a covered area: how many things are under it.
   * Null for everything else, and always inside a covered area (nesting is
   * one level deep). */
  nestedCount: number | null;
  fit: LabelFit;
}

export interface PlanTick {
  /** User units along the axis. */
  at: number;
  label: string;
}

export interface PlanLayout {
  width: number;
  height: number;
  scale: number;
  fontPx: number;
  /** The area's outline. */
  outline: string;
  /** The area's bounding box, in user units. */
  areaBox: { x: number; y: number; w: number; h: number };
  frontage: { x1: number; y1: number; x2: number; y2: number } | null;
  /** Grid lines inside the area: positions in user units. */
  gridMinor: { xs: number[]; ys: number[] };
  gridMajor: { xs: number[]; ys: number[] };
  rulers: { x: PlanTick[]; y: PlanTick[] } | null;
  scaleBar: { metres: number; px: number; x: number; y: number } | null;
  /** Inside a shade structure: the band its guy ropes need, the structure's
   * footprint grown by its clearance — as the editor draws it (frames
   * LcZsE, PGk6q). Null on the whole camp or with no clearance. */
  guyZone: { points: string; x: number; y: number; clearanceM: number } | null;
  items: PlanItem[];
}

export interface PlanOptions {
  rulers: boolean;
  scaleBar: boolean;
  /** Size labels are drawn at, in user units. */
  fontPx?: number;
  targetPx?: number;
}

const RULER_LEFT = 34;
const RULER_TOP = 26;
const PAD = 10;
const SCALE_BAR_BAND = 40;

function trimNumber(v: number): string {
  return String(Math.round(v * 10) / 10);
}

function footprintBox(ring: Ring): BBox {
  return bbox(ring);
}

/** Lay out one area for drawing. */
export function buildPlanLayout(
  src: PlanAreaSource,
  catalog: readonly LayoutCatalogEntry[],
  opts: PlanOptions,
): PlanLayout {
  const fontPx = opts.fontPx ?? 13;
  const areaBoxM = bbox(src.ring);

  // Halos and objects may run past the area's edge (that is a warning for
  // the editors, never a reason to crop what was drawn).
  const prepared = src.objects.map((o) => {
    const e = findCatalogEntry(catalog, o.catalogKey);
    const fp: Footprint = objectFootprint(o);
    const ring = footprintRing(fp, 48);
    const halo = o.safetyM > 0 ? inflate(fp, o.safetyM) : null;
    return {
      o,
      e,
      fp,
      ring,
      halo,
      haloRing: halo ? footprintRing(halo, 48) : null,
    };
  });
  // The structure stands centred on its covered area (the editor's rule).
  const guyRing: Ring | null =
    src.parent && src.parent.clearanceM > 0
      ? (() => {
          const p = src.parent;
          const centre: Vec = [
            (areaBoxM.minX + areaBoxM.maxX) / 2,
            (areaBoxM.minY + areaBoxM.maxY) / 2,
          ];
          const fp: Footprint =
            p.shape === "circle"
              ? { kind: "circle", centre, radius: (p.diameter ?? p.width) / 2 }
              : {
                  kind: "rect",
                  centre,
                  width: p.width,
                  length: p.length,
                  rotationDeg: 0,
                };
          return footprintRing(inflate(fp, p.clearanceM), 48);
        })()
      : null;
  const allPoints: Vec[] = [...src.ring, ...(guyRing ?? [])];
  for (const p of prepared) {
    allPoints.push(...p.ring);
    if (p.haloRing) allPoints.push(...p.haloRing);
  }
  const content = bbox(allPoints);
  const scale = planScale(content, opts.targetPx);

  const left = opts.rulers ? RULER_LEFT : PAD;
  const top = opts.rulers ? RULER_TOP : PAD;
  const bottom = opts.scaleBar ? SCALE_BAR_BAND : PAD;
  const X = (x: number) => left + (x - content.minX) * scale;
  const Y = (y: number) => top + (y - content.minY) * scale;
  const pts = (ring: Ring) =>
    ring.map(([x, y]) => `${round(X(x))},${round(Y(y))}`).join(" ");
  const shapeOf = (fp: Footprint, ring: Ring): PlanShape =>
    fp.kind === "circle"
      ? {
          kind: "circle",
          cx: round(X(fp.centre[0])),
          cy: round(Y(fp.centre[1])),
          r: round(fp.radius * scale),
        }
      : { kind: "polygon", points: pts(ring) };

  const width = left + (content.maxX - content.minX) * scale + PAD;
  const height = top + (content.maxY - content.minY) * scale + bottom;

  const major = niceStep(scale, 48);
  const minor = major / 5 >= 0.5 && (major / 5) * scale >= 8 ? major / 5 : null;
  const gx = (step: number) =>
    ticks(areaBoxM.minX, areaBoxM.maxX, step).map((v) => round(X(v)));
  const gy = (step: number) =>
    ticks(areaBoxM.minY, areaBoxM.maxY, step).map((v) => round(Y(v)));

  // Support poles paint last, so a pole under a tent stays visible.
  const ordered = [
    ...prepared.filter((p) => p.e?.role !== "pole"),
    ...prepared.filter((p) => p.e?.role === "pole"),
  ];
  const items: PlanItem[] = ordered.map(
    ({ o, e, fp, ring, halo, haloRing }) => {
      const b = footprintBox(ring);
      const boxW = (b.maxX - b.minX) * scale;
      const boxH = (b.maxY - b.minY) * scale;
      const name = layoutObjectName(o, catalog);
      const dims = planDims(o);
      const child = src.parent === null ? (o as LayoutObject).child : undefined;
      return {
        id: o.id,
        name,
        dims,
        tone: planTone(e),
        icon: e?.icon,
        shape: shapeOf(fp, ring),
        centre: [round(X(fp.centre[0])), round(Y(fp.centre[1]))],
        boxW: round(boxW),
        boxH: round(boxH),
        safety: halo && haloRing ? shapeOf(halo, haloRing) : null,
        nestedCount: e?.nestable && child ? child.objects.length : null,
        fit: labelFit(boxW, boxH, name, dims, fontPx),
      };
    },
  );

  let frontage: PlanLayout["frontage"] = null;
  if (src.frontage) {
    const [a, b] = src.frontage;
    frontage = {
      x1: round(X(a[0])),
      y1: round(Y(a[1])),
      x2: round(X(b[0])),
      y2: round(Y(b[1])),
    };
  }

  const rulerStep = niceStep(scale, 44);
  const rulers = opts.rulers
    ? {
        x: ticks(areaBoxM.minX, areaBoxM.maxX, rulerStep).map((v, i, all) => ({
          at: round(X(v)),
          label: i === all.length - 1 ? `${trimNumber(v)} m` : trimNumber(v),
        })),
        y: ticks(areaBoxM.minY, areaBoxM.maxY, rulerStep).map((v) => ({
          at: round(Y(v)),
          label: trimNumber(v),
        })),
      }
    : null;

  // A scale bar about 120 units long, in a nice number of metres.
  const barMetres = niceStep(scale, 90);
  const scaleBar = opts.scaleBar
    ? {
        metres: barMetres,
        px: round(barMetres * scale),
        x: left,
        y: round(height - SCALE_BAR_BAND + 14),
      }
    : null;

  return {
    width: round(width),
    height: round(height),
    scale,
    fontPx,
    outline: pts(src.ring),
    areaBox: {
      x: round(X(areaBoxM.minX)),
      y: round(Y(areaBoxM.minY)),
      w: round((areaBoxM.maxX - areaBoxM.minX) * scale),
      h: round((areaBoxM.maxY - areaBoxM.minY) * scale),
    },
    frontage,
    gridMinor: minor ? { xs: gx(minor), ys: gy(minor) } : { xs: [], ys: [] },
    gridMajor: { xs: gx(major), ys: gy(major) },
    rulers,
    scaleBar,
    guyZone:
      guyRing && src.parent
        ? (() => {
            const g = bbox(guyRing);
            return {
              points: pts(guyRing),
              x: round(X(g.minX)),
              y: round(Y(g.minY)),
              clearanceM: src.parent.clearanceM,
            };
          })()
        : null,
    items,
  };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** "mad-hatters-layout-2027.png", or "…-bedouin-1.png" inside a covered
 * area. Lower case, no spaces, nothing a file system dislikes. */
export function planFileName(
  slug: string,
  editionYear: number,
  areaName?: string | null,
): string {
  const where = areaName ? `-${areaName}` : "";
  return `${slug}-layout-${editionYear}${where}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .concat(".png");
}
