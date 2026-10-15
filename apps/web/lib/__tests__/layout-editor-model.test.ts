import { describe, expect, it } from "vitest";
import {
  createEmptyLayoutDocument,
  findCatalogEntry,
  getLayoutCatalog,
  type LayoutCatalogEntry,
} from "@quagga/core";
import {
  LAYOUT_MAX_OBJECTS,
  LayoutDocument,
  type LayoutObject,
} from "@quagga/types";
import {
  addObject,
  applyPatch,
  areaOfObject,
  baseLabel,
  canAddObject,
  clampCoord,
  clampHalo,
  clampPlotSide,
  clampRotation,
  clampSize,
  dimsText,
  duplicateObject,
  findObject,
  fitScale,
  getArea,
  HISTORY_LIMIT,
  initHistory,
  newObjectFromEntry,
  nextLabel,
  nudgeObject,
  parseMetresInput,
  pushHistory,
  redo,
  removeObject,
  rulerStep,
  setCoveredSize,
  setPlotSize,
  stageHeight,
  sizeReadout,
  snapCentre,
  stepZoom,
  undo,
  updateObject,
  ZOOM_MAX,
  ZOOM_MIN,
} from "../layout-editor-model";

const catalog = getLayoutCatalog(2027);
const entry = (key: string): LayoutCatalogEntry => {
  const e = findCatalogEntry(catalog, key);
  if (!e) throw new Error(`no catalogue entry ${key}`);
  return e;
};

let n = 0;
const uuid = () => {
  n += 1;
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
};

function plotWith(...objects: LayoutObject[]): LayoutDocument {
  const doc = createEmptyLayoutDocument(40, 30);
  return { ...doc, plot: { ...doc.plot, objects } };
}

function bedouin(): LayoutObject {
  return newObjectFromEntry(entry("bedouin"), [10, 10], uuid(), "Bedouin 1") as LayoutObject;
}

/** Everything the editor produces must be a document the server accepts. */
function expectValid(doc: LayoutDocument) {
  const r = LayoutDocument.safeParse(doc);
  expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
}

describe("clamping to the server's limits", () => {
  it("keeps sizes within 0.1–500 m and replaces non-numbers", () => {
    expect(clampSize(0)).toBe(0.1);
    expect(clampSize(0.1)).toBe(0.1);
    expect(clampSize(501)).toBe(500);
    expect(clampSize(Number.NaN)).toBe(0.1);
    expect(clampSize(2.2)).toBe(2.2);
  });
  it("keeps plot sides, halos and coordinates in range", () => {
    expect(clampPlotSide(900)).toBe(500);
    expect(clampPlotSide(Number.POSITIVE_INFINITY)).toBe(0.1);
    expect(clampHalo(-1)).toBe(0);
    expect(clampHalo(51)).toBe(50);
    expect(clampHalo(Number.NaN)).toBe(0);
    expect(clampCoord(-3000)).toBe(-2000);
    expect(clampCoord(3000)).toBe(2000);
    expect(clampCoord(Number.NaN)).toBe(0);
  });
  it("normalises a rotation to [0, 360)", () => {
    expect(clampRotation(-15)).toBe(345);
    expect(clampRotation(360)).toBe(0);
    expect(clampRotation(375)).toBe(15);
    expect(clampRotation(359.99999999999)).toBe(0);
    expect(clampRotation(Number.NaN)).toBe(0);
  });
  it("strips float noise", () => {
    expect(clampSize(0.1 + 0.2)).toBe(0.3);
  });
});

describe("parseMetresInput", () => {
  it.each([
    ["6", 6],
    [" 6.5 ", 6.5],
    ["6,5", 6.5],
    ["6.5 m", 6.5],
    ["15°", 15],
    ["-2", -2],
    [".5", 0.5],
  ])("reads %j as %d", (raw, v) => {
    expect(parseMetresInput(raw)).toBe(v);
  });
  it.each(["", "abc", "6..5", "1e3", "6 7", "m"])("refuses %j", (raw) => {
    expect(parseMetresInput(raw)).toBeNull();
  });
});

describe("areas", () => {
  it("the whole camp is the plot", () => {
    const doc = plotWith(bedouin());
    const a = getArea(doc, null, catalog)!;
    expect(a.level).toBe("plot");
    expect(a.objects).toHaveLength(1);
    expect(a.parent).toBeNull();
  });

  it("a structure never opened shows its own footprint as the covered area", () => {
    const b = bedouin();
    const a = getArea(plotWith(b), b.id, catalog)!;
    expect(a.level).toBe("nested");
    expect(a.boundary).toEqual({ kind: "rect", width: 12, depth: 8 });
    expect(a.objects).toEqual([]);
    expect(a.parent?.id).toBe(b.id);
  });

  it("is null for a missing object or one that is not a shade structure", () => {
    const tent = newObjectFromEntry(entry("tent-2p"), [1, 1], uuid()) as LayoutObject;
    const doc = plotWith(tent);
    expect(getArea(doc, tent.id, catalog)).toBeNull();
    expect(getArea(doc, uuid(), catalog)).toBeNull();
  });

  it("an object added inside writes the covered area, in its own metres", () => {
    const b = bedouin();
    const tent = newObjectFromEntry(entry("tent-2p"), [4, 4.1], uuid(), "Tent 3");
    const doc = addObject(plotWith(b), b.id, tent);
    const parent = doc.plot.objects[0]!;
    expect(parent.child?.boundary).toEqual({ kind: "rect", width: 12, depth: 8 });
    expect(parent.child?.objects[0]?.centre).toEqual([4, 4.1]);
    expect(findObject(doc, b.id, tent.id, catalog)?.label).toBe("Tent 3");
    expect(areaOfObject(doc, tent.id)).toBe(b.id);
    expect(areaOfObject(doc, b.id)).toBeNull();
    expect(areaOfObject(doc, uuid())).toBeUndefined();
    expectValid(doc);
  });

  it("never nests a structure inside a covered area (depth 1)", () => {
    const b = bedouin();
    const inner = bedouin();
    inner.child = { boundary: { kind: "rect", width: 2, depth: 2 }, objects: [] };
    const doc = addObject(plotWith(b), b.id, inner);
    expect("child" in doc.plot.objects[0]!.child!.objects[0]!).toBe(false);
  });
});

describe("labels", () => {
  it("takes the palette name before the dot", () => {
    expect(baseLabel(entry("tent-4p"))).toBe("Tent");
    expect(baseLabel(entry("bedouin"))).toBe("Bedouin");
  });
  it("numbers past the highest existing label", () => {
    const objs = [{ label: "Tent 1" }, { label: "Tent 4" }, { label: "Kitchen" }, {}];
    expect(nextLabel(objs, entry("tent-2p"))).toBe("Tent 5");
    expect(nextLabel([], entry("kitchen"))).toBe("Kitchen 1");
  });
});

describe("snapCentre", () => {
  const tent = { shape: "rect" as const, width: 2.5, length: 2, rotationDeg: 0 };

  it("snaps a square-on rectangle's corner to the grid", () => {
    // Corner at 3.2 → 3.0, so the centre is 3.0 + 1.25.
    expect(snapCentre(tent, [4.45, 4.1], 0.5)).toEqual([4.25, 4]);
  });
  it("swaps the extents at a quarter turn", () => {
    expect(snapCentre({ ...tent, rotationDeg: 90 }, [4.45, 4.1], 0.5)).toEqual([4.5, 4.25]);
  });
  it("snaps the centre of a rectangle at any other angle", () => {
    expect(snapCentre({ ...tent, rotationDeg: 30 }, [4.45, 4.1], 0.5)).toEqual([4.5, 4]);
  });
  it("snaps a circle's centre", () => {
    expect(
      snapCentre({ shape: "circle", width: 3, length: 3, diameter: 3, rotationDeg: 0 }, [7.3, 7.7], 0.5),
    ).toEqual([7.5, 7.5]);
  });
  it("is the same in metres at every zoom — it never sees a pixel", () => {
    expect(snapCentre(tent, [10.01, 10.01], 0.5)).toEqual([10.25, 10]);
  });
  it("only clamps with snapping off", () => {
    expect(snapCentre(tent, [4.45, 4.1], 0)).toEqual([4.45, 4.1]);
    expect(snapCentre(tent, [9000, 4.1], 0)).toEqual([2000, 4.1]);
  });
});

describe("edits", () => {
  it("a new object carries the palette's estimated sizes and visibility", () => {
    const fire = newObjectFromEntry(entry("fire-pit"), [30, 10], uuid(), "Fire pit");
    expect(fire.shape).toBe("circle");
    expect(fire.diameter).toBe(entry("fire-pit").diameter);
    expect(fire.safetyM).toBe(entry("fire-pit").safetyM);
    expect(fire.visibility).toBe(entry("fire-pit").visibility);
    expectValid(plotWith(fire as LayoutObject));
  });

  it("the inspector patch clamps every field", () => {
    const k = newObjectFromEntry(entry("kitchen"), [21, 14], uuid(), "Kitchen");
    const p = applyPatch(k, {
      centreX: 5000,
      width: 0,
      length: 6,
      rotationDeg: -90,
      clearanceM: 99,
      label: "  ",
    });
    expect(p.centre).toEqual([2000, 14]);
    expect(p.width).toBe(0.1);
    expect(p.length).toBe(6);
    expect(p.rotationDeg).toBe(270);
    expect(p.clearanceM).toBe(50);
    expect(p.label).toBeUndefined();
    expect(applyPatch(k, { centreY: 3, safetyM: 2 }).centre).toEqual([21, 3]);
    expect(applyPatch(k, { label: "x".repeat(200) }).label).toHaveLength(60);
  });

  it("a circle's width, length and diameter move together and never rotate", () => {
    const d = newObjectFromEntry(entry("dome"), [5, 5], uuid());
    const p = applyPatch(d, { width: 8, rotationDeg: 45 });
    expect([p.diameter, p.width, p.length, p.rotationDeg]).toEqual([8, 8, 8, 0]);
    expect(applyPatch(d, { diameter: 4 }).width).toBe(4);
  });

  it("update, nudge and remove reach the object in its area", () => {
    const b = bedouin();
    const t = newObjectFromEntry(entry("tent-2p"), [4, 4], uuid());
    let doc = addObject(plotWith(b), b.id, t);
    doc = updateObject(doc, b.id, t.id, { width: 3 });
    doc = nudgeObject(doc, b.id, t.id, 0.5, -0.5);
    const moved = findObject(doc, b.id, t.id, catalog)!;
    expect(moved.width).toBe(3);
    expect(moved.centre).toEqual([4.5, 3.5]);
    doc = nudgeObject(doc, null, b.id, 1, 0);
    expect(doc.plot.objects[0]!.centre).toEqual([11, 10]);
    expect(findObject(doc, b.id, t.id, catalog)!.centre).toEqual([4.5, 3.5]);
    doc = removeObject(doc, b.id, t.id);
    expect(doc.plot.objects[0]!.child!.objects).toEqual([]);
    doc = removeObject(doc, null, b.id);
    expect(doc.plot.objects).toEqual([]);
  });

  it("duplicating a structure copies what is under it with new ids", () => {
    const b = bedouin();
    const t = newObjectFromEntry(entry("tent-2p"), [4, 4], uuid(), "Tent 1");
    const doc = addObject(plotWith(b), b.id, t);
    const r = duplicateObject(doc, null, b.id, uuid, catalog);
    expect(r.id).not.toBeNull();
    const copy = r.doc.plot.objects[1]!;
    expect(copy.id).toBe(r.id);
    expect(copy.centre).toEqual([11, 11]);
    expect(copy.label).toBe("Bedouin 2");
    expect(copy.child!.objects[0]!.id).not.toBe(t.id);
    expect(copy.child!.objects[0]!.label).toBe("Tent 1");
    expectValid(r.doc);
  });

  it("duplicating inside a covered area stays inside it", () => {
    const b = bedouin();
    const t = newObjectFromEntry(entry("tent-2p"), [4, 4], uuid());
    const doc = addObject(plotWith(b), b.id, t);
    const r = duplicateObject(doc, b.id, t.id, uuid, catalog);
    expect(r.doc.plot.objects[0]!.child!.objects).toHaveLength(2);
    expect(r.doc.plot.objects[0]!.child!.objects[1]!.label).toBeUndefined();
    expect(duplicateObject(doc, b.id, uuid(), uuid, catalog).id).toBeNull();
  });

  it("refuses to add or duplicate past the object cap", () => {
    const objs: LayoutObject[] = [];
    for (let i = 0; i < LAYOUT_MAX_OBJECTS; i++) {
      objs.push(newObjectFromEntry(entry("tent-1p"), [1, 1], uuid()) as LayoutObject);
    }
    const full = plotWith(...objs);
    expect(canAddObject(full)).toBe(false);
    const extra = newObjectFromEntry(entry("tent-1p"), [1, 1], uuid());
    expect(addObject(full, null, extra)).toBe(full);
    expect(duplicateObject(full, null, objs[0]!.id, uuid, catalog).id).toBeNull();
    const oneShort = plotWith(...objs.slice(1));
    expect(canAddObject(oneShort)).toBe(true);
    expect(addObject(oneShort, null, extra).plot.objects).toHaveLength(LAYOUT_MAX_OBJECTS);
  });

  it("sets the plot size, clamped, and leaves a GIS outline alone", () => {
    const doc = setPlotSize(plotWith(), 45, 900);
    expect(doc.plot.boundary).toEqual({ kind: "rect", width: 45, depth: 500 });
    const gis: LayoutDocument = {
      schemaVersion: 1,
      plot: {
        boundary: {
          kind: "polygon",
          ring: [[0, 0], [10, 0], [10, 10]],
          source: "gis",
          sourceRef: "erf-1",
        },
        objects: [],
      },
    };
    expect(setPlotSize(gis, 5, 5)).toBe(gis);
  });

  it("shrinking a covered area keeps the tents where they are under the shade", () => {
    const b = bedouin();
    const t = newObjectFromEntry(entry("tent-2p"), [6, 4], uuid()); // the middle
    let doc = addObject(plotWith(b), b.id, t);
    doc = setCoveredSize(doc, b.id, 10, 6);
    const child = doc.plot.objects[0]!.child!;
    expect(child.boundary).toEqual({ kind: "rect", width: 10, depth: 6 });
    // Still the middle of the (smaller) covered area.
    expect(child.objects[0]!.centre).toEqual([5, 3]);
    // A structure with no covered area yet gets one at the given size.
    const fresh = setCoveredSize(plotWith(bedouin()), doc.plot.objects[0]!.id, 1, 1);
    expect(fresh.plot.objects[0]!.child).toBeUndefined();
    const b2 = bedouin();
    expect(setCoveredSize(plotWith(b2), b2.id, 11, 7).plot.objects[0]!.child!.boundary)
      .toEqual({ kind: "rect", width: 11, depth: 7 });
  });
});

describe("undo and redo", () => {
  it("walks back and forward, and a new edit drops the redo branch", () => {
    const a = plotWith();
    const b = setPlotSize(a, 10, 10);
    const c = setPlotSize(a, 20, 20);
    let h = pushHistory(initHistory(a), b);
    expect(h.past).toEqual([a]);
    h = undo(h);
    expect(h.present).toBe(a);
    expect(h.future).toEqual([b]);
    h = redo(h);
    expect(h.present).toBe(b);
    h = undo(h);
    h = pushHistory(h, c);
    expect(h.future).toEqual([]);
    expect(undo(initHistory(a)).present).toBe(a);
    expect(redo(initHistory(a)).present).toBe(a);
  });

  it("records nothing for an edit that changes nothing", () => {
    const a = plotWith();
    const h = initHistory(a);
    expect(pushHistory(h, a)).toBe(h);
    expect(pushHistory(h, setPlotSize(a, 40, 30))).toBe(h);
  });

  it("keeps at most HISTORY_LIMIT steps", () => {
    let h = initHistory(plotWith());
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) {
      h = pushHistory(h, setPlotSize(h.present, i, i));
    }
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe("view maths", () => {
  it("picks a ruler step at least 40 px apart", () => {
    expect(rulerStep(100)).toBe(0.5);
    expect(rulerStep(30)).toBe(2);
    expect(rulerStep(15)).toBe(5);
    expect(rulerStep(0.01)).toBe(500);
  });
  it("fits the plot inside the margins on its tighter side", () => {
    expect(fitScale(40, 30, 840, 400, 20)).toBe(12);
    expect(fitScale(40, 10, 840, 400, 20)).toBe(20);
    expect(fitScale(0, 0, 10, 10, 20)).toBe(10);
  });
  it("sizes the stage to the plot fitted to its width, within its limits", () => {
    const o = { ruler: 24, margin: 28, min: 320, max: 540 };
    // 40 × 30 m across 640 px: 560 px of plot width → 14 px/m → 420 + 80.
    expect(stageHeight(40, 30, 640, o)).toBe(500);
    // A deep plot is capped; a shallow one never goes below the floor.
    expect(stageHeight(30, 40, 640, o)).toBe(540);
    expect(stageHeight(40, 5, 640, o)).toBe(320);
  });
  it("zooms in steps, within its limits", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.8);
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });
  it("reads out sizes in metres", () => {
    expect(sizeReadout("rect", 6, 4)).toBe("6.0 m × 4.0 m");
    expect(sizeReadout("circle", 6.04, 6.04)).toBe("Ø 6.0 m");
    expect(dimsText({ shape: "rect", width: 2.5, length: 2 })).toBe("2.5 × 2 m");
    expect(dimsText({ shape: "circle", width: 6, length: 6, diameter: 6 })).toBe("Ø 6 m");
    expect(dimsText({ shape: "circle", width: 3, length: 3 })).toBe("Ø 3 m");
  });
});
