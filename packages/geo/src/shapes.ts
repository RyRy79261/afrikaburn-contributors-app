// Footprints: the ground a thing covers, in metres, in ONE frame. Two
// shapes cover every object in v1 — a rotated rectangle and a circle. A free
// polygon object is out of scope (docs/camp-layout-spec.md "Not built").

import { add, rotate, type Vec } from "./vec";
import type { Ring } from "./polygon";
import { bbox, type BBox } from "./polygon";

export interface RectFootprint {
  readonly kind: "rect";
  readonly centre: Vec;
  /** Along the rectangle's own x axis, before rotation. */
  readonly width: number;
  /** Along the rectangle's own y axis, before rotation. */
  readonly length: number;
  readonly rotationDeg: number;
}

export interface CircleFootprint {
  readonly kind: "circle";
  readonly centre: Vec;
  readonly radius: number;
}

export type Footprint = RectFootprint | CircleFootprint;

/** How many straight edges stand in for a circle where a ring is needed
 * (clipping, drawing). 32 is within 0.5% of the true area. */
export const CIRCLE_SEGMENTS = 32;

/** A rectangle's four corners, counter-clockwise (x right, y up). */
export function rectCorners(r: RectFootprint): Ring {
  const hw = r.width / 2;
  const hl = r.length / 2;
  const local: Vec[] = [
    [-hw, -hl],
    [hw, -hl],
    [hw, hl],
    [-hw, hl],
  ];
  return local.map((p) => add(r.centre, rotate(p, r.rotationDeg)));
}

export function circleRing(
  c: CircleFootprint,
  segments = CIRCLE_SEGMENTS,
): Ring {
  const ring: Vec[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    ring.push([
      c.centre[0] + c.radius * Math.cos(t),
      c.centre[1] + c.radius * Math.sin(t),
    ]);
  }
  return ring;
}

/** The footprint as a ring (a circle as a regular polygon). */
export function footprintRing(f: Footprint, segments = CIRCLE_SEGMENTS): Ring {
  return f.kind === "rect" ? rectCorners(f) : circleRing(f, segments);
}

export function footprintArea(f: Footprint): number {
  return f.kind === "rect" ? f.width * f.length : Math.PI * f.radius * f.radius;
}

export function footprintBBox(f: Footprint): BBox {
  if (f.kind === "circle") {
    const [x, y] = f.centre;
    return {
      minX: x - f.radius,
      minY: y - f.radius,
      maxX: x + f.radius,
      maxY: y + f.radius,
    };
  }
  return bbox(rectCorners(f));
}

/**
 * The footprint grown by `margin` metres on every side — a clearance or
 * safety halo. A rectangle grows into a larger rectangle, square corners
 * included. The true offset has rounded corners; the square one is slightly
 * larger, so a halo errs on the side of the warning, never of silence.
 */
export function inflate(f: Footprint, margin: number): Footprint {
  if (margin <= 0) return f;
  return f.kind === "rect"
    ? { ...f, width: f.width + 2 * margin, length: f.length + 2 * margin }
    : { ...f, radius: f.radius + margin };
}
