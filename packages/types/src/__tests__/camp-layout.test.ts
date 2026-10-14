import { describe, expect, it } from "vitest";
import {
  countLayoutObjects,
  CreateCampLayoutInput,
  LAYOUT_MAX_OBJECTS,
  LayoutDocument,
  ProjectPermissionKey,
  ProjectPermissions,
  PROJECT_PERMISSION_LABELS,
  SaveCampLayoutInput,
  StartLayoutFromLastYearInput,
  utf8ByteLength,
} from "../index";

let n = 0;
function uuid(): string {
  n += 1;
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function obj(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(),
    catalogKey: "tent-2p",
    shape: "rect",
    centre: [5, 5],
    width: 2.5,
    length: 2,
    rotationDeg: 0,
    clearanceM: 0.5,
    safetyM: 0,
    visibility: "private",
    ...overrides,
  };
}

function doc(objects: unknown[] = [obj()], plot: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    plot: {
      boundary: { kind: "rect", width: 40, depth: 30 },
      objects,
      ...plot,
    },
  };
}

const ok = (d: unknown) => LayoutDocument.safeParse(d).success;

describe("LayoutDocument — what is accepted", () => {
  it("accepts a plain plot, and an empty one", () => {
    expect(ok(doc())).toBe(true);
    expect(ok(doc([]))).toBe(true);
  });

  it("accepts a Bedouin with tents in its covered area", () => {
    const bedouin = obj({
      catalogKey: "bedouin",
      width: 12,
      length: 8,
      child: {
        boundary: { kind: "rect", width: 12, depth: 8 },
        objects: [
          obj(),
          obj({
            shape: "circle",
            catalogKey: "support-pole",
            diameter: 0.25,
            width: 0.25,
            length: 0.25,
          }),
        ],
      },
    });
    expect(ok(doc([bedouin]))).toBe(true);
  });

  it("accepts a GIS polygon outline with a frontage edge", () => {
    const d = doc([], {
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
        sourceRef: "erf-42",
      },
      frontageEdge: 5,
    });
    expect(ok(d)).toBe(true);
  });
});

describe("LayoutDocument — what is refused", () => {
  it("an unknown schemaVersion", () => {
    expect(ok({ ...doc(), schemaVersion: 2 })).toBe(false);
  });

  it("non-finite numbers", () => {
    expect(ok(doc([obj({ centre: [Number.NaN, 1] })]))).toBe(false);
    expect(ok(doc([obj({ width: Infinity })]))).toBe(false);
    expect(ok(doc([obj({ rotationDeg: Number.NaN })]))).toBe(false);
  });

  it("sizes outside 0.1–500 m, either side of the line", () => {
    expect(ok(doc([obj({ width: 0.1 })]))).toBe(true);
    expect(ok(doc([obj({ width: 0.09 })]))).toBe(false);
    expect(ok(doc([obj({ length: 500 })]))).toBe(true);
    expect(ok(doc([obj({ length: 500.1 })]))).toBe(false);
  });

  it("a plot larger than 500 m × 500 m — rectangle or polygon", () => {
    expect(
      ok(doc([], { boundary: { kind: "rect", width: 500, depth: 500 } })),
    ).toBe(true);
    expect(
      ok(doc([], { boundary: { kind: "rect", width: 501, depth: 30 } })),
    ).toBe(false);
    const big = {
      kind: "polygon",
      ring: [
        [0, 0],
        [600, 0],
        [600, 10],
      ],
      source: "gis",
      sourceRef: "x",
    };
    expect(ok(doc([], { boundary: big }))).toBe(false);
  });

  it("a polygon with no area", () => {
    const flat = {
      kind: "polygon",
      ring: [
        [0, 0],
        [10, 0],
        [20, 0],
      ],
      source: "gis",
      sourceRef: "x",
    };
    expect(ok(doc([], { boundary: flat }))).toBe(false);
  });

  it("a frontage edge that isn't an edge", () => {
    expect(ok(doc([], { frontageEdge: 3 }))).toBe(true);
    expect(ok(doc([], { frontageEdge: 4 }))).toBe(false);
  });

  it("more than 400 objects in total, nested ones counted", () => {
    const tents = (k: number) => Array.from({ length: k }, () => obj());
    const bedouin = (k: number) =>
      obj({
        catalogKey: "bedouin",
        child: {
          boundary: { kind: "rect", width: 12, depth: 8 },
          objects: tents(k),
        },
      });
    // 1 Bedouin + 199 tents under it + 200 on the plot = 400
    expect(ok(doc([bedouin(199), ...tents(200)]))).toBe(true);
    expect(ok(doc([bedouin(200), ...tents(200)]))).toBe(false);
    expect(LAYOUT_MAX_OBJECTS).toBe(400);
  });

  it("nesting deeper than one level", () => {
    const deep = obj({
      catalogKey: "bedouin",
      child: {
        boundary: { kind: "rect", width: 12, depth: 8 },
        objects: [
          obj({
            catalogKey: "gazebo",
            child: {
              boundary: { kind: "rect", width: 3, depth: 3 },
              objects: [],
            },
          }),
        ],
      },
    });
    expect(ok(doc([deep]))).toBe(false);
  });

  it("text over its cap", () => {
    expect(ok(doc([obj({ label: "x".repeat(60) })]))).toBe(true);
    expect(ok(doc([obj({ label: "x".repeat(61) })]))).toBe(false);
    expect(ok(doc([obj({ notes: "x".repeat(501) })]))).toBe(false);
  });

  it("a document over 256 kB — counted in UTF-8 bytes, not characters", () => {
    // ~236 k characters but ~380 kB once "é" is two bytes each.
    const heavy = Array.from({ length: 400 }, () =>
      obj({ notes: "é".repeat(300), label: "é".repeat(60) }),
    );
    expect(JSON.stringify(doc(heavy)).length).toBeLessThan(256 * 1024);
    expect(ok(doc(heavy))).toBe(false);
    const light = Array.from({ length: 400 }, () => obj());
    expect(ok(doc(light))).toBe(true);
  });

  it("keys the schema does not name — nothing rides along", () => {
    expect(ok(doc([obj({ phone: "0821234567" })]))).toBe(false);
    expect(ok({ ...doc(), extra: 1 })).toBe(false);
  });

  it("a round object with no diameter", () => {
    expect(ok(doc([obj({ shape: "circle" })]))).toBe(false);
    expect(ok(doc([obj({ shape: "circle", diameter: 3 })]))).toBe(true);
  });

  it("rotation outside [0, 360)", () => {
    expect(ok(doc([obj({ rotationDeg: 359.9 })]))).toBe(true);
    expect(ok(doc([obj({ rotationDeg: 360 })]))).toBe(false);
    expect(ok(doc([obj({ rotationDeg: -15 })]))).toBe(false);
  });

  it("two objects with the same id", () => {
    const a = obj();
    expect(ok(doc([a, { ...a }]))).toBe(false);
  });

  it("a position far off the plot", () => {
    expect(ok(doc([obj({ centre: [-50, 45] })]))).toBe(true);
    expect(ok(doc([obj({ centre: [5000, 5] })]))).toBe(false);
  });

  it("a catalogue key that isn't a key", () => {
    expect(ok(doc([obj({ catalogKey: "Tent 2P" })]))).toBe(false);
  });
});

describe("inputs", () => {
  it("save needs a version to compare against", () => {
    expect(
      SaveCampLayoutInput.safeParse({
        slug: "mad-hatters",
        expectedVersion: 3,
        document: doc(),
      }).success,
    ).toBe(true);
    expect(
      SaveCampLayoutInput.safeParse({ slug: "mad-hatters", document: doc() })
        .success,
    ).toBe(false);
    expect(
      SaveCampLayoutInput.safeParse({
        slug: "mad-hatters",
        expectedVersion: 0,
        document: doc(),
      }).success,
    ).toBe(false);
  });

  it("create takes a plot size within the caps", () => {
    expect(
      CreateCampLayoutInput.safeParse({ slug: "a", width: 40, depth: 30 })
        .success,
    ).toBe(true);
    expect(
      CreateCampLayoutInput.safeParse({ slug: "a", width: 0, depth: 30 })
        .success,
    ).toBe(false);
    expect(
      CreateCampLayoutInput.safeParse({ slug: "a", width: 40, depth: 900 })
        .success,
    ).toBe(false);
  });

  it("start from last year takes only the camp", () => {
    expect(StartLayoutFromLastYearInput.safeParse({ slug: "a" }).success).toBe(
      true,
    );
    expect(
      StartLayoutFromLastYearInput.safeParse({ slug: "a", from: "b" }).success,
    ).toBe(false);
  });

  it("counts objects, nested ones included", () => {
    expect(
      countLayoutObjects({ objects: [{}, { child: { objects: [1, 2, 3] } }] }),
    ).toBe(5);
  });
});

describe("utf8ByteLength", () => {
  it("counts one to four bytes per code point", () => {
    expect(utf8ByteLength("a")).toBe(1);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("²")).toBe(2);
    expect(utf8ByteLength("€")).toBe(3);
    expect(utf8ByteLength("⛺")).toBe(3);
    expect(utf8ByteLength("🔥")).toBe(4);
  });
});

describe("manage_layout", () => {
  it("is a project permission with a label, stored as a boolean", () => {
    expect(ProjectPermissionKey.options).toContain("manage_layout");
    expect(PROJECT_PERMISSION_LABELS.manage_layout).toBe(
      "Edit the camp layout",
    );
    expect(ProjectPermissions.safeParse({ manage_layout: true }).success).toBe(
      true,
    );
    expect(ProjectPermissions.safeParse({ manage_layout: "yes" }).success).toBe(
      false,
    );
  });
});
