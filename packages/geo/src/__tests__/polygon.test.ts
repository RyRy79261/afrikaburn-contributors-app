import { describe, expect, it } from "vitest";
import {
  area,
  bbox,
  bboxSize,
  centroid,
  distanceToBoundary,
  distanceToSegment,
  edges,
  isConvex,
  normaliseRing,
  pointInPolygon,
  rectRing,
  ringEdgeDistance,
  segmentDistance,
  segmentsCross,
  signedArea,
  signedDistanceToBoundary,
  type Ring,
} from "../index";

// An L-shaped erf: 20 × 20 with the top-right 10 × 10 cut away. Concave, the
// way a real GIS outline on a curved road may be.
const L: Ring = [
  [0, 0],
  [20, 0],
  [20, 10],
  [10, 10],
  [10, 20],
  [0, 20],
];

describe("polygon basics", () => {
  it("measures area either way round", () => {
    expect(area(rectRing(40, 30))).toBe(1200);
    expect(area([...rectRing(40, 30)].reverse())).toBe(1200);
    expect(area(L)).toBe(300);
  });

  it("normalises winding to counter-clockwise", () => {
    const cw = [...rectRing(4, 3)].reverse();
    expect(signedArea(cw)).toBeLessThan(0);
    expect(signedArea(normaliseRing(cw))).toBeGreaterThan(0);
    const ccw = rectRing(4, 3);
    expect(normaliseRing(ccw)).toBe(ccw);
  });

  it("finds the centroid, and survives a degenerate ring", () => {
    expect(centroid(rectRing(40, 30))).toEqual([20, 15]);
    expect(
      centroid([
        [0, 0],
        [2, 0],
        [4, 0],
      ]),
    ).toEqual([2, 0]);
  });

  it("bounds a ring", () => {
    const b = bbox(L);
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
    expect(bboxSize(b)).toEqual([20, 20]);
  });

  it("tells convex from concave", () => {
    expect(isConvex(rectRing(3, 3))).toBe(true);
    expect(isConvex(L)).toBe(false);
    // collinear points do not make a ring concave
    expect(
      isConvex([
        [0, 0],
        [1, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ]),
    ).toBe(true);
  });

  it("lists edges, closing the ring", () => {
    const e = edges(rectRing(1, 1));
    expect(e).toHaveLength(4);
    expect(e[3]).toEqual([
      [0, 1],
      [0, 0],
    ]);
  });
});

describe("point in polygon", () => {
  it("handles a concave ring", () => {
    expect(pointInPolygon([5, 5], L)).toBe(true);
    expect(pointInPolygon([15, 5], L)).toBe(true);
    expect(pointInPolygon([5, 15], L)).toBe(true);
    expect(pointInPolygon([15, 15], L)).toBe(false); // the cut-away corner
    expect(pointInPolygon([-1, 5], L)).toBe(false);
  });

  it("counts a point on the edge as inside", () => {
    expect(pointInPolygon([0, 5], L)).toBe(true);
    expect(pointInPolygon([10, 15], L)).toBe(true);
    expect(pointInPolygon([20, 0], L)).toBe(true);
  });

  it("is false for a ring with fewer than three vertices", () => {
    expect(
      pointInPolygon(
        [0, 0],
        [
          [0, 0],
          [1, 1],
        ],
      ),
    ).toBe(false);
  });
});

describe("distances", () => {
  it("point to segment, including the ends and a zero-length segment", () => {
    expect(distanceToSegment([5, 3], [0, 0], [10, 0])).toBe(3);
    expect(distanceToSegment([-3, 4], [0, 0], [10, 0])).toBe(5);
    expect(distanceToSegment([3, 4], [0, 0], [0, 0])).toBe(5);
  });

  it("point to boundary, signed by side", () => {
    expect(distanceToBoundary([15, 8], L)).toBe(2);
    expect(signedDistanceToBoundary([15, 8], L)).toBe(2);
    expect(signedDistanceToBoundary([15, 13], L)).toBe(-3);
  });

  it("segments: crossing, touching and apart", () => {
    expect(segmentsCross([0, 0], [2, 2], [0, 2], [2, 0])).toBe(true);
    // sharing an end point is not a crossing
    expect(segmentsCross([0, 0], [2, 0], [2, 0], [2, 2])).toBe(false);
    // collinear overlap is not a crossing
    expect(segmentsCross([0, 0], [2, 0], [1, 0], [3, 0])).toBe(false);
    expect(segmentDistance([0, 0], [2, 2], [0, 2], [2, 0])).toBe(0);
    expect(segmentDistance([0, 0], [2, 0], [0, 3], [2, 3])).toBe(3);
  });

  it("ring to ring", () => {
    const a = rectRing(2, 2);
    const b: Ring = [
      [5, 0],
      [7, 0],
      [7, 2],
      [5, 2],
    ];
    expect(ringEdgeDistance(a, b)).toBe(3);
  });
});
