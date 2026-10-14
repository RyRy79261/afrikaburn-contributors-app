// Simple polygons as rings of vertices in metres. A ring is NOT closed: the
// edge from the last vertex back to the first is implied. Either winding is
// accepted; `normaliseRing` turns one counter-clockwise when an algorithm
// needs it.

import { cross, distance, dot, EPSILON, sub, type Vec } from "./vec";

export type Ring = readonly Vec[];

export interface BBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Vertex `i` of a ring, wrapping. Rings are never empty where this is used. */
export function vertexAt(ring: Ring, i: number): Vec {
  const n = ring.length;
  return ring[((i % n) + n) % n] as Vec;
}

/** Every edge of the ring as [start, end]. */
export function edges(ring: Ring): Array<readonly [Vec, Vec]> {
  return ring.map((p, i) => [p, vertexAt(ring, i + 1)] as const);
}

/** Shoelace area, signed: > 0 for counter-clockwise (x right, y up). */
export function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    sum += cross(vertexAt(ring, i), vertexAt(ring, i + 1));
  }
  return sum / 2;
}

export function area(ring: Ring): number {
  return Math.abs(signedArea(ring));
}

/** The ring wound counter-clockwise (positive signed area). */
export function normaliseRing(ring: Ring): Ring {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring;
}

export function bbox(points: readonly Vec[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function bboxSize(b: BBox): readonly [width: number, depth: number] {
  return [b.maxX - b.minX, b.maxY - b.minY];
}

/** Area centroid. Falls back to the vertex mean for a degenerate ring. */
export function centroid(ring: Ring): Vec {
  const a = signedArea(ring);
  if (Math.abs(a) < EPSILON) {
    const n = ring.length || 1;
    return [
      ring.reduce((s, p) => s + p[0], 0) / n,
      ring.reduce((s, p) => s + p[1], 0) / n,
    ];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = vertexAt(ring, i);
    const q = vertexAt(ring, i + 1);
    const c = cross(p, q);
    cx += (p[0] + q[0]) * c;
    cy += (p[1] + q[1]) * c;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/** True when the ring turns the same way at every vertex. */
export function isConvex(ring: Ring): boolean {
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = vertexAt(ring, i);
    const b = vertexAt(ring, i + 1);
    const c = vertexAt(ring, i + 2);
    const z = cross(sub(b, a), sub(c, b));
    if (Math.abs(z) < EPSILON) continue;
    const s = Math.sign(z);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Shortest distance from point `p` to the segment a–b. */
export function distanceToSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
  return distance(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]);
}

/** Shortest distance from `p` to any edge of the ring (inside or out). */
export function distanceToBoundary(p: Vec, ring: Ring): number {
  let best = Infinity;
  for (const [a, b] of edges(ring)) {
    best = Math.min(best, distanceToSegment(p, a, b));
  }
  return best;
}

/**
 * Is `p` inside the ring? A point ON an edge (within EPSILON) counts as
 * inside: a tent placed exactly against the plot edge is in the plot.
 * Even-odd ray casting, so it is right for concave rings — the GIS outline
 * of an erf on a curved road is not a rectangle.
 */
export function pointInPolygon(p: Vec, ring: Ring): boolean {
  if (ring.length < 3) return false;
  if (distanceToBoundary(p, ring) <= EPSILON) return true;
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = vertexAt(ring, i);
    const [xj, yj] = vertexAt(ring, j);
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Signed distance to the boundary: positive inside, negative outside. */
export function signedDistanceToBoundary(p: Vec, ring: Ring): number {
  const d = distanceToBoundary(p, ring);
  return pointInPolygon(p, ring) ? d : -d;
}

function orientation(a: Vec, b: Vec, c: Vec): number {
  const v = cross(sub(b, a), sub(c, a));
  return Math.abs(v) < EPSILON * EPSILON ? 0 : Math.sign(v);
}

/**
 * Do the segments a–b and c–d CROSS — pass through each other's interior?
 * Touching at an end point, or running along each other, is not a crossing:
 * a tent flush against the plot edge is not leaving the plot.
 */
export function segmentsCross(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** Shortest distance between two segments (0 when they cross). */
export function segmentDistance(a: Vec, b: Vec, c: Vec, d: Vec): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  );
}

/** Shortest distance between the outlines of two rings. */
export function ringEdgeDistance(a: Ring, b: Ring): number {
  let best = Infinity;
  for (const [p, q] of edges(a)) {
    for (const [r, s] of edges(b)) {
      best = Math.min(best, segmentDistance(p, q, r, s));
    }
  }
  return best;
}

/** The axis-aligned rectangle [0, width] × [0, depth] as a ring. */
export function rectRing(width: number, depth: number): Ring {
  return [
    [0, 0],
    [width, 0],
    [width, depth],
    [0, depth],
  ];
}
