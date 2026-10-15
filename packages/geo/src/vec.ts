// 2D vectors in METRES. Plain tuples, so a document can hold them as JSON
// and nothing has to be converted on the way in or out.
//
// Axis convention (docs/gis-placement-spec.md §B.4): x along the frontage,
// y into the depth. A positive rotation turns +x towards +y. On a screen
// that draws y downwards, that reads as clockwise — the maths does not care.

export type Vec = readonly [x: number, y: number];

/** Below this, two lengths in metres are the same length (a micrometre). */
export const EPSILON = 1e-6;

/** A vector from its two components, in metres. */
export function vec(x: number, y: number): Vec {
  return [x, y];
}

/** a + b, component-wise. */
export function add(a: Vec, b: Vec): Vec {
  return [a[0] + b[0], a[1] + b[1]];
}

/** a − b: the vector from b to a. */
export function sub(a: Vec, b: Vec): Vec {
  return [a[0] - b[0], a[1] - b[1]];
}

/** `a` stretched by the scalar `k`. */
export function scale(a: Vec, k: number): Vec {
  return [a[0] * k, a[1] * k];
}

/** The dot product; the length of `a` along `b` when `b` is a unit vector. */
export function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1];
}

/** The z of the 3D cross product: > 0 when b is counter-clockwise of a. */
export function cross(a: Vec, b: Vec): number {
  return a[0] * b[1] - a[1] * b[0];
}

/** Euclidean length, in metres. */
export function length(a: Vec): number {
  return Math.hypot(a[0], a[1]);
}

/** Euclidean distance between two points, in metres. */
export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Degrees to radians. */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Rotate `v` about the origin by `deg` degrees. Exact at multiples of 90° —
 * `Math.cos(π/2)` is 6e-17, not 0, and a 90° tent should not be 6e-17 m
 * off its own grid line.
 */
export function rotate(v: Vec, deg: number): Vec {
  const [c, s] = cosSin(deg);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
}

/** cos and sin of `deg`, snapped to exact values at quarter turns. */
export function cosSin(deg: number): readonly [cos: number, sin: number] {
  const r = ((deg % 360) + 360) % 360;
  if (r === 0) return [1, 0];
  if (r === 90) return [0, 1];
  if (r === 180) return [-1, 0];
  if (r === 270) return [0, -1];
  const rad = degToRad(r);
  return [Math.cos(rad), Math.sin(rad)];
}

/** False when either component is NaN or ±Infinity. */
export function isFiniteVec(v: Vec): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]);
}
