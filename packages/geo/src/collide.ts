// Overlap, distance and containment for footprints. Exact for rectangles and
// circles: SAT for rectangle pairs, closest-point for anything with a circle.
// Polygons only appear as BOUNDARIES (a plot, a covered area), which may be
// concave — the GIS outline of an erf is whatever shape the erf is.
//
// Touching is not overlapping: two tents pitched flush against each other,
// or a container flush against the plot edge, raise nothing. Everything here
// compares against EPSILON (a micrometre) for that reason.

import { add, distance, dot, EPSILON, rotate, sub, type Vec } from "./vec";
import {
  distanceToBoundary,
  distanceToSegment,
  edges,
  pointInPolygon,
  ringEdgeDistance,
  segmentDistance,
  segmentsCross,
  signedDistanceToBoundary,
  type Ring,
} from "./polygon";
import { clipConvex } from "./clip";
import {
  footprintRing,
  rectCorners,
  type CircleFootprint,
  type Footprint,
  type RectFootprint,
} from "./shapes";

/** A point in a rectangle's own axes (origin at its centre). */
function inRectFrame(r: RectFootprint, p: Vec): Vec {
  return rotate(sub(p, r.centre), -r.rotationDeg);
}

function rectAxes(r: RectFootprint): Vec[] {
  return [rotate([1, 0], r.rotationDeg), rotate([0, 1], r.rotationDeg)];
}

function project(ring: Ring, axis: Vec): readonly [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of ring) {
    const d = dot(p, axis);
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

function rectRectDepth(a: RectFootprint, b: RectFootprint): number {
  const ra = rectCorners(a);
  const rb = rectCorners(b);
  let depth = Infinity;
  for (const axis of [...rectAxes(a), ...rectAxes(b)]) {
    const [minA, maxA] = project(ra, axis);
    const [minB, maxB] = project(rb, axis);
    depth = Math.min(depth, Math.min(maxA, maxB) - Math.max(minA, minB));
  }
  return depth;
}

function circleRectDepth(c: CircleFootprint, r: RectFootprint): number {
  const [x, y] = inRectFrame(r, c.centre);
  const hw = r.width / 2;
  const hl = r.length / 2;
  const cx = Math.max(-hw, Math.min(hw, x));
  const cy = Math.max(-hl, Math.min(hl, y));
  const outside = cx !== x || cy !== y;
  if (outside) return c.radius - distance([x, y], [cx, cy]);
  // Centre inside the rectangle: the circle must move this far to clear it.
  return c.radius + Math.min(hw - Math.abs(x), hl - Math.abs(y));
}

/**
 * How far two footprints overlap — the shortest push that separates them,
 * in metres. Zero or negative when they do not overlap. For two rectangles
 * a negative value is a separation along one axis, NOT the distance between
 * them; use `footprintDistance` for that.
 */
export function penetrationDepth(a: Footprint, b: Footprint): number {
  if (a.kind === "rect" && b.kind === "rect") return rectRectDepth(a, b);
  if (a.kind === "circle" && b.kind === "circle") {
    return a.radius + b.radius - distance(a.centre, b.centre);
  }
  return a.kind === "circle"
    ? circleRectDepth(a, b as RectFootprint)
    : circleRectDepth(b as CircleFootprint, a);
}

/** Do the footprints overlap by more than a touch? */
export function overlaps(a: Footprint, b: Footprint): boolean {
  return penetrationDepth(a, b) > EPSILON;
}

/** The shared region of two overlapping footprints (circles approximated).
 * Empty when they do not overlap. */
export function intersectionRing(a: Footprint, b: Footprint): Ring {
  if (!overlaps(a, b)) return [];
  return clipConvex(footprintRing(a), footprintRing(b));
}

/** Shortest gap between two footprints, in metres. 0 when they overlap. */
export function footprintDistance(a: Footprint, b: Footprint): number {
  if (overlaps(a, b)) return 0;
  if (a.kind === "circle" && b.kind === "circle") {
    return Math.max(0, distance(a.centre, b.centre) - a.radius - b.radius);
  }
  if (a.kind === "circle" || b.kind === "circle") {
    const c = (a.kind === "circle" ? a : b) as CircleFootprint;
    const r = (a.kind === "circle" ? b : a) as RectFootprint;
    // Not overlapping, so the centre is outside the rectangle and the depth
    // is radius − (centre to nearest point): its negation is the gap.
    return Math.max(0, -circleRectDepth(c, r));
  }
  return ringEdgeDistance(rectCorners(a), rectCorners(b));
}

/** Is the point inside (or on the edge of) the footprint? */
export function footprintContainsPoint(f: Footprint, p: Vec): boolean {
  if (f.kind === "circle") return distance(f.centre, p) <= f.radius + EPSILON;
  const [x, y] = inRectFrame(f, p);
  return (
    Math.abs(x) <= f.width / 2 + EPSILON &&
    Math.abs(y) <= f.length / 2 + EPSILON
  );
}

/**
 * Is the footprint wholly inside the boundary ring? The ring may be
 * concave. Flush against an edge counts as inside.
 */
export function footprintInsideRing(f: Footprint, ring: Ring): boolean {
  if (f.kind === "circle") {
    return (
      pointInPolygon(f.centre, ring) &&
      distanceToBoundary(f.centre, ring) >= f.radius - EPSILON
    );
  }
  const corners = rectCorners(f);
  if (!corners.every((p) => pointInPolygon(p, ring))) return false;
  for (const [a, b] of edges(corners)) {
    for (const [c, d] of edges(ring)) {
      if (segmentsCross(a, b, c, d)) return false;
    }
  }
  // A notch of a concave boundary reaching into the rectangle.
  const shrunk: RectFootprint = {
    ...f,
    width: Math.max(0, f.width - 2 * EPSILON),
    length: Math.max(0, f.length - 2 * EPSILON),
  };
  return !ring.some(
    (v) => footprintContainsPoint(shrunk, v) && !onRectEdge(f, v),
  );
}

function onRectEdge(r: RectFootprint, p: Vec): boolean {
  const ring = rectCorners(r);
  return distanceToBoundary(p, ring) <= EPSILON;
}

/**
 * How far the footprint reaches OUTSIDE the boundary, in metres: the
 * furthest corner (or the circle's far side) beyond the nearest edge. 0 when
 * it is inside. A rectangle can leave a concave boundary with no corner
 * outside (it bridges a notch); that reads 0 here and false in
 * `footprintInsideRing`, and the caller words it without a number.
 */
export function overflowBeyondRing(f: Footprint, ring: Ring): number {
  if (f.kind === "circle") {
    return Math.max(0, f.radius - signedDistanceToBoundary(f.centre, ring));
  }
  let worst = 0;
  for (const p of rectCorners(f)) {
    worst = Math.max(worst, -signedDistanceToBoundary(p, ring));
  }
  return worst;
}

/**
 * Shortest distance from a footprint INSIDE a boundary to that boundary's
 * outline. "The fire pit is 1.2 m from the plot edge."
 */
export function distanceToRingEdge(f: Footprint, ring: Ring): number {
  if (f.kind === "circle") {
    return Math.max(0, distanceToBoundary(f.centre, ring) - f.radius);
  }
  return ringEdgeDistance(rectCorners(f), ring);
}

/** Shortest distance from a footprint to the segment a–b. 0 when it
 * touches or covers the segment. */
export function footprintDistanceToSegment(
  f: Footprint,
  a: Vec,
  b: Vec,
): number {
  if (f.kind === "circle") {
    return Math.max(0, distanceToSegment(f.centre, a, b) - f.radius);
  }
  if (footprintContainsPoint(f, a) || footprintContainsPoint(f, b)) return 0;
  let best = Infinity;
  for (const [p, q] of edges(rectCorners(f))) {
    best = Math.min(best, segmentDistance(p, q, a, b));
  }
  return best;
}

/** The centre of a footprint moved by `delta`. */
export function translate<F extends Footprint>(f: F, delta: Vec): F {
  return { ...f, centre: add(f.centre, delta) };
}
