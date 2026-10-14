// Camp layout policy (docs/camp-layout-spec.md §Rules). PURE — no I/O.
//
// The geometry is @quagga/geo (rectangles, circles, rings, frames). This file
// is the policy on top of it: who may see and edit a camp's plan, what a
// layout document may contain beyond its shape (the catalogue check), the
// advisory warnings, the plot summary, carry-forward into a new edition and
// when a snapshot is pinned for AfrikaBurn.
//
// WHO. Every current member of the camp VIEWS the plan (decision 6). Leads
// and co-leads — the structural lead/admin, irrevocably — and holders of
// `manage_layout` EDIT it (decision 5). Strangers, members of other camps and
// former members get the camp's own "not found". The plan is never public:
// it shows where people sleep and where the gas and generators are
// (gis-placement-spec §H). The org reads only the snapshot pinned at submit,
// on the registration-read capability it already has (decision 10).
//
// WARNINGS ARE ADVICE. They never block a save or a submit (decision 14), and
// they are shown to editors only — not to plain members, and not in the org's
// snapshot view (14 Oct frame decision). Each one names its measurement.
//
// NO PERSONAL DATA. A layout holds free-text labels editors write ("Alice's
// tent") and nothing linked to a membership (decision 7). No new privacy class.

import type {
  GroupKind,
  LayoutBoundary,
  LayoutChildArea,
  LayoutDocument,
  LayoutObject,
  NestedLayoutObject,
} from "@quagga/types";
import { LAYOUT_MAX_PLOT_M, LAYOUT_MIN_SIZE_M } from "@quagga/types";
import {
  area as ringArea,
  bbox,
  bboxSize,
  circleRing,
  distanceToRingEdge,
  EPSILON,
  footprintArea,
  footprintDistance,
  footprintDistanceToSegment,
  footprintInsideRing,
  inflate,
  intersectionRing,
  overflowBeyondRing,
  overlaps,
  penetrationDepth,
  rectRing,
  rotate,
  sub,
  toParent,
  angleToParent,
  vertexAt,
  type Footprint,
  type Frame,
  type Ring,
  type Vec,
} from "@quagga/geo";
import type { CampAction } from "./registration-state";
import {
  hasProjectPermission,
  type PermissionMembership,
} from "./project-permissions";
import { orgCanInDomain, type OrgActor } from "./org-permissions";
import {
  findCatalogEntry,
  FRONTAGE_CLEAR_M,
  placeableIn,
  type LayoutCatalogEntry,
  type LayoutObjectRole,
} from "./layout-catalog";

// --- Access ------------------------------------------------------------------

/** Layouts belong to a theme camp's registration. Artworks and mutant
 * vehicles register differently and have no plot. */
export function layoutAvailableForGroup(kind: GroupKind): boolean {
  return kind === "theme_camp";
}

/** Every CURRENT member reads the plan. `null` is "not a member" — the
 * caller has already turned an archived membership into null. */
export function canViewCampLayout(
  membership: PermissionMembership | null,
): boolean {
  return membership !== null;
}

/** Lead/admin (the irrevocable backstop) or a `manage_layout` grant. */
export function canEditCampLayout(
  membership: PermissionMembership | null,
): boolean {
  return (
    membership !== null && hasProjectPermission(membership, "manage_layout")
  );
}

/** Warnings are for the people who can act on them (14 Oct decision). */
export function canSeeLayoutWarnings(
  membership: PermissionMembership | null,
): boolean {
  return canEditCampLayout(membership);
}

/** Every current member may download the PNG and print the plan. */
export function canExportCampLayout(
  membership: PermissionMembership | null,
): boolean {
  return canViewCampLayout(membership);
}

/** The org sees the PINNED SNAPSHOT on the registration-read capability it
 * already has — nothing new to grant, nothing new to audit. Never the working
 * document, and never the warnings. */
export function canOrgViewLayoutSnapshot(
  actor: OrgActor | null | undefined,
): boolean {
  return orgCanInDomain(actor, "read", "registrations");
}

// --- Refusals ------------------------------------------------------------------

export type LayoutRefusal =
  | "not_found"
  | "not_editor"
  | "no_registration"
  | "layout_exists"
  | "no_layout"
  | "no_source"
  | "stale"
  | "unknown_object"
  | "shape_mismatch"
  | "not_nestable"
  | "wrong_level";

const REFUSAL_MESSAGES: Record<LayoutRefusal, string> = {
  // The SAME answer a slug that does not exist gets: a non-member learns
  // nothing about whether the camp exists.
  not_found: "Camp not found.",
  not_editor: "Only the camp's leads and layout editors can change the plan.",
  no_registration:
    "The layout belongs to your registration for this edition. Start that first.",
  layout_exists: "This camp already has a layout for this edition.",
  no_layout: "There's no layout for this edition yet.",
  no_source: "There's no layout from an earlier year to start from.",
  stale:
    "This layout changed since you opened it. Reload to carry on from the latest version.",
  unknown_object: "That object isn't in this year's palette.",
  shape_mismatch: "That object has the wrong shape for its kind.",
  not_nestable: "Only shade structures can hold objects inside them.",
  wrong_level: "That object can't go there.",
};

export function layoutRefusalMessage(reason: LayoutRefusal): string {
  return REFUSAL_MESSAGES[reason];
}

/** Audit actions. Ids, versions and counts only in `meta` — never a label or a
 * note, so account erasure has nothing to chase into the trail. */
export const LAYOUT_AUDIT = {
  create: "camp.layout.create",
  save: "camp.layout.save",
  carryForward: "camp.layout.carry_forward",
  pin: "camp.layout.snapshot_pin",
} as const;

// --- Decisions -----------------------------------------------------------------

export function decideLayoutCreate(facts: {
  canEdit: boolean;
  hasRegistration: boolean;
  hasLayout: boolean;
}): LayoutRefusal | null {
  if (!facts.canEdit) return "not_editor";
  if (!facts.hasRegistration) return "no_registration";
  if (facts.hasLayout) return "layout_exists";
  return null;
}

/** "Start from last year's layout": one click, never automatic, and never
 * over a layout that already exists (decision 12). */
export function decideStartFromLastYear(facts: {
  canEdit: boolean;
  hasRegistration: boolean;
  hasLayout: boolean;
  hasSource: boolean;
}): LayoutRefusal | null {
  const create = decideLayoutCreate(facts);
  if (create) return create;
  if (!facts.hasSource) return "no_source";
  return null;
}

/** Compare-and-set: a save names the version it was made from, and anything
 * else is refused, never merged. Undo and redo are client-side only. */
export function decideLayoutSave(facts: {
  canEdit: boolean;
  currentVersion: number | null;
  expectedVersion: number;
}): LayoutRefusal | null {
  if (!facts.canEdit) return "not_editor";
  if (facts.currentVersion === null) return "no_layout";
  if (facts.currentVersion !== facts.expectedVersion) return "stale";
  return null;
}

/**
 * The catalogue check every write runs after the Zod parse: every object is
 * a key this edition offers, in that entry's shape, at a level it may sit
 * at, and only shade structures hold a covered area. Returns the first
 * problem, or null.
 */
export function checkLayoutAgainstCatalog(
  doc: LayoutDocument,
  catalog: readonly LayoutCatalogEntry[],
): { reason: LayoutRefusal; objectId: string } | null {
  const check = (
    o: LayoutObject | NestedLayoutObject,
    level: "plot" | "nested",
  ): LayoutRefusal | null => {
    const e = findCatalogEntry(catalog, o.catalogKey);
    if (!e) return "unknown_object";
    if (e.shape !== o.shape) return "shape_mismatch";
    if (!placeableIn(e, level)) return "wrong_level";
    if ("child" in o && o.child !== undefined && !e.nestable) {
      return "not_nestable";
    }
    return null;
  };
  for (const o of doc.plot.objects) {
    const r = check(o, "plot");
    if (r) return { reason: r, objectId: o.id };
    for (const c of o.child?.objects ?? []) {
      const rc = check(c, "nested");
      if (rc) return { reason: rc, objectId: c.id };
    }
  }
  return null;
}

// --- Geometry adapters ------------------------------------------------------

type AnyObject = LayoutObject | NestedLayoutObject;

/** An object's ground footprint, in its parent area's metres. */
export function objectFootprint(o: AnyObject): Footprint {
  if (o.shape === "circle") {
    return {
      kind: "circle",
      centre: o.centre,
      radius: (o.diameter ?? o.width) / 2,
    };
  }
  return {
    kind: "rect",
    centre: o.centre,
    width: o.width,
    length: o.length,
    rotationDeg: o.rotationDeg,
  };
}

/** A boundary as a ring in its own area's metres. */
export function boundaryRing(b: LayoutBoundary): Ring {
  return b.kind === "rect" ? rectRing(b.width, b.depth) : b.ring;
}

/** Width, depth (the bounding box, for a polygon) and area, in m and m². */
export function boundaryDimensions(b: LayoutBoundary): {
  width: number;
  depth: number;
  areaM2: number;
} {
  if (b.kind === "rect") {
    return { width: b.width, depth: b.depth, areaM2: b.width * b.depth };
  }
  const [width, depth] = bboxSize(bbox(b.ring));
  return { width, depth, areaM2: ringArea(b.ring) };
}

/**
 * The frame of a shade structure's covered area. The covered area is
 * CENTRED on the structure and turns with it; its origin is the area's own
 * corner, so a tent at (4, 4) is 4 m in from the corner the editor shows as
 * 0, 0 — at any rotation of the structure.
 */
export function childFrame(
  o: Pick<LayoutObject, "centre" | "rotationDeg">,
  boundary: LayoutBoundary,
): Frame {
  const b =
    boundary.kind === "rect"
      ? { minX: 0, minY: 0, maxX: boundary.width, maxY: boundary.depth }
      : bbox(boundary.ring);
  const mid: Vec = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  return {
    origin: sub(o.centre, rotate(mid, o.rotationDeg)),
    rotationDeg: o.rotationDeg,
  };
}

/** How many edges stand in for a round covered area (a dome). */
const ROUND_COVER_SEGMENTS = 64;

/**
 * The covered area's outline, in its own metres. Under a ROUND structure (a
 * dome) a rectangular boundary means the circle inscribed in it — the
 * corners of the square are outside the dome. A polygon is used as given.
 */
export function childBoundaryRing(
  parent: Pick<LayoutObject, "shape">,
  child: Pick<LayoutChildArea, "boundary">,
): Ring {
  const b = child.boundary;
  if (b.kind === "rect" && parent.shape === "circle") {
    return circleRing(
      {
        kind: "circle",
        centre: [b.width / 2, b.depth / 2],
        radius: Math.min(b.width, b.depth) / 2,
      },
      ROUND_COVER_SEGMENTS,
    );
  }
  return boundaryRing(b);
}

/** A new covered area for a shade structure: its own footprint (TENT-002).
 * The editor lets the camp shrink it — the covered area is smaller than the
 * outer footprint, which includes guy ropes. */
export function defaultChildArea(
  o: Pick<LayoutObject, "shape" | "width" | "length" | "diameter">,
): LayoutChildArea {
  const w = o.shape === "circle" ? (o.diameter ?? o.width) : o.width;
  const d = o.shape === "circle" ? (o.diameter ?? o.width) : o.length;
  return { boundary: { kind: "rect", width: w, depth: d }, objects: [] };
}

/** A nested object's footprint on the WHOLE plot — for the read-only plan,
 * print and the ghosted context. */
export function nestedFootprintOnPlot(
  parent: LayoutObject & { child: LayoutChildArea },
  o: NestedLayoutObject,
): Footprint {
  const frame = childFrame(parent, parent.child.boundary);
  const f = objectFootprint(o);
  const centre = toParent(frame, f.centre);
  return f.kind === "circle"
    ? { ...f, centre }
    : { ...f, centre, rotationDeg: angleToParent(frame, f.rotationDeg) };
}

/** The frontage edge of the plot, as a segment in plot metres. */
export function frontageSegment(
  plot: LayoutDocument["plot"],
): readonly [Vec, Vec] {
  const ring = boundaryRing(plot.boundary);
  const i = plot.frontageEdge ?? 0;
  return [vertexAt(ring, i), vertexAt(ring, i + 1)];
}

// --- Summary (ERF-002: shown, not warned) -----------------------------------

export interface LayoutAreaSummary {
  width: number;
  depth: number;
  areaM2: number;
  objectCount: number;
  tentCount: number;
  /** Ground covered by objects — areas (zones) and paths excluded. */
  footprintM2: number;
  tentFootprintM2: number;
  /** footprintM2 as a whole percentage of the area. */
  coveredPct: number;
}

function roleOf(
  catalog: readonly LayoutCatalogEntry[],
  o: AnyObject,
): LayoutObjectRole {
  return findCatalogEntry(catalog, o.catalogKey)?.role ?? "object";
}

function summarise(
  ring: Ring,
  dims: { width: number; depth: number },
  objects: readonly AnyObject[],
  catalog: readonly LayoutCatalogEntry[],
): LayoutAreaSummary {
  const areaM2 = ringArea(ring);
  let footprintM2 = 0;
  let tentFootprintM2 = 0;
  let tentCount = 0;
  for (const o of objects) {
    const role = roleOf(catalog, o);
    if (role === "area" || role === "path") continue;
    const a = footprintArea(objectFootprint(o));
    footprintM2 += a;
    if (role === "tent") {
      tentCount += 1;
      tentFootprintM2 += a;
    }
  }
  return {
    width: dims.width,
    depth: dims.depth,
    areaM2,
    objectCount: objects.length,
    tentCount,
    footprintM2,
    tentFootprintM2,
    coveredPct: areaM2 > 0 ? Math.round((footprintM2 / areaM2) * 100) : 0,
  };
}

/** The whole camp's summary: plot size and area, objects on it. */
export function plotSummary(
  doc: LayoutDocument,
  catalog: readonly LayoutCatalogEntry[],
): LayoutAreaSummary & { totalObjectCount: number } {
  const s = summarise(
    boundaryRing(doc.plot.boundary),
    boundaryDimensions(doc.plot.boundary),
    doc.plot.objects,
    catalog,
  );
  const nested = doc.plot.objects.reduce(
    (n, o) => n + (o.child?.objects.length ?? 0),
    0,
  );
  return { ...s, totalObjectCount: s.objectCount + nested };
}

/** A covered area's summary: "7 tents · 36 m² of the 96 m² covered". */
export function coveredAreaSummary(
  parent: LayoutObject & { child: LayoutChildArea },
  catalog: readonly LayoutCatalogEntry[],
): LayoutAreaSummary {
  return summarise(
    childBoundaryRing(parent, parent.child),
    boundaryDimensions(parent.child.boundary),
    parent.child.objects,
    catalog,
  );
}

const SQM = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Metres to one decimal, the way every readout and warning shows them. */
export function formatMetres(v: number): string {
  return `${(Math.round(v * 10) / 10).toFixed(1)} m`;
}

function trimMetres(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/** "40 m × 30 m · 1,200 m²" — the "From your layout" line (decision 11) and
 * the camp tile. A comma for thousands, as the frames show it, whatever the
 * server's locale. */
export function formatPlotSize(d: {
  width: number;
  depth: number;
  areaM2: number;
}): string {
  const area = SQM.format(Math.round(d.areaM2));
  return `${trimMetres(d.width)} m × ${trimMetres(d.depth)} m · ${area} m²`;
}

// --- Warnings ---------------------------------------------------------------------

export type LayoutWarningCode =
  | "overlap"
  | "clearance"
  | "safety_zone"
  | "out_of_bounds"
  | "exceeds_covered_area"
  | "edge_safety_zone"
  | "edge_clearance"
  | "pathway_blocked"
  | "on_support_pole"
  | "rigging_zone"
  | "frontage_obstructed";

export interface LayoutWarning {
  code: LayoutWarningCode;
  /** "note" is the softer kind: a clearance halo, not a footprint. */
  severity: "warning" | "note";
  /** The headline, naming the measurement. */
  message: string;
  /** What to do, or the second measurement. */
  detail: string;
  /** The objects it is about; the warnings panel selects them. */
  objectIds: string[];
  /** Null on the whole camp; the shade structure's id inside a covered area. */
  areaId: string | null;
  /** The App Spec id, where there is one. */
  requirement: string | null;
}

interface Item {
  o: AnyObject;
  e: LayoutCatalogEntry | undefined;
  role: LayoutObjectRole;
  fp: Footprint;
  name: string;
}

/** The name a warning uses: the camp's label, else the palette's. */
export function layoutObjectName(
  o: Pick<AnyObject, "label" | "catalogKey">,
  catalog: readonly LayoutCatalogEntry[],
): string {
  const label = o.label?.trim();
  if (label) return label;
  return findCatalogEntry(catalog, o.catalogKey)?.label ?? o.catalogKey;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** A footprint's overlap region measured W × D in the area's axes. */
function overlapSize(a: Footprint, b: Footprint): string {
  const shared = intersectionRing(a, b);
  const [w, d] = shared.length ? bboxSize(bbox(shared)) : [0, 0];
  const one = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
  return `${one(w)} × ${one(d)} m`;
}

function areaWarnings(
  ring: Ring,
  level: "plot" | "nested",
  objects: readonly AnyObject[],
  catalog: readonly LayoutCatalogEntry[],
  areaId: string | null,
  frontage: readonly [Vec, Vec] | null,
): LayoutWarning[] {
  const out: LayoutWarning[] = [];
  const push = (
    w: Omit<LayoutWarning, "areaId" | "requirement"> & {
      requirement?: string;
    },
  ) => out.push({ ...w, areaId, requirement: w.requirement ?? null });
  const items: Item[] = objects.map((o) => {
    const e = findCatalogEntry(catalog, o.catalogKey);
    return {
      o,
      e,
      role: e?.role ?? "object",
      fp: objectFootprint(o),
      name: layoutObjectName(o, catalog),
    };
  });

  // Bounds, and halos crossing the edge.
  for (const it of items) {
    if (!footprintInsideRing(it.fp, ring)) {
      const over = overflowBeyondRing(it.fp, ring);
      const measured = over >= 0.05;
      if (level === "nested") {
        push({
          code: "exceeds_covered_area",
          severity: "warning",
          message: measured
            ? `${it.name} exceeds the covered area by ${formatMetres(over)}`
            : `${it.name} exceeds the covered area`,
          detail: "Move it under the shade, or make the covered area larger.",
          objectIds: [it.o.id],
          requirement: "TENT-029",
        });
      } else {
        push({
          code: "out_of_bounds",
          severity: "warning",
          message: measured
            ? `${it.name} is ${formatMetres(over)} outside the plot`
            : `${it.name} crosses the plot edge`,
          detail: "Move it inside the plot, or make the plot larger.",
          objectIds: [it.o.id],
        });
      }
      continue;
    }
    if (level !== "plot") continue;
    const d = distanceToRingEdge(it.fp, ring);
    if (it.o.safetyM > d + EPSILON) {
      push({
        code: "edge_safety_zone",
        severity: "warning",
        message: `${it.name} is ${formatMetres(d)} from the plot edge`,
        detail: `Its ${trimMetres(it.o.safetyM)} m safety zone crosses the edge.`,
        objectIds: [it.o.id],
      });
    } else if (it.o.clearanceM > d + EPSILON) {
      push({
        code: "edge_clearance",
        severity: "note",
        message: `${it.name} is ${formatMetres(d)} from the plot edge`,
        detail: `Its ${trimMetres(it.o.clearanceM)} m clearance crosses the edge.`,
        objectIds: [it.o.id],
      });
    }
  }

  // Pairs.
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      pairWarning(a, b, push);
    }
  }

  // Frontage: "no cars or tents up front".
  if (frontage) {
    for (const it of items) {
      if (!it.e?.keepOffFrontage) continue;
      const d = footprintDistanceToSegment(it.fp, frontage[0], frontage[1]);
      if (d < FRONTAGE_CLEAR_M - EPSILON) {
        push({
          code: "frontage_obstructed",
          severity: "warning",
          message: `${it.name} is ${formatMetres(d)} from the frontage`,
          detail: `No cars or tents up front: keep them at least ${FRONTAGE_CLEAR_M} m back (an estimate).`,
          objectIds: [it.o.id],
        });
      }
    }
  }
  return out;
}

function pairWarning(
  a: Item,
  b: Item,
  push: (
    w: Omit<LayoutWarning, "areaId" | "requirement"> & {
      requirement?: string;
    },
  ) => void,
): void {
  // Zones never collide: things are placed INSIDE them.
  if (a.role === "area" || b.role === "area") return;

  // A path, and something on it (TENT-025, LAYOUT-027–029).
  if (a.role === "path" || b.role === "path") {
    if (a.role === "path" && b.role === "path") return;
    const path = a.role === "path" ? a : b;
    const other = path === a ? b : a;
    if (other.role === "entrance") return;
    if (!overlaps(path.fp, other.fp)) return;
    const what = lowerFirst(path.e?.label ?? "walkway");
    push({
      code: "pathway_blocked",
      severity: "warning",
      message: `${other.name} blocks the ${what} by ${formatMetres(penetrationDepth(path.fp, other.fp))}`,
      detail: `Keep the ${what} clear.`,
      objectIds: [other.o.id, path.o.id],
      requirement: "TENT-025",
    });
    return;
  }
  if (a.role === "entrance" || b.role === "entrance") return;

  // A support pole (TENT-026).
  if (a.role === "pole" || b.role === "pole") {
    if (a.role === "pole" && b.role === "pole") return;
    const pole = a.role === "pole" ? a : b;
    const other = pole === a ? b : a;
    if (!overlaps(pole.fp, other.fp)) return;
    const [x, y] = pole.fp.centre;
    push({
      code: "on_support_pole",
      severity: "warning",
      message: `${other.name} sits on a support pole`,
      detail: `The pole at ${formatMetres(x)}, ${formatMetres(y)} is under it.`,
      objectIds: [other.o.id, pole.o.id],
      requirement: "TENT-026",
    });
    return;
  }

  // Footprints overlap (TENT-024).
  if (overlaps(a.fp, b.fp)) {
    push({
      code: "overlap",
      severity: "warning",
      message: `${a.name} overlaps ${b.name} by ${overlapSize(a.fp, b.fp)}`,
      detail: "Move either to clear it.",
      objectIds: [a.o.id, b.o.id],
      requirement: "TENT-024",
    });
    return;
  }

  const gap = footprintDistance(a.fp, b.fp);

  // A shade structure's rigging zone: inside its clearance halo, outside its
  // covered footprint (TENT-027). Checked before plain clearance, which would
  // otherwise say the same thing more softly.
  for (const [s, other] of [
    [a, b],
    [b, a],
  ] as const) {
    if (!s.e?.nestable || s.o.clearanceM <= 0) continue;
    if (overlaps(inflate(s.fp, s.o.clearanceM), other.fp)) {
      push({
        code: "rigging_zone",
        severity: "warning",
        message: `${other.name} is inside ${s.name}'s rigging zone`,
        detail: `Its guy ropes need ${trimMetres(s.o.clearanceM)} m clear; ${other.name} is ${formatMetres(gap)} away.`,
        objectIds: [other.o.id, s.o.id],
        requirement: "TENT-027",
      });
      return;
    }
  }

  // A safety zone (a fire pit, gas, a generator) — a footprint inside it.
  for (const [s, other] of [
    [a, b],
    [b, a],
  ] as const) {
    if (s.o.safetyM > 0 && gap < s.o.safetyM - EPSILON) {
      push({
        code: "safety_zone",
        severity: "warning",
        message: `${other.name} is ${formatMetres(gap)} from ${s.name}`,
        detail: `That is inside its ${trimMetres(s.o.safetyM)} m safety zone.`,
        objectIds: [other.o.id, s.o.id],
      });
      return;
    }
  }

  // Clearance — the softer note: one footprint inside the other's halo.
  const wanted = Math.max(a.o.clearanceM, b.o.clearanceM);
  if (gap < wanted - EPSILON) {
    const s = a.o.clearanceM >= b.o.clearanceM ? a : b;
    push({
      code: "clearance",
      severity: "note",
      message: `${a.name} and ${b.name} are ${formatMetres(gap)} apart`,
      detail: `${s.name} wants ${trimMetres(s.o.clearanceM)} m clear around it.`,
      objectIds: [a.o.id, b.o.id],
    });
  }
}

/**
 * Every advisory warning for a layout: the whole camp, then each covered
 * area. Warnings before notes; otherwise in document order, so the list is
 * stable as the camp edits.
 */
export function layoutWarnings(
  doc: LayoutDocument,
  catalog: readonly LayoutCatalogEntry[],
): LayoutWarning[] {
  const all = areaWarnings(
    boundaryRing(doc.plot.boundary),
    "plot",
    doc.plot.objects,
    catalog,
    null,
    frontageSegment(doc.plot),
  );
  for (const o of doc.plot.objects) {
    if (!o.child) continue;
    all.push(
      ...areaWarnings(
        childBoundaryRing(o, o.child),
        "nested",
        o.child.objects,
        catalog,
        o.id,
        null,
      ),
    );
  }
  const rank = (w: LayoutWarning) => (w.severity === "warning" ? 0 : 1);
  return all
    .map((w, i) => ({ w, i }))
    .sort((x, y) => rank(x.w) - rank(y.w) || x.i - y.i)
    .map(({ w }) => w);
}

// --- Lifecycle: create, carry forward, pin -------------------------------------

/** "Start with an empty plot". */
export function createEmptyLayoutDocument(
  width: number,
  depth: number,
): LayoutDocument {
  return {
    schemaVersion: 1,
    plot: { boundary: { kind: "rect", width, depth }, objects: [] },
  };
}

function clampSide(v: number): number {
  return Math.min(LAYOUT_MAX_PLOT_M, Math.max(LAYOUT_MIN_SIZE_M, v));
}

/**
 * Last year's plan as this year's starting point (decision 12). Every object
 * gets a NEW id, so nothing in this year's document points into last year's.
 * A GIS outline belongs to last year's ERF, not to the camp: it becomes a
 * rectangle of the same size, and the objects move with it so they keep
 * their places relative to the plot. Labels and notes carry — they are the
 * camp's own words, which is the point of the feature.
 */
export function copyLayoutForNewEdition(
  doc: LayoutDocument,
  newId: () => string,
): LayoutDocument {
  let shift: Vec = [0, 0];
  let boundary: LayoutBoundary = doc.plot.boundary;
  if (boundary.kind === "polygon") {
    const b = bbox(boundary.ring);
    shift = [-b.minX, -b.minY];
    boundary = {
      kind: "rect",
      width: clampSide(b.maxX - b.minX),
      depth: clampSide(b.maxY - b.minY),
    };
  }
  const objects: LayoutObject[] = doc.plot.objects.map((o) => {
    const copy: LayoutObject = {
      ...o,
      id: newId(),
      centre: [o.centre[0] + shift[0], o.centre[1] + shift[1]],
    };
    if (o.child) {
      copy.child = {
        boundary: o.child.boundary,
        objects: o.child.objects.map((c) => ({ ...c, id: newId() })),
      };
    }
    return copy;
  });
  const plot: LayoutDocument["plot"] = { boundary, objects };
  if (
    doc.plot.boundary.kind === "rect" &&
    doc.plot.frontageEdge !== undefined
  ) {
    plot.frontageEdge = doc.plot.frontageEdge;
  }
  return { schemaVersion: 1, plot };
}

/** A snapshot is pinned when the registration goes TO AfrikaBurn: a first
 * submit, and a resubmit after changes were requested (decision 9). Never on
 * a withdraw or a reopen. */
export function shouldPinLayoutSnapshot(action: CampAction): boolean {
  return action === "submit" || action === "resubmit";
}

/** What the editor's banner says about AfrikaBurn's copy. */
export type LayoutSnapshotState =
  "not_sent" | "sent_current" | "changed_since_sent";

export function layoutSnapshotState(
  layoutVersion: number,
  latestPinnedVersion: number | null,
): LayoutSnapshotState {
  if (latestPinnedVersion === null) return "not_sent";
  return layoutVersion === latestPinnedVersion
    ? "sent_current"
    : "changed_since_sent";
}

/** The snapshot the org sees: the most recently pinned. Append-only, so an
 * earlier pin is history, never replaced. */
export function latestLayoutSnapshot<T extends { pinnedAt: Date }>(
  rows: readonly T[],
): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (!best || r.pinnedAt.getTime() > best.pinnedAt.getTime()) best = r;
  }
  return best;
}
