import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { getLayoutCatalog, type LayoutCatalogEntry } from "@quagga/core";
import type {
  LayoutDocument,
  LayoutObject,
  NestedLayoutObject,
} from "@quagga/types";
import { LayoutPlan } from "../layout-plan";
import {
  buildPlanLayout,
  labelFit,
  niceStep,
  planArea,
  planDims,
  planFileName,
  planScale,
  planTone,
  ticks,
} from "../../lib/layout-plan-model";

// The read-only plan (docs/camp-layout-spec.md §Surfaces): the geometry it
// draws, and what the drawing does and does not contain. Above all: it draws
// NO warnings, whatever the document — it reaches plain members and
// AfrikaBurn's reviewers, and warnings are for the camp's editors only.

const CATALOG = getLayoutCatalog(2027);

let seq = 0;
function id(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

function entry(key: string): LayoutCatalogEntry {
  const e = CATALOG.find((c) => c.key === key);
  if (!e) throw new Error(`no catalogue entry ${key}`);
  return e;
}

function o(
  key: string,
  x: number,
  y: number,
  overrides: Partial<LayoutObject> = {},
): LayoutObject {
  const e = entry(key);
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

function nested(key: string, x: number, y: number): NestedLayoutObject {
  const { child: _child, ...rest } = o(key, x, y);
  void _child;
  return rest;
}

function doc(objects: LayoutObject[], width = 40, depth = 30): LayoutDocument {
  return {
    schemaVersion: 1,
    plot: { boundary: { kind: "rect", width, depth }, frontageEdge: 0, objects },
  };
}

describe("planTone — the editor's colour families", () => {
  it("maps each role and group to its tone", () => {
    expect(planTone(entry("bedouin"))).toBe("shelter");
    expect(planTone(entry("tent-2p"))).toBe("shelter");
    expect(planTone(entry("vehicle"))).toBe("vehicle");
    expect(planTone(entry("kitchen"))).toBe("infrastructure");
    expect(planTone(entry("fire-pit"))).toBe("safety");
    expect(planTone(entry("walkway"))).toBe("area");
    expect(planTone(entry("private-camping"))).toBe("area");
    expect(planTone(entry("support-pole"))).toBe("pole");
    expect(planTone(entry("entrance"))).toBe("area");
    expect(planTone(undefined)).toBe("vehicle");
  });

  it("reads an object in the areas group as an area whatever its role", () => {
    expect(
      planTone({ ...entry("kitchen"), group: "areas", role: "object" }),
    ).toBe("area");
  });
});

describe("planDims", () => {
  it("writes a rectangle as width × length and a circle as its diameter", () => {
    expect(planDims({ shape: "rect", width: 6, length: 2.5 })).toBe(
      "6 × 2.5 m",
    );
    expect(planDims({ shape: "circle", width: 3, length: 3, diameter: 3 })).toBe(
      "Ø 3 m",
    );
    expect(planDims({ shape: "circle", width: 4, length: 4 })).toBe("Ø 4 m");
  });
});

describe("planArea — what one plan shows", () => {
  const bedouin = o("bedouin", 10, 10, {
    child: {
      boundary: { kind: "rect", width: 12, depth: 8 },
      objects: [nested("tent-2p", 3, 3)],
    },
  });
  const shade = o("shade", 30, 10);
  const d = doc([bedouin, shade]);

  it("the whole camp: the plot outline, its objects and the frontage", () => {
    const a = planArea(d, null);
    expect(a?.parent).toBeNull();
    expect(a?.objects).toHaveLength(2);
    expect(a?.frontage).toEqual([
      [0, 0],
      [40, 0],
    ]);
  });

  it("a covered area: its own outline and the things under it, no frontage", () => {
    const a = planArea(d, bedouin.id);
    expect(a?.parent?.id).toBe(bedouin.id);
    expect(a?.objects).toHaveLength(1);
    expect(a?.frontage).toBeNull();
    expect(a?.ring).toEqual([
      [0, 0],
      [12, 0],
      [12, 8],
      [0, 8],
    ]);
  });

  it("an id with no covered area, or no such id, is not found", () => {
    expect(planArea(d, shade.id)).toBeNull();
    expect(planArea(d, id())).toBeNull();
  });
});

describe("scale, steps and ticks", () => {
  it("puts the longer side at the target width", () => {
    expect(planScale({ minX: 0, minY: 0, maxX: 40, maxY: 30 }, 800)).toBe(20);
    expect(planScale({ minX: 0, minY: 0, maxX: 10, maxY: 50 }, 800)).toBe(16);
  });

  it("picks the smallest nice step at least minPx apart", () => {
    expect(niceStep(20, 48)).toBe(5);
    expect(niceStep(20, 100)).toBe(5);
    expect(niceStep(20, 101)).toBe(10);
    expect(niceStep(200, 48)).toBe(0.5);
    expect(niceStep(0.01, 48)).toBe(500);
  });

  it("lists every multiple of the step, both ends included", () => {
    expect(ticks(0, 40, 5)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40]);
    expect(ticks(1, 9, 5)).toEqual([5]);
    expect(ticks(-2.5, 2.5, 2.5)).toEqual([-2.5, 0, 2.5]);
  });
});

describe("labelFit — what text an object has room for", () => {
  it("full: the name and the size", () => {
    expect(labelFit(200, 120, "Stage", "6 × 4 m", 13)).toBe("full");
  });
  it("name only when there is no height for the size line", () => {
    expect(labelFit(200, 25, "Stage", "6 × 4 m", 13)).toBe("name");
  });
  it("an icon when the name does not fit", () => {
    expect(labelFit(30, 30, "A very long tent label", "2 × 1 m", 13)).toBe(
      "icon",
    );
  });
  it("nothing in a sliver", () => {
    expect(labelFit(8, 40, "Pole", "0.2 × 0.2 m", 13)).toBe("none");
  });
});

describe("buildPlanLayout", () => {
  it("draws a 40 × 30 m plot with rulers in metres and a 5 m grid", () => {
    const plan = buildPlanLayout(planArea(doc([]), null)!, CATALOG, {
      rulers: true,
      scaleBar: true,
    });
    expect(plan.scale).toBe(20);
    expect(plan.areaBox).toEqual({ x: 34, y: 26, w: 800, h: 600 });
    expect(plan.rulers?.x.map((t) => t.label)).toEqual([
      "0",
      "5",
      "10",
      "15",
      "20",
      "25",
      "30",
      "35",
      "40 m",
    ]);
    expect(plan.gridMajor.xs).toHaveLength(9);
    expect(plan.gridMinor.xs).toHaveLength(41);
    expect(plan.frontage).toEqual({ x1: 34, y1: 26, x2: 834, y2: 26 });
    expect(plan.scaleBar?.metres).toBe(5);
    expect(plan.scaleBar?.px).toBe(100);
  });

  it("without rulers or a scale bar there are none, and a thin margin", () => {
    const plan = buildPlanLayout(planArea(doc([]), null)!, CATALOG, {
      rulers: false,
      scaleBar: false,
    });
    expect(plan.rulers).toBeNull();
    expect(plan.scaleBar).toBeNull();
    expect(plan.areaBox.x).toBe(10);
    expect(plan.height).toBe(620);
  });

  it("a fire pit's safety zone is drawn, and widens the drawing past the plot", () => {
    const pit = o("fire-pit", 37, 15); // its edge at 38.5 m, its zone to 41.5 m
    expect(pit.safetyM).toBeGreaterThan(0);
    const plan = buildPlanLayout(planArea(doc([pit]), null)!, CATALOG, {
      rulers: false,
      scaleBar: false,
    });
    const item = plan.items[0]!;
    expect(item.safety?.kind).toBe("circle");
    // The content runs past the plot's 40 m edge, so the scale shrinks.
    expect(plan.scale).toBeLessThan(20);
    // With no safety zone the plot alone sets the scale.
    const calm = buildPlanLayout(
      planArea(doc([o("fire-pit", 35, 15, { safetyM: 0 })]), null)!,
      CATALOG,
      { rulers: false, scaleBar: false },
    );
    expect(calm.items[0]!.safety).toBeNull();
    expect(calm.scale).toBe(20);
  });

  it("counts what is under a shade structure — only one with a covered area", () => {
    const bedouin = o("bedouin", 10, 10, {
      child: {
        boundary: { kind: "rect", width: 12, depth: 8 },
        objects: [nested("tent-2p", 3, 3), nested("tent-2p", 8, 3)],
      },
    });
    const bare = o("bedouin", 30, 20);
    const kitchen = o("kitchen", 25, 5);
    const plan = buildPlanLayout(
      planArea(doc([bedouin, bare, kitchen]), null)!,
      CATALOG,
      { rulers: true, scaleBar: true },
    );
    expect(plan.items.map((i) => i.nestedCount)).toEqual([2, null, null]);
    // Inside the covered area nothing opens further: nesting is one level.
    const inside = buildPlanLayout(planArea(doc([bedouin]), bedouin.id)!, CATALOG, {
      rulers: true,
      scaleBar: true,
    });
    expect(inside.items.map((i) => i.nestedCount)).toEqual([null, null]);
    expect(inside.frontage).toBeNull();
  });

  it("draws a rotated rectangle as its turned corners", () => {
    const flat = buildPlanLayout(
      planArea(doc([o("stage", 20, 15)]), null)!,
      CATALOG,
      { rulers: false, scaleBar: false },
    ).items[0]!;
    const turned = buildPlanLayout(
      planArea(doc([o("stage", 20, 15, { rotationDeg: 90 })]), null)!,
      CATALOG,
      { rulers: false, scaleBar: false },
    ).items[0]!;
    // A 6 × 4 stage turned a quarter is 4 wide and 6 deep.
    expect(flat.boxW / flat.boxH).toBeCloseTo(6 / 4);
    expect(turned.boxW / turned.boxH).toBeCloseTo(4 / 6);
  });
});

describe("planFileName", () => {
  it("is lower case with no spaces", () => {
    expect(planFileName("mad-hatters", 2027)).toBe(
      "mad-hatters-layout-2027.png",
    );
    expect(planFileName("mad-hatters", 2027, "Bedouin 1")).toBe(
      "mad-hatters-layout-2027-bedouin-1.png",
    );
    expect(planFileName("camp-404", 2027, "Alice's tent!")).toBe(
      "camp-404-layout-2027-alice-s-tent.png",
    );
  });
});

describe("<LayoutPlan>", () => {
  const bedouin = o("bedouin", 10, 18, {
    child: {
      boundary: { kind: "rect", width: 12, depth: 8 },
      objects: [nested("tent-2p", 3, 3)],
    },
  });
  // Two metres off the plot, and overlapping the stage: an editor would see
  // two warnings. The read-only plan must show neither.
  const kitchen = o("kitchen", 1, 5, { label: "Kitchen" });
  const stage = o("stage", 4, 5, { label: "Stage" });
  const d = doc([bedouin, kitchen, stage, o("fire-pit", 35, 10)]);

  it("draws an accessible SVG with labels, sizes, rulers and a scale bar", () => {
    const { container, getByRole } = render(
      <LayoutPlan
        id="plan"
        doc={d}
        catalog={CATALOG}
        variant="full"
        title="The whole camp"
      />,
    );
    expect(getByRole("img", { name: "The whole camp" })).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).toContain("Bedouin");
    expect(text).toContain("12 × 8 m");
    expect(text).toContain("40 m");
    expect(text).toContain("Frontage");
    expect(container.querySelector("clipPath#plan-clip")).toBeTruthy();
  });

  it("never draws a warning, even for a document that has them", () => {
    const { container } = render(
      <LayoutPlan
        id="plan"
        doc={d}
        catalog={CATALOG}
        variant="full"
        title="The whole camp"
      />,
    );
    const text = container.textContent ?? "";
    // The drawing is there — the absence below is not an empty document.
    expect(text).toContain("Kitchen");
    expect(text).toContain("Stage");
    expect(text).not.toMatch(/outside|overlap|warning|clearance/i);
  });

  it("links a covered area only when the caller gives a link", () => {
    const withLink = render(
      <LayoutPlan
        id="a"
        doc={d}
        catalog={CATALOG}
        variant="full"
        title="Plan"
        openHref={(oid) => `/camps/x/layout?area=${oid}`}
      />,
    );
    const link = withLink.container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(`/camps/x/layout?area=${bedouin.id}`);
    expect(link?.textContent).toContain("1 inside · open");
    withLink.unmount();

    const without = render(
      <LayoutPlan id="b" doc={d} catalog={CATALOG} variant="full" title="Plan" />,
    );
    expect(without.container.querySelector("a")).toBeNull();
  });

  it("a thumbnail is shapes only", () => {
    const { container } = render(
      <LayoutPlan id="t" doc={d} catalog={CATALOG} variant="thumb" title="Small" />,
    );
    expect(container.querySelectorAll("text")).toHaveLength(0);
    expect(container.querySelectorAll("[data-object-id]")).toHaveLength(4);
  });

  it("the compact drawing has no rulers and draws icons where names do not fit", () => {
    const { container } = render(
      <LayoutPlan
        id="c"
        doc={doc([o("tent-1p", 5, 5), o("kitchen", 20, 15)])}
        catalog={CATALOG}
        variant="compact"
        title="Phone"
      />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("40 m");
    expect(text).not.toContain("× ");
    // The tent's icon is a nested <svg> inside the drawing.
    expect(container.querySelectorAll("svg svg").length).toBeGreaterThan(0);
  });

  it("opens a covered area with a dashed outline, and draws nothing for an unknown id", () => {
    const inside = render(
      <LayoutPlan
        id="in"
        doc={d}
        catalog={CATALOG}
        areaId={bedouin.id}
        variant="full"
        title="Inside"
      />,
    );
    expect(
      inside.container.querySelector("polygon[stroke-dasharray]"),
    ).toBeTruthy();
    expect(inside.container.textContent).not.toContain("Frontage");
    inside.unmount();
    const none = render(
      <LayoutPlan
        id="none"
        doc={d}
        catalog={CATALOG}
        areaId={id()}
        variant="full"
        title="Nothing"
      />,
    );
    expect(none.container.querySelector("svg")).toBeNull();
  });
});
