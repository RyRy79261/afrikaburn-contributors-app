import { z } from "zod";

// Camp layout documents (docs/camp-layout-spec.md §Model). This file is the
// VALIDATION authority for a layout crossing a server-action boundary; the
// storage authority is `camp_layouts` / `camp_layout_snapshots` in @quagga/db
// schema.ts, and the rules (catalogue, warnings, who may) live in
// @quagga/core camp-layout.ts.
//
// THE DOCUMENT IS OURS. No Konva or GeoJSON type reaches it. Every length is
// METRES and every angle DEGREES, in plot-local coordinates: origin at the
// frontage-left corner, x along the frontage, y into the depth. That frame is
// the erf-local frame of gis-placement-spec §B.4, so a GIS outline replaces
// the rectangle later with no migration.
//
// WHAT IS REFUSED, and only this: an unknown `schemaVersion`; a non-finite
// number; a size outside 0.1–500 m; a plot larger than 500 m × 500 m; more
// than 400 objects in total; nesting deeper than one level (a nested object
// has no `child` key at all — the objects are STRICT, so it is refused as an
// unknown key); text over its cap; and a document over 256 kB. Advice about
// the geometry (overlaps, out of bounds) is never a refusal — those are
// warnings, computed in @quagga/core and never blocking a save.
//
// STRICT OBJECTS throughout: a key the schema does not name is refused, so
// nothing personal can ride along inside a layout under a name we never
// reviewed. The only free text is `label` and `notes`, which editors write
// and every member of the camp can read.

export const LAYOUT_SCHEMA_VERSION = 1 as const;

/** The smallest and largest size of any one thing on a plan, in metres. */
export const LAYOUT_MIN_SIZE_M = 0.1;
export const LAYOUT_MAX_SIZE_M = 500;
/** The largest plot, each side, in metres. */
export const LAYOUT_MAX_PLOT_M = 500;
/** How far from the plot's origin a position may sit, in metres. Objects may
 * be dragged off the plot (that is a warning, not a refusal), but not to the
 * far side of the Karoo. */
export const LAYOUT_MAX_COORD_M = 2_000;
/** Clearance and safety halos, in metres. */
export const LAYOUT_MAX_HALO_M = 50;
/** Every object in the document, nested ones included. */
export const LAYOUT_MAX_OBJECTS = 400;
/** The serialised document, in bytes (UTF-8). */
export const LAYOUT_MAX_BYTES = 256 * 1024;
export const LAYOUT_LABEL_MAX = 60;
export const LAYOUT_NOTES_MAX = 500;
/** Vertices of a polygon outline (a GIS erf). */
export const LAYOUT_MAX_RING_VERTICES = 500;
export const LAYOUT_SOURCE_REF_MAX = 200;
export const LAYOUT_CATALOG_KEY_MAX = 40;

const Metres = z.number().refine(Number.isFinite, "Not a number.");

const Size = Metres.refine(
  (v) => v >= LAYOUT_MIN_SIZE_M && v <= LAYOUT_MAX_SIZE_M,
  `Sizes are between ${LAYOUT_MIN_SIZE_M} m and ${LAYOUT_MAX_SIZE_M} m.`,
);

const PlotSide = Metres.refine(
  (v) => v >= LAYOUT_MIN_SIZE_M && v <= LAYOUT_MAX_PLOT_M,
  `A plot is at most ${LAYOUT_MAX_PLOT_M} m on each side.`,
);

const Halo = Metres.refine(
  (v) => v >= 0 && v <= LAYOUT_MAX_HALO_M,
  `Clearance and safety zones are between 0 m and ${LAYOUT_MAX_HALO_M} m.`,
);

const Coordinate = Metres.refine(
  (v) => Math.abs(v) <= LAYOUT_MAX_COORD_M,
  "That position is too far from the plot.",
);

/** A point, `[x, y]`, in metres. */
export const LayoutVec = z.tuple([Coordinate, Coordinate]);
export type LayoutVec = z.infer<typeof LayoutVec>;

/** `0 ≤ r < 360`. The editor normalises before it saves. */
const Rotation = Metres.refine(
  (v) => v >= 0 && v < 360,
  "Rotation is between 0° and 360°.",
);

const OptionalText = (max: number) =>
  z.string().max(max, `Keep it under ${max} characters.`).optional();

export const LayoutRectBoundary = z.strictObject({
  kind: z.literal("rect"),
  width: PlotSide,
  depth: PlotSide,
});

/** A real outline from AfrikaBurn's GIS (gis-placement-spec). v1 never
 * writes one; the shape is here so the outline drops in without a
 * migration. */
export const LayoutPolygonBoundary = z
  .strictObject({
    kind: z.literal("polygon"),
    ring: z.array(LayoutVec).min(3).max(LAYOUT_MAX_RING_VERTICES),
    source: z.literal("gis"),
    sourceRef: z.string().min(1).max(LAYOUT_SOURCE_REF_MAX),
  })
  .superRefine((b, ctx) => {
    const xs = b.ring.map((p) => p[0]);
    const ys = b.ring.map((p) => p[1]);
    if (
      Math.max(...xs) - Math.min(...xs) > LAYOUT_MAX_PLOT_M ||
      Math.max(...ys) - Math.min(...ys) > LAYOUT_MAX_PLOT_M
    ) {
      ctx.addIssue({
        code: "custom",
        message: `A plot is at most ${LAYOUT_MAX_PLOT_M} m on each side.`,
      });
    }
    let twiceArea = 0;
    for (let i = 0; i < b.ring.length; i++) {
      const p = b.ring[i]!;
      const q = b.ring[(i + 1) % b.ring.length]!;
      twiceArea += p[0] * q[1] - q[0] * p[1];
    }
    if (Math.abs(twiceArea) / 2 < LAYOUT_MIN_SIZE_M * LAYOUT_MIN_SIZE_M) {
      ctx.addIssue({ code: "custom", message: "That outline has no area." });
    }
  });

export const LayoutBoundary = z.discriminatedUnion("kind", [
  LayoutRectBoundary,
  LayoutPolygonBoundary,
]);
export type LayoutBoundary = z.infer<typeof LayoutBoundary>;

export const LayoutShape = z.enum(["rect", "circle"]);
export type LayoutShape = z.infer<typeof LayoutShape>;

/** LAYOUT-043. */
export const LayoutVisibility = z.enum(["public", "private"]);
export type LayoutVisibility = z.infer<typeof LayoutVisibility>;

const objectFields = {
  /** Stable across edits; the editor's selection and the warnings name it. */
  id: z.string().uuid(),
  /** An edition-scoped catalogue entry (@quagga/core layout-catalog.ts).
   * Whether it EXISTS is checked there, against the catalogue. */
  catalogKey: z
    .string()
    .min(1)
    .max(LAYOUT_CATALOG_KEY_MAX)
    .regex(/^[a-z0-9-]+$/, "Not a catalogue key."),
  shape: LayoutShape,
  /** In the PARENT AREA's metres — the plot, or a covered area. */
  centre: LayoutVec,
  width: Size, // LAYOUT-032
  length: Size, // LAYOUT-033
  diameter: Size.optional(), // LAYOUT-034, circles only
  rotationDeg: Rotation, // LAYOUT-035
  clearanceM: Halo, // LAYOUT-036
  safetyM: Halo, // LAYOUT-037
  label: OptionalText(LAYOUT_LABEL_MAX), // LAYOUT-038, and tent "ownership" text
  notes: OptionalText(LAYOUT_NOTES_MAX), // LAYOUT-039
  visibility: LayoutVisibility, // LAYOUT-043
};

function circleNeedsDiameter(
  o: { shape: LayoutShape; diameter?: number },
  ctx: z.RefinementCtx,
): void {
  if (o.shape === "circle" && o.diameter === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["diameter"],
      message: "A round object needs a diameter.",
    });
  }
}

/** An object inside a covered area. It has no `child`: nesting is one level
 * deep, and the strict object refuses the key outright. */
export const NestedLayoutObject = z
  .strictObject(objectFields)
  .superRefine(circleNeedsDiameter);
export type NestedLayoutObject = z.infer<typeof NestedLayoutObject>;

/** A shade structure's covered area: its own small plot, in its own metres
 * (origin at the covered area's corner; @quagga/core `childFrame`). */
export const LayoutChildArea = z.strictObject({
  boundary: LayoutBoundary,
  objects: z.array(NestedLayoutObject).max(LAYOUT_MAX_OBJECTS),
});
export type LayoutChildArea = z.infer<typeof LayoutChildArea>;

export const LayoutObject = z
  .strictObject({ ...objectFields, child: LayoutChildArea.optional() })
  .superRefine(circleNeedsDiameter);
export type LayoutObject = z.infer<typeof LayoutObject>;

export const LayoutPlot = z.strictObject({
  boundary: LayoutBoundary,
  /** Index of the frontage edge in the boundary's ring. A rectangle's edge 0
   * is the x axis — the frontage, by construction. */
  frontageEdge: z.number().int().min(0).optional(),
  objects: z.array(LayoutObject).max(LAYOUT_MAX_OBJECTS),
});
export type LayoutPlot = z.infer<typeof LayoutPlot>;

/** Every object in a document, nested ones included. */
export function countLayoutObjects(plot: {
  objects: readonly { child?: { objects: readonly unknown[] } }[];
}): number {
  let n = 0;
  for (const o of plot.objects) n += 1 + (o.child?.objects.length ?? 0);
  return n;
}

/** UTF-8 length without TextEncoder, which this package's ES-only lib does
 * not declare. Iterating a string yields code points. */
export function utf8ByteLength(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

export const LayoutDocument = z
  .strictObject({
    schemaVersion: z.literal(LAYOUT_SCHEMA_VERSION),
    plot: LayoutPlot,
  })
  .superRefine((doc, ctx) => {
    if (countLayoutObjects(doc.plot) > LAYOUT_MAX_OBJECTS) {
      ctx.addIssue({
        code: "custom",
        message: `A layout holds at most ${LAYOUT_MAX_OBJECTS} objects.`,
      });
    }
    const ids = new Set<string>();
    for (const o of doc.plot.objects) {
      for (const id of [o.id, ...(o.child?.objects.map((c) => c.id) ?? [])]) {
        if (ids.has(id)) {
          ctx.addIssue({ code: "custom", message: "Two objects share an id." });
          return;
        }
        ids.add(id);
      }
    }
    const edgeCount =
      doc.plot.boundary.kind === "rect" ? 4 : doc.plot.boundary.ring.length;
    if (
      doc.plot.frontageEdge !== undefined &&
      doc.plot.frontageEdge >= edgeCount
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["plot", "frontageEdge"],
        message: "The frontage edge isn't an edge of the plot.",
      });
    }
    if (utf8ByteLength(JSON.stringify(doc)) > LAYOUT_MAX_BYTES) {
      ctx.addIssue({ code: "custom", message: "This layout is too large." });
    }
  });
export type LayoutDocument = z.infer<typeof LayoutDocument>;

// --- Server-action inputs ----------------------------------------------------
// Every input names a camp by slug. Who may act is decided server-side from
// the session, never from the payload.

const Slug = z.string().min(1).max(200);

/** Save the working document: compare-and-set on the version the editor
 * loaded. A stale version is refused, never merged. */
export const SaveCampLayoutInput = z.strictObject({
  slug: Slug,
  expectedVersion: z.number().int().min(1),
  document: LayoutDocument,
});
export type SaveCampLayoutInput = z.infer<typeof SaveCampLayoutInput>;

/** "Start with an empty plot" — the size a camp types in first. */
export const CreateCampLayoutInput = z.strictObject({
  slug: Slug,
  width: PlotSide,
  depth: PlotSide,
});
export type CreateCampLayoutInput = z.infer<typeof CreateCampLayoutInput>;

/** "Start from last year's layout" — one click, nothing else to say. */
export const StartLayoutFromLastYearInput = z.strictObject({ slug: Slug });
export type StartLayoutFromLastYearInput = z.infer<
  typeof StartLayoutFromLastYearInput
>;
