// Sutherland–Hodgman: clip one CONVEX ring by another. Footprints are
// convex (rectangles, circles as regular polygons), so this is exact for
// every pair of objects in a layout. It measures an overlap ("overlaps by
// 2.0 × 3.0 m"); whether two things overlap at all is collide.ts, exactly.

import { cross, sub, type Vec } from "./vec";
import { normaliseRing, vertexAt, type Ring } from "./polygon";

function inside(p: Vec, a: Vec, b: Vec): boolean {
  return cross(sub(b, a), sub(p, a)) >= 0;
}

function intersect(p: Vec, q: Vec, a: Vec, b: Vec): Vec {
  const r = sub(q, p);
  const s = sub(b, a);
  const denom = cross(r, s);
  if (denom === 0) return p;
  const t = cross(sub(a, p), s) / denom;
  return [p[0] + r[0] * t, p[1] + r[1] * t];
}

/** The part of `subject` inside `clip`. Both convex. Empty when disjoint. */
export function clipConvex(subject: Ring, clip: Ring): Ring {
  let output: Vec[] = [...normaliseRing(subject)];
  const c = normaliseRing(clip);
  for (let i = 0; i < c.length && output.length > 0; i++) {
    const a = vertexAt(c, i);
    const b = vertexAt(c, i + 1);
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const cur = vertexAt(input, j);
      const prev = vertexAt(input, j - 1);
      const curIn = inside(cur, a, b);
      const prevIn = inside(prev, a, b);
      if (curIn) {
        if (!prevIn) output.push(intersect(prev, cur, a, b));
        output.push(cur);
      } else if (prevIn) {
        output.push(intersect(prev, cur, a, b));
      }
    }
  }
  return output.length >= 3 ? output : [];
}
