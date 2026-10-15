// The camp layout palette (docs/camp-layout-spec.md §Model "Catalogue";
// gis-placement-spec §D.3). DATA, NOT ENUM MEMBERS: AfrikaBurn's object list
// (App Spec §11 LAYOUT-001–031, §12 TENT-016–023) and its sizes change year to
// year, so the list is keyed by edition year exactly as `placement-zones.ts`
// is, and a new edition adds an entry without a migration.
//
// EVERY SIZE IS AN ESTIMATE. No AfrikaBurn source publishes object sizes or
// setbacks (spec decision 15), so each entry carries `estimate: true` and the
// palette says "estimated, check your own". DPW's figures replace them when
// AfrikaBurn publishes some. A camp overrides any size on its own objects.
//
// No Konva type, and nothing about drawing beyond an icon NAME, lives here.

import type { LayoutShape, LayoutVisibility } from "@quagga/types";

/** Palette groups, in the order the palette shows them. "inside" is the
 * palette of a covered area (a Bedouin opened as its own plot). */
export type LayoutCatalogGroup =
  "shelter" | "vehicles" | "infrastructure" | "safety" | "areas" | "inside";

export const LAYOUT_CATALOG_GROUP_LABELS: Record<LayoutCatalogGroup, string> = {
  shelter: "Shelter",
  vehicles: "Vehicles",
  infrastructure: "Infrastructure",
  safety: "Safety",
  areas: "Areas",
  inside: "Inside a Bedouin",
};

/**
 * What a thing IS, for the warnings — not what it is called.
 *  - `tent`     a private tent: overlaps, sits on poles, keeps off the frontage
 *  - `vehicle`  keeps off the frontage
 *  - `pole`     a support pole under a covered area (TENT-003)
 *  - `path`     a walkway, emergency lane or fire break: nothing else may
 *               sit on it (TENT-025, LAYOUT-027–029)
 *  - `entrance` a gap in a covered area's edge (TENT-006); sits ON a path
 *  - `area`     a zone things are placed INSIDE (a private camping area):
 *               it never overlaps anything
 *  - `object`   everything else
 */
export type LayoutObjectRole =
  "tent" | "vehicle" | "pole" | "path" | "entrance" | "area" | "object";

/** Where an entry may be placed: on the whole camp, inside a covered area,
 * or both. */
export type LayoutPlacement = "plot" | "nested" | "both";

export interface LayoutCatalogEntry {
  readonly key: string;
  readonly label: string;
  readonly group: LayoutCatalogGroup;
  /** A lucide icon name. The UI maps it; core never imports an icon. */
  readonly icon: string;
  readonly shape: LayoutShape;
  /** Rect: width × length. Circle: both equal the diameter. Metres. */
  readonly width: number;
  readonly length: number;
  readonly diameter?: number;
  readonly clearanceM: number;
  readonly safetyM: number;
  readonly role: LayoutObjectRole;
  readonly placement: LayoutPlacement;
  /** A shade structure: it may be opened as its own covered area. */
  readonly nestable: boolean;
  /** AfrikaBurn's "no cars or tents up front" (theme-camps-guide.md). */
  readonly keepOffFrontage: boolean;
  readonly visibility: LayoutVisibility;
  /** True until AfrikaBurn confirms the size. Every v1 entry. */
  readonly estimate: boolean;
  /** App Spec requirement ids this entry answers. */
  readonly requirements: readonly string[];
}

/** How far back from the frontage vehicles and tents should stay. An
 * ESTIMATE: AfrikaBurn's rule is "no cars or tents up front" with no figure. */
export const FRONTAGE_CLEAR_M = 5;

type EntryInput = Omit<
  LayoutCatalogEntry,
  | "estimate"
  | "visibility"
  | "nestable"
  | "keepOffFrontage"
  | "placement"
  | "clearanceM"
  | "safetyM"
  | "length"
> &
  Partial<
    Pick<
      LayoutCatalogEntry,
      | "visibility"
      | "nestable"
      | "keepOffFrontage"
      | "placement"
      | "clearanceM"
      | "safetyM"
      | "length"
    >
  >;

/**
 * A catalogue entry with the defaults filled in: no halos, plot-level,
 * tents and vehicles private and kept off the frontage, a circle's diameter
 * from its width.
 */
function entry(e: EntryInput): LayoutCatalogEntry {
  const length = e.length ?? e.width;
  return {
    clearanceM: 0,
    safetyM: 0,
    nestable: false,
    keepOffFrontage: e.role === "tent" || e.role === "vehicle",
    placement: "plot",
    visibility:
      e.role === "tent" || e.role === "vehicle" ? "private" : "public",
    ...e,
    length,
    ...(e.shape === "circle" ? { diameter: e.diameter ?? e.width } : {}),
    estimate: true,
  };
}

/** AfrikaBurn 2027. Sizes are estimates (see the header). */
export const LAYOUT_CATALOG_2027: readonly LayoutCatalogEntry[] = [
  // --- Shelter (LAYOUT-001–006, the tents of TENT-016–023) ---------------
  entry({
    key: "bedouin",
    label: "Bedouin",
    group: "shelter",
    icon: "tent",
    shape: "rect",
    width: 12,
    length: 8,
    clearanceM: 2, // guy ropes
    role: "object",
    nestable: true,
    requirements: ["LAYOUT-001", "TENT-001"],
  }),
  entry({
    key: "stretch-tent",
    label: "Stretch tent",
    group: "shelter",
    icon: "tent",
    shape: "rect",
    width: 10,
    length: 10,
    clearanceM: 2,
    role: "object",
    nestable: true,
    requirements: ["LAYOUT-002"],
  }),
  entry({
    key: "dome",
    label: "Dome",
    group: "shelter",
    icon: "circle-dot",
    shape: "circle",
    width: 6,
    clearanceM: 1,
    role: "object",
    nestable: true,
    requirements: ["LAYOUT-003"],
  }),
  entry({
    key: "gazebo",
    label: "Gazebo",
    group: "shelter",
    icon: "tent-tree",
    shape: "rect",
    width: 3,
    length: 3,
    clearanceM: 1,
    role: "object",
    nestable: true,
    requirements: ["LAYOUT-005"],
  }),
  entry({
    key: "shade",
    label: "Shade",
    group: "shelter",
    icon: "sun",
    shape: "rect",
    width: 8,
    length: 5,
    clearanceM: 1,
    role: "object",
    nestable: true,
    requirements: ["LAYOUT-006"],
  }),
  entry({
    key: "tent-1p",
    label: "Tent · 1 person",
    group: "shelter",
    icon: "tent",
    shape: "rect",
    width: 2.2,
    length: 1,
    clearanceM: 0.5,
    role: "tent",
    placement: "both",
    requirements: ["LAYOUT-004", "TENT-016"],
  }),
  entry({
    key: "tent-2p",
    label: "Tent · 2 person",
    group: "shelter",
    icon: "tent",
    shape: "rect",
    width: 2.5,
    length: 2,
    clearanceM: 0.5,
    role: "tent",
    placement: "both",
    requirements: ["LAYOUT-004", "TENT-017"],
  }),
  entry({
    key: "tent-3p",
    label: "Tent · 3 person",
    group: "shelter",
    icon: "tent",
    shape: "rect",
    width: 2.5,
    length: 2.5,
    clearanceM: 0.5,
    role: "tent",
    placement: "both",
    requirements: ["LAYOUT-004", "TENT-018"],
  }),
  entry({
    key: "tent-4p",
    label: "Tent · 4 person",
    group: "shelter",
    icon: "tent",
    shape: "rect",
    width: 3,
    length: 3,
    clearanceM: 0.5,
    role: "tent",
    placement: "both",
    requirements: ["LAYOUT-004", "TENT-019"],
  }),
  entry({
    key: "tent-family",
    label: "Family tent",
    group: "shelter",
    icon: "tent",
    shape: "rect",
    width: 4,
    length: 3,
    clearanceM: 0.5,
    role: "tent",
    placement: "both",
    requirements: ["LAYOUT-004", "TENT-020"],
  }),
  entry({
    key: "bell-tent",
    label: "Bell tent",
    group: "shelter",
    icon: "tent",
    shape: "circle",
    width: 4,
    clearanceM: 1,
    role: "tent",
    placement: "both",
    requirements: ["LAYOUT-004", "TENT-021"],
  }),
  entry({
    key: "tent-custom",
    label: "Tent · custom size",
    group: "shelter",
    icon: "tent",
    shape: "rect",
    width: 2,
    length: 2,
    clearanceM: 0.5,
    role: "tent",
    placement: "both",
    requirements: ["LAYOUT-004", "TENT-008", "TENT-023"],
  }),

  // --- Vehicles (LAYOUT-007–013, 019; TENT-022) ---------------------------
  entry({
    key: "vehicle",
    label: "Vehicle",
    group: "vehicles",
    icon: "car",
    shape: "rect",
    width: 5,
    length: 2.5,
    role: "vehicle",
    requirements: ["LAYOUT-009"],
  }),
  entry({
    key: "rooftop-tent",
    label: "Vehicle with rooftop tent",
    group: "vehicles",
    icon: "caravan",
    shape: "rect",
    width: 5,
    length: 2.5,
    role: "vehicle",
    requirements: ["LAYOUT-012", "TENT-022"],
  }),
  entry({
    key: "truck",
    label: "Truck",
    group: "vehicles",
    icon: "truck",
    shape: "rect",
    width: 8,
    length: 2.5,
    role: "vehicle",
    requirements: ["LAYOUT-008"],
  }),
  entry({
    key: "trailer",
    label: "Trailer",
    group: "vehicles",
    icon: "container",
    shape: "rect",
    width: 4,
    length: 2,
    role: "vehicle",
    requirements: ["LAYOUT-010"],
  }),
  entry({
    key: "caravan",
    label: "Caravan",
    group: "vehicles",
    icon: "caravan",
    shape: "rect",
    width: 6,
    length: 2.5,
    role: "vehicle",
    requirements: ["LAYOUT-011"],
  }),
  entry({
    key: "container",
    label: "Container",
    group: "vehicles",
    icon: "package",
    shape: "rect",
    width: 6,
    length: 2.5,
    role: "object",
    requirements: ["LAYOUT-007"],
  }),
  entry({
    key: "mutant-vehicle",
    label: "Mutant vehicle",
    group: "vehicles",
    icon: "bus",
    shape: "rect",
    width: 6,
    length: 3,
    role: "object",
    requirements: ["LAYOUT-019"],
  }),

  // --- Infrastructure (LAYOUT-013–018, 020–023) ---------------------------
  entry({
    key: "kitchen",
    label: "Kitchen",
    group: "infrastructure",
    icon: "cooking-pot",
    shape: "rect",
    width: 6,
    length: 4,
    clearanceM: 1,
    role: "object",
    requirements: ["LAYOUT-015"],
  }),
  entry({
    key: "bar",
    label: "Bar",
    group: "infrastructure",
    icon: "wine",
    shape: "rect",
    width: 4,
    length: 3,
    clearanceM: 1,
    role: "object",
    requirements: ["LAYOUT-016"],
  }),
  entry({
    key: "stage",
    label: "Stage",
    group: "infrastructure",
    icon: "music",
    shape: "rect",
    width: 6,
    length: 4,
    clearanceM: 1,
    role: "object",
    requirements: ["LAYOUT-017"],
  }),
  entry({
    key: "sound-system",
    label: "Sound system",
    group: "infrastructure",
    icon: "speaker",
    shape: "rect",
    width: 3,
    length: 2,
    clearanceM: 1,
    role: "object",
    requirements: ["LAYOUT-018"],
  }),
  entry({
    key: "toilet",
    label: "Toilet",
    group: "infrastructure",
    icon: "toilet",
    shape: "rect",
    width: 1.5,
    length: 1.5,
    clearanceM: 0.5,
    role: "object",
    requirements: ["LAYOUT-014"],
  }),
  entry({
    key: "shower-trailer",
    label: "Shower trailer",
    group: "infrastructure",
    icon: "shower-head",
    shape: "rect",
    width: 4,
    length: 2.5,
    clearanceM: 1,
    role: "object",
    requirements: ["LAYOUT-013"],
  }),
  entry({
    key: "solar-farm",
    label: "Solar panels",
    group: "infrastructure",
    icon: "sun-medium",
    shape: "rect",
    width: 6,
    length: 4,
    clearanceM: 0.5,
    role: "object",
    requirements: ["LAYOUT-020"],
  }),
  entry({
    key: "generator",
    label: "Generator",
    group: "infrastructure",
    icon: "zap",
    shape: "rect",
    width: 2,
    length: 1.5,
    safetyM: 2,
    role: "object",
    requirements: ["LAYOUT-021"],
  }),
  entry({
    key: "battery",
    label: "Battery system",
    group: "infrastructure",
    icon: "battery-charging",
    shape: "rect",
    width: 1.5,
    length: 1,
    safetyM: 1,
    role: "object",
    requirements: ["LAYOUT-022"],
  }),
  entry({
    key: "water-tank",
    label: "Water tank",
    group: "infrastructure",
    icon: "droplets",
    shape: "circle",
    width: 2,
    role: "object",
    requirements: ["LAYOUT-023"],
  }),
  entry({
    key: "bike-park",
    label: "Bike park",
    group: "infrastructure",
    icon: "bike",
    shape: "rect",
    width: 6,
    length: 3,
    role: "object",
    requirements: [],
  }),

  // --- Safety (LAYOUT-024–029) --------------------------------------------
  entry({
    key: "fire-pit",
    label: "Fire pit",
    group: "safety",
    icon: "flame",
    shape: "circle",
    width: 3,
    safetyM: 3,
    role: "object",
    requirements: ["LAYOUT-024"],
  }),
  entry({
    key: "gas-storage",
    label: "Gas storage",
    group: "safety",
    icon: "fuel",
    shape: "rect",
    width: 2,
    length: 2,
    safetyM: 3,
    role: "object",
    requirements: ["LAYOUT-025"],
  }),
  entry({
    key: "waste",
    label: "Waste area",
    group: "safety",
    icon: "trash-2",
    shape: "rect",
    width: 3,
    length: 2,
    role: "object",
    requirements: ["LAYOUT-026"],
  }),
  entry({
    key: "walkway",
    label: "Walkway",
    group: "safety",
    icon: "footprints",
    shape: "rect",
    width: 1.5,
    length: 10,
    role: "path",
    placement: "both",
    requirements: ["LAYOUT-027", "TENT-005", "TENT-013"],
  }),
  entry({
    key: "emergency-lane",
    label: "Emergency lane",
    group: "safety",
    icon: "siren",
    shape: "rect",
    width: 4,
    length: 20,
    role: "path",
    requirements: ["LAYOUT-028"],
  }),
  entry({
    key: "fire-break",
    label: "Fire break",
    group: "safety",
    icon: "shield-alert",
    shape: "rect",
    width: 3,
    length: 20,
    role: "path",
    requirements: ["LAYOUT-029"],
  }),

  // --- Areas (LAYOUT-030, 031) --------------------------------------------
  entry({
    key: "area",
    label: "Rectangle area",
    group: "areas",
    icon: "square-dashed",
    shape: "rect",
    width: 5,
    length: 5,
    role: "area",
    requirements: [],
  }),
  entry({
    key: "public-frontage",
    label: "Public frontage",
    group: "areas",
    icon: "store",
    shape: "rect",
    width: 20,
    length: 4,
    role: "area",
    requirements: ["LAYOUT-030"],
  }),
  entry({
    key: "private-camping",
    label: "Private camping area",
    group: "areas",
    icon: "bed",
    shape: "rect",
    width: 10,
    length: 10,
    role: "area",
    visibility: "private",
    requirements: ["LAYOUT-031"],
  }),

  // --- Inside a covered area (TENT-003, 006, 014) -------------------------
  entry({
    key: "support-pole",
    label: "Support pole",
    group: "inside",
    icon: "circle-small",
    shape: "circle",
    width: 0.25,
    role: "pole",
    placement: "nested",
    requirements: ["TENT-003"],
  }),
  entry({
    key: "entrance",
    label: "Entrance",
    group: "inside",
    icon: "door-open",
    shape: "rect",
    width: 1.5,
    length: 0.5,
    role: "entrance",
    placement: "nested",
    requirements: ["TENT-006"],
  }),
  entry({
    key: "accessible-space",
    label: "Accessible space",
    group: "inside",
    icon: "accessibility",
    shape: "rect",
    width: 2.4,
    length: 2.4,
    role: "object",
    placement: "nested",
    requirements: ["TENT-014"],
  }),
];

const CATALOG_BY_YEAR: Record<number, readonly LayoutCatalogEntry[]> = {
  2027: LAYOUT_CATALOG_2027,
};

/** The palette for an edition year. Falls back to 2027 for a year with no
 * list of its own, as the placement zones do. */
export function getLayoutCatalog(year: number): readonly LayoutCatalogEntry[] {
  return CATALOG_BY_YEAR[year] ?? LAYOUT_CATALOG_2027;
}

/** One entry by key, or undefined for a key this edition does not offer. */
export function findCatalogEntry(
  catalog: readonly LayoutCatalogEntry[],
  key: string,
): LayoutCatalogEntry | undefined {
  return catalog.find((e) => e.key === key);
}

/** May an entry be placed at this level? */
export function placeableIn(
  e: Pick<LayoutCatalogEntry, "placement">,
  level: "plot" | "nested",
): boolean {
  return e.placement === "both" || e.placement === level;
}

/** The palette for one level, in group order. */
export function paletteFor(
  catalog: readonly LayoutCatalogEntry[],
  level: "plot" | "nested",
): readonly LayoutCatalogEntry[] {
  return catalog.filter((e) => placeableIn(e, level));
}
