import { describe, expect, it } from "vitest";
import {
  area,
  bboxSize,
  bbox,
  circleRing,
  clipConvex,
  distanceToRingEdge,
  footprintArea,
  footprintBBox,
  footprintContainsPoint,
  footprintDistance,
  footprintDistanceToSegment,
  footprintInsideRing,
  footprintRing,
  inflate,
  intersectionRing,
  overflowBeyondRing,
  overlaps,
  penetrationDepth,
  rectCorners,
  rectRing,
  translate,
  type CircleFootprint,
  type RectFootprint,
  type Ring,
} from "../index";

const rect = (
  x: number,
  y: number,
  width: number,
  length: number,
  rotationDeg = 0,
): RectFootprint => ({
  kind: "rect",
  centre: [x, y],
  width,
  length,
  rotationDeg,
});
const circle = (x: number, y: number, radius: number): CircleFootprint => ({
  kind: "circle",
  centre: [x, y],
  radius,
});

const L: Ring = [
  [0, 0],
  [20, 0],
  [20, 10],
  [10, 10],
  [10, 20],
  [0, 20],
];

describe("footprints", () => {
  it("rect corners follow the rotation", () => {
    const c = rectCorners(rect(0, 0, 4, 2, 90));
    expect(c).toEqual([
      [1, -2],
      [1, 2],
      [-1, 2],
      [-1, -2],
    ]);
  });

  it("areas, bounds and rings", () => {
    expect(footprintArea(rect(0, 0, 6, 4))).toBe(24);
    expect(footprintArea(circle(0, 0, 1))).toBeCloseTo(Math.PI, 12);
    expect(footprintBBox(circle(5, 5, 3))).toEqual({
      minX: 2,
      minY: 2,
      maxX: 8,
      maxY: 8,
    });
    expect(bboxSize(footprintBBox(rect(0, 0, 4, 2, 90)))).toEqual([2, 4]);
    expect(footprintRing(circle(0, 0, 1))).toHaveLength(32);
    expect(area(circleRing(circle(0, 0, 1), 256))).toBeCloseTo(Math.PI, 3);
  });

  it("inflates by a halo margin, and leaves it alone at zero", () => {
    expect(inflate(rect(0, 0, 6, 4), 1)).toMatchObject({ width: 8, length: 6 });
    expect(inflate(circle(0, 0, 1.5), 3)).toMatchObject({ radius: 4.5 });
    const r = rect(0, 0, 1, 1);
    expect(inflate(r, 0)).toBe(r);
  });

  it("translates", () => {
    expect(translate(rect(1, 1, 2, 2), [2, 3]).centre).toEqual([3, 4]);
  });
});

describe("overlap — SAT and closest point", () => {
  it("axis-aligned rectangles, both directions across the threshold", () => {
    expect(overlaps(rect(0, 0, 4, 4), rect(3.9, 0, 4, 4))).toBe(true);
    expect(overlaps(rect(0, 0, 4, 4), rect(4.1, 0, 4, 4))).toBe(false);
    expect(penetrationDepth(rect(0, 0, 4, 4), rect(3, 0, 4, 4))).toBeCloseTo(
      1,
      12,
    );
  });

  it("touching is not overlapping", () => {
    expect(overlaps(rect(0, 0, 4, 4), rect(4, 0, 4, 4))).toBe(false);
    expect(overlaps(circle(0, 0, 1), circle(2, 0, 1))).toBe(false);
    expect(overlaps(circle(0, 0, 1), rect(2, 0, 2, 2))).toBe(false);
  });

  it("rotated rectangles that only an AABB test would call overlapping", () => {
    // Two 45° diamonds whose bounding boxes overlap but whose shapes do not.
    const a = rect(0, 0, 2, 2, 45);
    const b = rect(2.2, 2.2, 2, 2, 45);
    const [aw, ad] = bboxSize(footprintBBox(a));
    expect(aw).toBeGreaterThan(2.8);
    expect(ad).toBeGreaterThan(2.8);
    expect(overlaps(a, b)).toBe(false);
    // …and moved closer, they do.
    expect(overlaps(a, rect(1.2, 1.2, 2, 2, 45))).toBe(true);
  });

  it("needs BOTH rectangles' axes — a square against a diamond near its corner", () => {
    // The square's own axes see overlap (the diamond's bounding box covers
    // its corner); only the diamond's diagonal axis separates them.
    const square = rect(0, 0, 2, 2);
    const diamond = rect(1.8, 1.8, 2, 2, 45);
    expect(overlaps(square, diamond)).toBe(false);
    expect(overlaps(diamond, square)).toBe(false);
    expect(overlaps(square, rect(1.5, 1.5, 2, 2, 45))).toBe(true);
  });

  it("circle against circle", () => {
    expect(overlaps(circle(0, 0, 1), circle(1.9, 0, 1))).toBe(true);
    expect(penetrationDepth(circle(0, 0, 1), circle(1.5, 0, 1))).toBeCloseTo(
      0.5,
      12,
    );
  });

  it("circle against rotated rectangle, centre outside and inside", () => {
    const r = rect(0, 0, 4, 2, 90); // 2 wide, 4 tall after the turn
    expect(overlaps(circle(1.9, 0, 1), r)).toBe(true);
    expect(overlaps(circle(2.1, 0, 1), r)).toBe(false);
    expect(overlaps(r, circle(0, 2.9, 1))).toBe(true);
    // a pole inside a tent: radius plus the distance to the nearest side
    expect(penetrationDepth(circle(0.5, 0, 0.125), r)).toBeCloseTo(0.625, 12);
  });
});

describe("intersection and distance", () => {
  it("measures the overlap region", () => {
    const shared = intersectionRing(rect(3, 2, 6, 4), rect(6, 3.5, 4, 5));
    // x 0..6 × y 0..4 against x 4..8 × y 1..6: a 2 × 3 m shared region
    expect(bboxSize(bbox(shared))).toEqual([2, 3]);
    expect(area(shared)).toBeCloseTo(6, 9);
  });

  it("is empty when nothing overlaps", () => {
    expect(intersectionRing(rect(0, 0, 1, 1), rect(5, 5, 1, 1))).toEqual([]);
    expect(
      clipConvex(rectRing(1, 1), [
        [5, 5],
        [6, 5],
        [6, 6],
        [5, 6],
      ]),
    ).toEqual([]);
  });

  it("measures the gap between footprints", () => {
    expect(footprintDistance(rect(0, 0, 2, 2), rect(5, 0, 2, 2))).toBe(3);
    expect(footprintDistance(circle(0, 0, 1), circle(5, 0, 1))).toBe(3);
    expect(footprintDistance(circle(0, 0, 1), rect(5, 0, 2, 2))).toBe(3);
    expect(footprintDistance(rect(5, 0, 2, 2), circle(0, 0, 1))).toBe(3);
    expect(footprintDistance(rect(0, 0, 2, 2), rect(1, 0, 2, 2))).toBe(0);
  });

  it("knows which points a footprint covers", () => {
    expect(footprintContainsPoint(rect(4, 4, 2.2, 2.2), [4, 4])).toBe(true);
    expect(footprintContainsPoint(rect(4, 4, 2.2, 2.2), [5.2, 4])).toBe(false);
    expect(footprintContainsPoint(circle(0, 0, 1), [0, 1])).toBe(true);
  });
});

describe("containment in a boundary — rectangle and concave polygon", () => {
  const plot = rectRing(40, 30);

  it("inside, flush against the edge, and across it", () => {
    expect(footprintInsideRing(rect(3, 1.25, 6, 2.5), plot)).toBe(true);
    expect(footprintInsideRing(rect(3, 1.2, 6, 2.5), plot)).toBe(false);
    expect(overflowBeyondRing(rect(3, 1.2, 6, 2.5), plot)).toBeCloseTo(0.05, 9);
    expect(overflowBeyondRing(rect(3, 5, 6, 2.5), plot)).toBe(0);
  });

  it("circles", () => {
    expect(footprintInsideRing(circle(37.5, 10, 1.5), plot)).toBe(true);
    expect(footprintInsideRing(circle(38.6, 10, 1.5), plot)).toBe(false);
    expect(overflowBeyondRing(circle(38.6, 10, 1.5), plot)).toBeCloseTo(0.1, 9);
    expect(footprintInsideRing(circle(50, 10, 1.5), plot)).toBe(false);
  });

  it("a concave boundary: a rectangle bridging the notch is outside with no corner out", () => {
    // Spans x 8..12 at y 12..14: left half in the leg, right half in the cut.
    const bridging = rect(10, 13, 4, 2);
    expect(footprintInsideRing(bridging, L)).toBe(false);
    // A wide one whose corners all sit inside the L but whose edge crosses the notch.
    const spanning = rect(10, 9, 18, 4); // y 7..11, crosses the inner corner
    expect(footprintInsideRing(spanning, L)).toBe(false);
    expect(footprintInsideRing(rect(5, 15, 4, 4), L)).toBe(true);
    expect(footprintInsideRing(rect(15, 5, 4, 4), L)).toBe(true);
  });

  it("a notch vertex poking into a rectangle with every corner inside", () => {
    // A ring with a spike reaching in from the top edge.
    const spiky: Ring = [
      [0, 0],
      [10, 0],
      [10, 10],
      [6, 10],
      [5, 4],
      [4, 10],
      [0, 10],
    ];
    expect(footprintInsideRing(rect(5, 3, 4, 3), spiky)).toBe(false);
    expect(footprintInsideRing(rect(5, 1.5, 4, 2), spiky)).toBe(true);
  });

  it("a notch vertex inside a rectangle whose edges leave exactly through its corners", () => {
    // The spike's edges pass through the rectangle's top corners, so no edge
    // CROSSES another — only the tip at (5, 3), inside, gives it away.
    const notched: Ring = [
      [0, 0],
      [10, 0],
      [10, 10],
      [9, 10],
      [9, 7],
      [5, 3],
      [1, 7],
      [1, 10],
      [0, 10],
    ];
    expect(footprintInsideRing(rect(5, 3, 4, 4), notched)).toBe(false);
    expect(footprintInsideRing(rect(5, 1.5, 4, 2), notched)).toBe(true);
  });

  it("distance to the boundary from inside", () => {
    expect(distanceToRingEdge(circle(37.3, 10, 1.5), plot)).toBeCloseTo(1.2, 9);
    expect(distanceToRingEdge(rect(5, 5, 2, 2), plot)).toBe(4);
  });

  it("distance to one edge — the frontage", () => {
    const a: [number, number] = [0, 0];
    const b: [number, number] = [40, 0];
    expect(footprintDistanceToSegment(rect(10, 4, 5, 2.5), a, b)).toBeCloseTo(
      2.75,
      9,
    );
    expect(footprintDistanceToSegment(rect(10, 0.5, 5, 2.5), a, b)).toBe(0);
    expect(footprintDistanceToSegment(circle(10, 4, 1), a, b)).toBe(3);
    // a footprint swallowing the whole segment
    expect(footprintDistanceToSegment(rect(0, 0, 100, 4), [1, 0], [2, 0])).toBe(
      0,
    );
  });
});
