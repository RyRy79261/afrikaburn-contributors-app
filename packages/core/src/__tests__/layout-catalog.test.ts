import { describe, expect, it } from "vitest";
import { LayoutDocument } from "@quagga/types";
import {
  findCatalogEntry,
  getLayoutCatalog,
  LAYOUT_CATALOG_2027,
  LAYOUT_CATALOG_GROUP_LABELS,
  paletteFor,
  placeableIn,
} from "../index";

describe("the layout catalogue", () => {
  it("has unique keys, every one an estimate", () => {
    const keys = LAYOUT_CATALOG_2027.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(LAYOUT_CATALOG_2027.every((e) => e.estimate)).toBe(true);
    expect(
      LAYOUT_CATALOG_2027.every((e) => LAYOUT_CATALOG_GROUP_LABELS[e.group]),
    ).toBe(true);
  });

  it("covers LAYOUT-001–031 and TENT-016–023", () => {
    const reqs = new Set(LAYOUT_CATALOG_2027.flatMap((e) => e.requirements));
    for (let i = 1; i <= 31; i++) {
      expect(
        reqs.has(`LAYOUT-${String(i).padStart(3, "0")}`),
        `LAYOUT-${i}`,
      ).toBe(true);
    }
    for (let i = 16; i <= 23; i++)
      expect(reqs.has(`TENT-0${i}`), `TENT-0${i}`).toBe(true);
    for (const t of [
      "TENT-003",
      "TENT-005",
      "TENT-006",
      "TENT-013",
      "TENT-014",
    ]) {
      expect(reqs.has(t), t).toBe(true);
    }
  });

  it("every entry, placed with its defaults, is a document the server accepts", () => {
    let n = 0;
    const objects = LAYOUT_CATALOG_2027.map((e) => ({
      id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
      catalogKey: e.key,
      shape: e.shape,
      centre: [10, 10] as [number, number],
      width: e.width,
      length: e.length,
      ...(e.diameter !== undefined ? { diameter: e.diameter } : {}),
      rotationDeg: 0,
      clearanceM: e.clearanceM,
      safetyM: e.safetyM,
      visibility: e.visibility,
    }));
    const r = LayoutDocument.safeParse({
      schemaVersion: 1,
      plot: { boundary: { kind: "rect", width: 40, depth: 30 }, objects },
    });
    expect(r.success).toBe(true);
  });

  it("round things carry a diameter", () => {
    for (const e of LAYOUT_CATALOG_2027.filter((c) => c.shape === "circle")) {
      expect(e.diameter, e.key).toBe(e.width);
    }
  });

  it("only shade structures nest", () => {
    const nestable = LAYOUT_CATALOG_2027.filter((e) => e.nestable).map(
      (e) => e.key,
    );
    expect(nestable.sort()).toEqual([
      "bedouin",
      "dome",
      "gazebo",
      "shade",
      "stretch-tent",
    ]);
  });

  it("tents and cars keep off the frontage and are private by default", () => {
    expect(findCatalogEntry(LAYOUT_CATALOG_2027, "vehicle")).toMatchObject({
      keepOffFrontage: true,
      visibility: "private",
    });
    expect(findCatalogEntry(LAYOUT_CATALOG_2027, "tent-4p")).toMatchObject({
      keepOffFrontage: true,
      visibility: "private",
    });
    expect(findCatalogEntry(LAYOUT_CATALOG_2027, "stage")).toMatchObject({
      keepOffFrontage: false,
      visibility: "public",
    });
  });

  it("palettes per level: no vehicles under a Bedouin, no poles on the open plot", () => {
    const inside = paletteFor(LAYOUT_CATALOG_2027, "nested").map((e) => e.key);
    const outside = paletteFor(LAYOUT_CATALOG_2027, "plot").map((e) => e.key);
    expect(inside).toEqual(
      expect.arrayContaining([
        "tent-2p",
        "support-pole",
        "walkway",
        "entrance",
        "accessible-space",
      ]),
    );
    expect(inside).not.toContain("vehicle");
    expect(inside).not.toContain("kitchen");
    expect(outside).not.toContain("support-pole");
    expect(outside).toEqual(
      expect.arrayContaining(["bedouin", "vehicle", "tent-2p", "walkway"]),
    );
    expect(placeableIn({ placement: "both" }, "nested")).toBe(true);
  });

  it("is keyed by edition year, falling back to 2027", () => {
    expect(getLayoutCatalog(2027)).toBe(LAYOUT_CATALOG_2027);
    expect(getLayoutCatalog(2031)).toBe(LAYOUT_CATALOG_2027);
  });
});
