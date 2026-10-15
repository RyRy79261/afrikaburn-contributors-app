// Snapping in METRES and DEGREES — never in pixels — so a 0.5 m grid is the
// same 0.5 m at every zoom level, and the editor and the tests agree on
// where a thing lands (docs/camp-layout-spec.md §Rules).

import type { Vec } from "./vec";

/** The editor's grid step, in metres. */
export const SNAP_LENGTH_M = 0.5;
/** The editor's rotation step, in degrees. */
export const SNAP_ANGLE_DEG = 15;

/** Round `value` to the nearest multiple of `step`. A step of 0 or less
 * (snapping switched off) returns the value unchanged. */
export function snapTo(value: number, step: number): number {
  if (!(step > 0)) return value;
  const snapped = Math.round(value / step) * step;
  // Strip float noise (0.30000000000000004) and the sign of -0.
  return Number(snapped.toFixed(9)) + 0;
}

/** A length snapped to the grid step (0.5 m by default). */
export function snapLength(value: number, step = SNAP_LENGTH_M): number {
  return snapTo(value, step);
}

/** A point with both coordinates snapped to the grid step (0.5 m by
 * default). */
export function snapPoint(p: Vec, step = SNAP_LENGTH_M): Vec {
  return [snapTo(p[0], step), snapTo(p[1], step)];
}

/** Any angle, in degrees, as the same direction in [0, 360). */
export function normaliseDeg(deg: number): number {
  const r = ((deg % 360) + 360) % 360;
  // 359.9999999999 from float noise is a full turn, not "almost".
  return r >= 360 - 1e-9 ? 0 : r + 0;
}

/** Snap an angle to the nearest `step` degrees, normalised to [0, 360). */
export function snapAngle(deg: number, step = SNAP_ANGLE_DEG): number {
  return normaliseDeg(snapTo(normaliseDeg(deg), step));
}
