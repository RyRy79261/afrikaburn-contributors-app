import { describe, expect, it } from "vitest";
import {
  LayoutDocument,
  type LayoutChildArea,
  type LayoutObject,
  type NestedLayoutObject,
  type ProjectPermissions,
} from "@quagga/types";
import {
  boundaryDimensions,
  canEditCampLayout,
  canExportCampLayout,
  canOrgViewLayoutSnapshot,
  canSeeLayoutWarnings,
  canViewCampLayout,
  checkLayoutAgainstCatalog,
  childBoundaryRing,
  childFrame,
  copyLayoutForNewEdition,
  coveredAreaSummary,
  createEmptyLayoutDocument,
  decideLayoutCreate,
  decideLayoutSave,
  decideStartFromLastYear,
  defaultChildArea,
  formatMetres,
  formatPlotSize,
  frontageSegment,
  getLayoutCatalog,
  LAYOUT_AUDIT,
  latestLayoutSnapshot,
  layoutAvailableForGroup,
  layoutObjectName,
  layoutRefusalMessage,
  layoutSnapshotState,
  layoutWarnings,
  nestedFootprintOnPlot,
  objectFootprint,
  plotSummary,
  shouldPinLayoutSnapshot,
  type LayoutWarning,
  type PermissionMembership,
} from "../index";

const CATALOG = getLayoutCatalog(2027);

let seq = 0;
function id(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

/** An object from the palette entry `key`, at (x, y), with its defaults. */
function o(
  key: string,
  x: number,
  y: number,
  overrides: Partial<LayoutObject> = {},
): LayoutObject {
  const e = CATALOG.find((c) => c.key === key);
  if (!e) throw new Error(`no catalogue entry ${key}`);
  return {
    id: id(),
    catalogKey: key,
    shape: e.shape,
    centre: [x, y],
    width: e.width,
    length: e.length,
    ...(e.diameter !== undefined ? { diameter: e.diameter } : {}),
    rotationDeg: 0,
    clearanceM: e.clearanceM,
    safetyM: e.safetyM,
    visibility: e.visibility,
    ...overrides,
  };
}

function nested(
  key: string,
  x: number,
  y: number,
  overrides: Partial<NestedLayoutObject> = {},
): NestedLayoutObject {
  const { child: _child, ...rest } = o(key, x, y, overrides);
  return rest;
}

function plot(objects: LayoutObject[], width = 40, depth = 30): LayoutDocument {
  return {
    schemaVersion: 1,
    plot: { boundary: { kind: "rect", width, depth }, objects },
  };
}

function withChild(
  parent: LayoutObject,
  objects: NestedLayoutObject[],
  child?: Partial<LayoutChildArea>,
): LayoutObject {
  return {
    ...parent,
    child: { ...defaultChildArea(parent), objects, ...child },
  };
}

const warn = (d: LayoutDocument) => layoutWarnings(d, CATALOG);
const codes = (ws: LayoutWarning[]) => ws.map((w) => w.code);

/** Every fixture must be a document the server would accept. */
function valid(d: LayoutDocument): LayoutDocument {
  expect(LayoutDocument.safeParse(d).success).toBe(true);
  return d;
}

// --- Access -----------------------------------------------------------------

function member(
  structuralRole: PermissionMembership["structuralRole"],
  ...rolePermissions: ProjectPermissions[]
): PermissionMembership {
  return { structuralRole, rolePermissions };
}

describe("who may see and edit the plan", () => {
  it("lead and admin edit, irrevocably — with no grants at all", () => {
    expect(canEditCampLayout(member("lead"))).toBe(true);
    expect(canEditCampLayout(member("admin"))).toBe(true);
  });

  it("a plain member reads it and cannot edit", () => {
    const m = member("member", {});
    expect(canViewCampLayout(m)).toBe(true);
    expect(canEditCampLayout(m)).toBe(false);
  });

  it("manage_layout makes a member an editor", () => {
    const m = member("member", {}, { manage_layout: true });
    expect(canEditCampLayout(m)).toBe(true);
    expect(canEditCampLayout(member("member", { manage_money: true }))).toBe(
      false,
    );
  });

  it("a non-member sees nothing", () => {
    expect(canViewCampLayout(null)).toBe(false);
    expect(canEditCampLayout(null)).toBe(false);
    expect(canExportCampLayout(null)).toBe(false);
  });

  it("warnings are for editors; download and print are for every member", () => {
    const plain = member("member", {});
    expect(canSeeLayoutWarnings(plain)).toBe(false);
    expect(canSeeLayoutWarnings(member("admin"))).toBe(true);
    expect(
      canSeeLayoutWarnings(member("member", { manage_layout: true })),
    ).toBe(true);
    expect(canExportCampLayout(plain)).toBe(true);
  });

  it("the org reads the snapshot on registration read, and nobody else does", () => {
    expect(canOrgViewLayoutSnapshot(null)).toBe(false);
    expect(
      canOrgViewLayoutSnapshot({ rank: "god", roles: [], domains: {} }),
    ).toBe(true);
    expect(
      canOrgViewLayoutSnapshot({ rank: "org_staff", roles: [], domains: {} }),
    ).toBe(false);
  });

  it("only theme camps have a plot", () => {
    expect(layoutAvailableForGroup("theme_camp")).toBe(true);
    expect(layoutAvailableForGroup("artwork")).toBe(false);
    expect(layoutAvailableForGroup("mutant_vehicle")).toBe(false);
    expect(layoutAvailableForGroup("org")).toBe(false);
  });

  it("a non-member is told the camp does not exist", () => {
    expect(layoutRefusalMessage("not_found")).toBe("Camp not found.");
    expect(layoutRefusalMessage("stale")).toMatch(
      /changed since you opened it/,
    );
  });
});

describe("decisions", () => {
  it("create needs an editor, a registration, and no layout yet", () => {
    const ok = { canEdit: true, hasRegistration: true, hasLayout: false };
    expect(decideLayoutCreate(ok)).toBeNull();
    expect(decideLayoutCreate({ ...ok, canEdit: false })).toBe("not_editor");
    expect(decideLayoutCreate({ ...ok, hasRegistration: false })).toBe(
      "no_registration",
    );
    expect(decideLayoutCreate({ ...ok, hasLayout: true })).toBe(
      "layout_exists",
    );
  });

  it("start from last year never overwrites, and needs a source", () => {
    const ok = {
      canEdit: true,
      hasRegistration: true,
      hasLayout: false,
      hasSource: true,
    };
    expect(decideStartFromLastYear(ok)).toBeNull();
    expect(decideStartFromLastYear({ ...ok, hasLayout: true })).toBe(
      "layout_exists",
    );
    expect(decideStartFromLastYear({ ...ok, hasSource: false })).toBe(
      "no_source",
    );
    expect(decideStartFromLastYear({ ...ok, canEdit: false })).toBe(
      "not_editor",
    );
  });

  it("save is compare-and-set on the version", () => {
    expect(
      decideLayoutSave({
        canEdit: true,
        currentVersion: 12,
        expectedVersion: 12,
      }),
    ).toBeNull();
    expect(
      decideLayoutSave({
        canEdit: true,
        currentVersion: 13,
        expectedVersion: 12,
      }),
    ).toBe("stale");
    expect(
      decideLayoutSave({
        canEdit: true,
        currentVersion: null,
        expectedVersion: 1,
      }),
    ).toBe("no_layout");
    expect(
      decideLayoutSave({
        canEdit: false,
        currentVersion: 12,
        expectedVersion: 12,
      }),
    ).toBe("not_editor");
  });

  it("names its audit actions", () => {
    expect(LAYOUT_AUDIT.save).toBe("camp.layout.save");
    expect(LAYOUT_AUDIT.pin).toBe("camp.layout.snapshot_pin");
  });
});

describe("the catalogue check", () => {
  it("accepts palette objects at their level", () => {
    const d = plot([
      withChild(o("bedouin", 20, 15), [
        nested("tent-2p", 3, 3),
        nested("support-pole", 6, 4),
      ]),
    ]);
    expect(checkLayoutAgainstCatalog(d, CATALOG)).toBeNull();
  });

  it("refuses a key this edition does not offer", () => {
    const bad = o("kitchen", 5, 5, { catalogKey: "hot-tub" });
    expect(checkLayoutAgainstCatalog(plot([bad]), CATALOG)).toEqual({
      reason: "unknown_object",
      objectId: bad.id,
    });
  });

  it("refuses the wrong shape", () => {
    const bad = o("fire-pit", 5, 5, { shape: "rect" });
    expect(checkLayoutAgainstCatalog(plot([bad]), CATALOG)?.reason).toBe(
      "shape_mismatch",
    );
  });

  it("refuses a child on something that is not a shade structure", () => {
    const bad = withChild(o("kitchen", 5, 5), []);
    expect(checkLayoutAgainstCatalog(plot([bad]), CATALOG)?.reason).toBe(
      "not_nestable",
    );
  });

  it("refuses a vehicle under a Bedouin, and a support pole on the open plot", () => {
    const car = nested("vehicle", 3, 3);
    const d = plot([withChild(o("bedouin", 20, 15), [car])]);
    expect(checkLayoutAgainstCatalog(d, CATALOG)).toEqual({
      reason: "wrong_level",
      objectId: car.id,
    });
    expect(
      checkLayoutAgainstCatalog(plot([o("support-pole", 3, 3)]), CATALOG)
        ?.reason,
    ).toBe("wrong_level");
  });
});

// --- Warnings: each type, crossing its threshold in both directions --------------

describe("warnings — a clean plan raises nothing", () => {
  it("no warnings for well-spaced objects", () => {
    const d = valid(
      plot([
        o("kitchen", 10, 15),
        o("kitchen", 20, 15),
        o("fire-pit", 30, 20),
        o("vehicle", 10, 26),
        o("area", 10, 15), // a zone over the kitchen: zones never collide
      ]),
    );
    expect(warn(d)).toEqual([]);
  });
});

describe("overlap (TENT-024)", () => {
  it("names the overlap's size", () => {
    // Kitchen x 18..24 × y 12..16; Shade 2 x 22..30 × y 13..18 → 2 × 3 m.
    const kitchen = o("kitchen", 21, 14, { label: "Kitchen" });
    const shade = o("shade", 26, 15.5, { label: "Shade 2" });
    const ws = warn(valid(plot([kitchen, shade])));
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({
      code: "overlap",
      severity: "warning",
      message: "Kitchen overlaps Shade 2 by 2.0 × 3.0 m",
      objectIds: [kitchen.id, shade.id],
      areaId: null,
      requirement: "TENT-024",
    });
  });

  it("crosses the line both ways: 0.1 m in, flush, 0.1 m clear", () => {
    const a = o("kitchen", 10, 10); // x 7..13
    expect(codes(warn(plot([a, o("kitchen", 15.9, 10)])))).toEqual(["overlap"]);
    // Flush is not an overlap (but is inside the 1 m clearance).
    expect(codes(warn(plot([a, o("kitchen", 16, 10)])))).toEqual(["clearance"]);
    expect(codes(warn(plot([a, o("kitchen", 19.1, 10)])))).toEqual([]);
  });

  it("is rotation-aware", () => {
    // A 6 × 4 kitchen turned 90° is 4 wide: x 8..12. One at x 12.5..18.5 is
    // 0.5 m clear of it; unturned (x 7..13) the two overlap by 0.5 m.
    const turned = o("kitchen", 10, 10, { rotationDeg: 90, clearanceM: 0 });
    const other = o("kitchen", 15.5, 10, { clearanceM: 0 });
    expect(warn(plot([turned, other]))).toEqual([]);
    expect(codes(warn(plot([{ ...turned, rotationDeg: 0 }, other])))).toEqual([
      "overlap",
    ]);
  });
});

describe("clearance (the softer note)", () => {
  it("is owed to whichever object wants it — one side is enough", () => {
    // A kitchen wants 1 m; a container wants none. 0.5 m apart is a note.
    const k = o("kitchen", 10, 10, { label: "Kitchen" }); // x 7..13
    const c = o("container", 16.5, 10, { label: "Container" }); // x 13.5..19.5
    expect(warn(plot([c, k]))).toEqual([
      expect.objectContaining({
        code: "clearance",
        detail: "Kitchen wants 1 m clear around it.",
      }),
    ]);
    expect(warn(plot([c, o("kitchen", 9.5, 10)]))).toEqual([]); // 1.0 m apart
  });

  it("is a note, with both measurements", () => {
    const ws = warn(
      plot([
        o("kitchen", 10, 10, { label: "A" }),
        o("kitchen", 16.9, 10, { label: "B" }),
      ]),
    );
    expect(ws).toEqual([
      expect.objectContaining({
        code: "clearance",
        severity: "note",
        message: "A and B are 0.9 m apart",
        detail: "A wants 1 m clear around it.",
      }),
    ]);
  });
});

describe("out of bounds", () => {
  it("measures how far an object leaves the plot", () => {
    // Container 6 × 2.5: x −1..5 at centre x = 2.
    const c = o("container", 2, 15);
    const ws = warn(plot([c]));
    expect(ws).toEqual([
      expect.objectContaining({
        code: "out_of_bounds",
        message: "Container is 1.0 m outside the plot",
        objectIds: [c.id],
      }),
    ]);
    // Flush against the edge is inside.
    expect(warn(plot([o("container", 3, 15)]))).toEqual([]);
  });

  it("says 'crosses the edge' when no corner is outside — a concave plot", () => {
    const L: LayoutDocument = {
      schemaVersion: 1,
      plot: {
        boundary: {
          kind: "polygon",
          ring: [
            [0, 0],
            [20, 0],
            [20, 10],
            [10, 10],
            [10, 20],
            [0, 20],
          ],
          source: "gis",
          sourceRef: "fixture",
        },
        // A square turned 45° around (9, 9): its corners (9, 6), (12, 9),
        // (9, 12), (6, 9) are all inside the L, but it covers the L's inner
        // corner (10, 10) and so reaches into the cut-away notch.
        objects: [
          o("kitchen", 9, 9, {
            width: 3 * Math.SQRT2,
            length: 3 * Math.SQRT2,
            rotationDeg: 45,
            clearanceM: 0,
          }),
        ],
      },
    };
    expect(warn(valid(L))).toEqual([
      expect.objectContaining({
        code: "out_of_bounds",
        message: "Kitchen crosses the plot edge",
      }),
    ]);
  });
});

describe("a halo crossing the plot edge", () => {
  it("a safety zone is a warning, named in metres", () => {
    // Fire pit Ø3 at x 37.3: 1.2 m from the right edge, its 3 m zone crosses.
    const ws = warn(plot([o("fire-pit", 37.3, 15, { label: "Fire pit" })]));
    expect(ws).toEqual([
      expect.objectContaining({
        code: "edge_safety_zone",
        severity: "warning",
        message: "Fire pit is 1.2 m from the plot edge",
        detail: "Its 3 m safety zone crosses the edge.",
      }),
    ]);
    expect(codes(warn(plot([o("fire-pit", 35.6, 15)])))).toEqual([
      "edge_safety_zone",
    ]);
    expect(warn(plot([o("fire-pit", 35.5, 15)]))).toEqual([]);
  });

  it("a clearance halo is a note", () => {
    // Bedouin 12 × 8 at x 7: 1 m from the edge, 2 m guy ropes.
    expect(warn(plot([o("bedouin", 7, 15)]))).toEqual([
      expect.objectContaining({ code: "edge_clearance", severity: "note" }),
    ]);
    expect(warn(plot([o("bedouin", 8, 15)]))).toEqual([]);
  });
});

describe("pathway or lane blocked (TENT-025)", () => {
  it("names how far into the walkway", () => {
    // Walkway x 19.25..20.75; tent x 17.35..19.85 → 0.6 m in.
    const walk = o("walkway", 20, 20);
    const tent = o("tent-2p", 18.6, 20, { label: "Tent 5" });
    const ws = warn(plot([walk, tent]));
    expect(ws).toEqual([
      expect.objectContaining({
        code: "pathway_blocked",
        message: "Tent 5 blocks the walkway by 0.6 m",
        objectIds: [tent.id, walk.id],
        requirement: "TENT-025",
      }),
    ]);
    // Flush against it is not blocking.
    expect(warn(plot([walk, o("tent-2p", 18, 20)]))).toEqual([]);
  });

  it("emergency lanes and fire breaks are paths too; paths may cross each other", () => {
    const lane = o("emergency-lane", 20, 15);
    expect(codes(warn(plot([lane, o("kitchen", 20, 15)])))).toEqual([
      "pathway_blocked",
    ]);
    expect(
      warn(plot([lane, o("fire-break", 20, 15, { rotationDeg: 90 })])),
    ).toEqual([]);
    expect(warn(plot([lane, o("area", 20, 15)]))).toEqual([]);
  });
});

describe("inside a covered area", () => {
  const bedouin = () =>
    o("bedouin", 20, 15, { label: "Bedouin 1", clearanceM: 0 });

  it("a tent on a support pole (TENT-026)", () => {
    const tent = nested("tent-2p", 4, 4.1, {
      width: 2.2,
      length: 2.2,
      label: "Tent 3",
      clearanceM: 0,
    });
    const pole = nested("support-pole", 4, 4);
    const b = withChild(bedouin(), [tent, pole]);
    const ws = warn(valid(plot([b])));
    expect(ws).toEqual([
      expect.objectContaining({
        code: "on_support_pole",
        message: "Tent 3 sits on a support pole",
        detail: "The pole at 4.0 m, 4.0 m is under it.",
        areaId: b.id,
        requirement: "TENT-026",
      }),
    ]);
    const clear = withChild(bedouin(), [tent, nested("support-pole", 6, 4)]);
    expect(warn(plot([clear]))).toEqual([]);
  });

  it("a tent beyond the covered area (TENT-029)", () => {
    const tent = nested("tent-2p", 11.5, 4, { label: "Tent 6", clearanceM: 0 });
    const ws = warn(plot([withChild(bedouin(), [tent])]));
    expect(ws).toEqual([
      expect.objectContaining({
        code: "exceeds_covered_area",
        message: "Tent 6 exceeds the covered area by 0.8 m",
        requirement: "TENT-029",
      }),
    ]);
    expect(
      warn(
        plot([
          withChild(bedouin(), [
            nested("tent-2p", 10.75, 4, { clearanceM: 0 }),
          ]),
        ]),
      ),
    ).toEqual([]);
  });

  it("a smaller covered area than the footprint is the boundary", () => {
    const tent = nested("tent-2p", 10.75, 4, { clearanceM: 0 });
    const shrunk = withChild(bedouin(), [tent], {
      boundary: { kind: "rect", width: 10, depth: 8 },
    });
    expect(codes(warn(plot([shrunk])))).toEqual(["exceeds_covered_area"]);
  });

  it("under a dome the covered area is round", () => {
    // In the 6 × 6 square, outside the inscribed circle.
    const tent = nested("tent-1p", 1.2, 0.6, { clearanceM: 0 });
    const dome = withChild(o("dome", 20, 15, { clearanceM: 0 }), [tent]);
    expect(codes(warn(valid(plot([dome]))))).toEqual(["exceeds_covered_area"]);
    const square = withChild(
      o("stretch-tent", 20, 15, { width: 6, length: 6, clearanceM: 0 }),
      [tent],
    );
    expect(warn(plot([square]))).toEqual([]);
  });

  it("tents in a covered area are not checked against the frontage", () => {
    // The Bedouin sits 1 m behind the frontage; its tents are under it.
    const b = withChild(o("bedouin", 20, 5, { clearanceM: 0, safetyM: 0 }), [
      nested("tent-2p", 3, 3, { clearanceM: 0 }),
    ]);
    expect(warn(plot([b]))).toEqual([]);
  });
});

describe("rigging zone (TENT-027)", () => {
  // Bedouin x 14..26, 2 m guy ropes.
  const bedouin = () => o("bedouin", 20, 15, { label: "Bedouin 1" });

  it("an object inside the halo, outside the footprint", () => {
    const k = o("kitchen", 29.5, 15, { label: "Kitchen" }); // x 26.5..32.5, 0.5 m away
    expect(warn(plot([bedouin(), k]))).toEqual([
      expect.objectContaining({
        code: "rigging_zone",
        message: "Kitchen is inside Bedouin 1's rigging zone",
        detail: "Its guy ropes need 2 m clear; Kitchen is 0.5 m away.",
        requirement: "TENT-027",
      }),
    ]);
  });

  it("clear at exactly the halo, and the order of the pair does not matter", () => {
    expect(warn(plot([bedouin(), o("kitchen", 31, 15)]))).toEqual([]); // 2.0 m away
    expect(codes(warn(plot([o("kitchen", 30, 15), bedouin()])))).toEqual([
      "rigging_zone",
    ]);
  });
});

describe("safety zone", () => {
  it("a footprint inside a fire pit's safety zone", () => {
    // Fire pit Ø3 at x 20 (edge 21.5); tent from x 22.5 → 1.0 m.
    const ws = warn(
      plot([
        o("fire-pit", 20, 15),
        o("tent-2p", 23.75, 15, { label: "Tent 1" }),
      ]),
    );
    expect(ws).toEqual([
      expect.objectContaining({
        code: "safety_zone",
        message: "Tent 1 is 1.0 m from Fire pit",
      }),
    ]);
    expect(
      warn(plot([o("fire-pit", 20, 15), o("tent-2p", 25.75, 15)])),
    ).toEqual([]);
  });
});

describe("frontage obstructed", () => {
  it("vehicles and private tents keep 5 m back (estimate)", () => {
    const car = o("vehicle", 10, 3.25, { label: "Vehicle 1" }); // y 2..4.5
    expect(warn(plot([car]))).toEqual([
      expect.objectContaining({
        code: "frontage_obstructed",
        message: "Vehicle 1 is 2.0 m from the frontage",
      }),
    ]);
    expect(warn(plot([o("vehicle", 10, 6.25)]))).toEqual([]); // 5.0 m back
    expect(codes(warn(plot([o("tent-2p", 10, 3)])))).toEqual([
      "frontage_obstructed",
    ]);
    // A stage on the frontage is the point of a frontage.
    expect(warn(plot([o("stage", 10, 3)]))).toEqual([]);
  });

  it("follows the frontage edge on a polygon plot", () => {
    const ring: [number, number][] = [
      [0, 0],
      [40, 0],
      [40, 30],
      [0, 30],
    ];
    const base = {
      kind: "polygon" as const,
      ring,
      source: "gis" as const,
      sourceRef: "fixture",
    };
    const car = o("vehicle", 10, 27, {}); // 1.75 m from the y = 30 edge (edge 2)
    const back: LayoutDocument = {
      schemaVersion: 1,
      plot: { boundary: base, frontageEdge: 2, objects: [car] },
    };
    expect(codes(warn(valid(back)))).toEqual(["frontage_obstructed"]);
    const front: LayoutDocument = {
      schemaVersion: 1,
      plot: { boundary: base, frontageEdge: 0, objects: [car] },
    };
    expect(warn(front)).toEqual([]);
    expect(frontageSegment(back.plot)).toEqual([
      [40, 30],
      [0, 30],
    ]);
  });
});

describe("ordering", () => {
  it("warnings before notes", () => {
    const ws = warn(
      plot([
        o("kitchen", 10, 10),
        o("kitchen", 16.9, 10),
        o("container", 2, 25),
      ]),
    );
    expect(ws.map((w) => w.severity)).toEqual(["warning", "note"]);
  });
});

// --- Nested coordinates -----------------------------------------------------------

describe("nested coordinates", () => {
  it("the covered area is centred on its structure, origin at its corner", () => {
    const b = o("bedouin", 20, 15);
    expect(childFrame(b, { kind: "rect", width: 12, depth: 8 })).toEqual({
      origin: [14, 11],
      rotationDeg: 0,
    });
    expect(childFrame(b, { kind: "rect", width: 10, depth: 6 }).origin).toEqual(
      [15, 12],
    );
  });

  it("turns with the structure", () => {
    const b = o("bedouin", 20, 15, { rotationDeg: 90 });
    const f = childFrame(b, { kind: "rect", width: 12, depth: 8 });
    expect(f).toEqual({ origin: [24, 9], rotationDeg: 90 });
  });

  it("puts a tent on the whole plot at the right place and angle", () => {
    const parent = withChild(
      o("bedouin", 20, 15, { rotationDeg: 90 }),
      [],
    ) as LayoutObject & { child: LayoutChildArea };
    const tent = nested("tent-2p", 2, 1, { rotationDeg: 300 });
    const fp = nestedFootprintOnPlot(parent, tent);
    expect(fp.kind).toBe("rect");
    // origin (24, 9) + rotate((2, 1), 90°) = (24 − 1, 9 + 2)
    expect(fp.centre).toEqual([23, 11]);
    if (fp.kind === "rect") expect(fp.rotationDeg).toBe(30);
    const pole = nestedFootprintOnPlot(parent, nested("support-pole", 0, 0));
    expect(pole.centre).toEqual([24, 9]);
  });

  it("a polygon covered area is centred on its bounding box", () => {
    const f = childFrame(o("bedouin", 20, 15), {
      kind: "polygon",
      ring: [
        [2, 2],
        [12, 2],
        [12, 8],
        [2, 8],
      ],
      source: "gis",
      sourceRef: "x",
    });
    expect(f.origin).toEqual([13, 10]);
    const ring = childBoundaryRing(
      { shape: "rect" },
      {
        boundary: {
          kind: "polygon",
          ring: [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
          source: "gis",
          sourceRef: "x",
        },
      },
    );
    expect(ring).toHaveLength(3);
  });

  it("a new covered area is the structure's own footprint", () => {
    expect(defaultChildArea(o("bedouin", 0, 0))).toEqual({
      boundary: { kind: "rect", width: 12, depth: 8 },
      objects: [],
    });
    expect(defaultChildArea(o("dome", 0, 0)).boundary).toEqual({
      kind: "rect",
      width: 6,
      depth: 6,
    });
  });

  it("footprints follow the shape", () => {
    expect(objectFootprint(o("fire-pit", 1, 2))).toEqual({
      kind: "circle",
      centre: [1, 2],
      radius: 1.5,
    });
    expect(objectFootprint(o("kitchen", 1, 2))).toMatchObject({
      kind: "rect",
      width: 6,
      length: 4,
    });
  });
});

// --- Summary ---------------------------------------------------------------------

describe("plot summary (ERF-002)", () => {
  it("dimensions, area and ground covered — zones and paths excluded", () => {
    const d = plot([
      o("kitchen", 10, 10),
      o("tent-2p", 20, 20),
      o("walkway", 30, 15),
      o("area", 5, 25),
      withChild(o("bedouin", 25, 8), [
        nested("tent-2p", 3, 3),
        nested("tent-2p", 7, 3),
      ]),
    ]);
    const s = plotSummary(d, CATALOG);
    expect(s).toMatchObject({
      width: 40,
      depth: 30,
      areaM2: 1200,
      objectCount: 5,
      totalObjectCount: 7,
      tentCount: 1,
    });
    expect(s.footprintM2).toBe(24 + 5 + 96);
    expect(s.coveredPct).toBe(10);
    const bedouin = d.plot.objects[4] as LayoutObject & {
      child: LayoutChildArea;
    };
    expect(coveredAreaSummary(bedouin, CATALOG)).toMatchObject({
      tentCount: 2,
      tentFootprintM2: 10,
      areaM2: 96,
    });
  });

  it("formats the 'From your layout' line", () => {
    expect(
      formatPlotSize(
        boundaryDimensions({ kind: "rect", width: 40, depth: 30 }),
      ),
    ).toBe("40 m × 30 m · 1,200 m²");
    expect(formatPlotSize({ width: 12.5, depth: 8, areaM2: 100 })).toBe(
      "12.5 m × 8 m · 100 m²",
    );
    expect(formatMetres(1.25)).toBe("1.3 m");
    expect(formatMetres(2)).toBe("2.0 m");
  });

  it("a polygon plot measures its bounding box and true area", () => {
    const L = {
      kind: "polygon" as const,
      ring: [
        [0, 0],
        [20, 0],
        [20, 10],
        [10, 10],
        [10, 20],
        [0, 20],
      ] as [number, number][],
      source: "gis" as const,
      sourceRef: "x",
    };
    expect(boundaryDimensions(L)).toEqual({
      width: 20,
      depth: 20,
      areaM2: 300,
    });
  });

  it("an empty plot has nothing covered", () => {
    expect(
      plotSummary(createEmptyLayoutDocument(40, 30), CATALOG),
    ).toMatchObject({ objectCount: 0, footprintM2: 0, coveredPct: 0 });
  });

  it("names objects by label, else palette label, else key", () => {
    expect(
      layoutObjectName(
        { label: "  Alice's tent ", catalogKey: "tent-2p" },
        CATALOG,
      ),
    ).toBe("Alice's tent");
    expect(
      layoutObjectName({ label: "  ", catalogKey: "tent-2p" }, CATALOG),
    ).toBe("Tent · 2 person");
    expect(layoutObjectName({ catalogKey: "retired-thing" }, CATALOG)).toBe(
      "retired-thing",
    );
  });
});

// --- Carry-forward and pinning --------------------------------------------------------

describe("start from last year's layout", () => {
  it("copies every object with a new id, labels included, and changes nothing in the source", () => {
    const src = valid(
      plot([
        withChild(o("bedouin", 20, 15, { label: "Bedouin 1" }), [
          nested("tent-2p", 3, 3, { label: "Alice's tent" }),
        ]),
        o("kitchen", 5, 5),
      ]),
    );
    const before = JSON.stringify(src);
    let k = 1000;
    const copy = copyLayoutForNewEdition(
      src,
      () => `00000000-0000-4000-8000-${String(k++).padStart(12, "0")}`,
    );
    valid(copy);
    expect(JSON.stringify(src)).toBe(before);
    const oldIds = new Set([
      src.plot.objects[0]!.id,
      src.plot.objects[1]!.id,
      src.plot.objects[0]!.child!.objects[0]!.id,
    ]);
    const newIds = [
      copy.plot.objects[0]!.id,
      copy.plot.objects[1]!.id,
      copy.plot.objects[0]!.child!.objects[0]!.id,
    ];
    expect(newIds.some((i) => oldIds.has(i))).toBe(false);
    expect(new Set(newIds).size).toBe(3);
    expect(copy.plot.objects[0]!.child!.objects[0]!.label).toBe("Alice's tent");
    expect(copy.plot.boundary).toEqual(src.plot.boundary);
  });

  it("a GIS outline becomes a rectangle of its size, and objects keep their places", () => {
    const src: LayoutDocument = {
      schemaVersion: 1,
      plot: {
        boundary: {
          kind: "polygon",
          ring: [
            [100, 50],
            [140, 50],
            [140, 80],
            [100, 80],
          ],
          source: "gis",
          sourceRef: "erf-42",
        },
        frontageEdge: 0,
        objects: [o("kitchen", 110, 60)],
      },
    };
    const copy = valid(copyLayoutForNewEdition(valid(src), id));
    expect(copy.plot.boundary).toEqual({ kind: "rect", width: 40, depth: 30 });
    expect(copy.plot.objects[0]!.centre).toEqual([10, 10]);
    expect(copy.plot.frontageEdge).toBeUndefined();
  });

  it("keeps a rectangle plot's frontage edge", () => {
    const src = plot([]);
    src.plot.frontageEdge = 0;
    expect(copyLayoutForNewEdition(src, id).plot.frontageEdge).toBe(0);
  });
});

describe("snapshot pinning", () => {
  it("pins on submit and resubmit, never on withdraw or reopen", () => {
    expect(shouldPinLayoutSnapshot("submit")).toBe(true);
    expect(shouldPinLayoutSnapshot("resubmit")).toBe(true);
    expect(shouldPinLayoutSnapshot("withdraw")).toBe(false);
    expect(shouldPinLayoutSnapshot("reopen")).toBe(false);
  });

  it("tells the editor whether AfrikaBurn has the latest", () => {
    expect(layoutSnapshotState(3, null)).toBe("not_sent");
    expect(layoutSnapshotState(3, 3)).toBe("sent_current");
    expect(layoutSnapshotState(5, 3)).toBe("changed_since_sent");
  });

  it("the org sees the latest pin", () => {
    const a = { v: 1, pinnedAt: new Date("2027-03-02T10:00:00Z") };
    const b = { v: 4, pinnedAt: new Date("2027-03-09T10:00:00Z") };
    expect(latestLayoutSnapshot([a, b])).toBe(b);
    expect(latestLayoutSnapshot([b, a])).toBe(b);
    expect(latestLayoutSnapshot([])).toBeNull();
  });
});
