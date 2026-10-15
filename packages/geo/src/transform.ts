// Nested coordinate frames. A plot is the root frame. A shade structure's
// covered area is a child frame: its own origin and axes, placed and turned
// inside the plot. A tent under a Bedouin is stored in the Bedouin's local
// metres, so moving or rotating the Bedouin moves every tent with it and
// nothing under it has to be rewritten.
//
//   parent point = origin + rotate(local point, rotationDeg)

import { add, rotate, sub, type Vec } from "./vec";
import { normaliseDeg } from "./snap";

/** Where a child frame's origin sits in its parent, and how far it turns. */
export interface Frame {
  readonly origin: Vec;
  readonly rotationDeg: number;
}

export const IDENTITY_FRAME: Frame = { origin: [0, 0], rotationDeg: 0 };

/** A point in the child frame, in the parent's coordinates. */
export function toParent(frame: Frame, local: Vec): Vec {
  return add(frame.origin, rotate(local, frame.rotationDeg));
}

/** A point in the parent's coordinates, in the child frame. */
export function toLocal(frame: Frame, parent: Vec): Vec {
  return rotate(sub(parent, frame.origin), -frame.rotationDeg);
}

/** A rotation in the child frame, as a rotation in the parent. */
export function angleToParent(frame: Frame, localDeg: number): number {
  return normaliseDeg(localDeg + frame.rotationDeg);
}

/** A rotation in the parent, as a rotation in the child frame. */
export function angleToLocal(frame: Frame, parentDeg: number): number {
  return normaliseDeg(parentDeg - frame.rotationDeg);
}

/**
 * `inner` is a frame inside `outer`'s local space; the result is the same
 * frame expressed in `outer`'s parent. Composing child-of-child frames this
 * way is what lets a GIS anchor (plot → site plane) sit on top later.
 */
export function composeFrames(outer: Frame, inner: Frame): Frame {
  return {
    origin: toParent(outer, inner.origin),
    rotationDeg: normaliseDeg(outer.rotationDeg + inner.rotationDeg),
  };
}

/** The frame that undoes `frame`: toParent(invert(f), p) === toLocal(f, p). */
export function invertFrame(frame: Frame): Frame {
  return {
    origin: rotate(sub([0, 0], frame.origin), -frame.rotationDeg),
    rotationDeg: normaliseDeg(-frame.rotationDeg),
  };
}
