import { describe, expect, it } from "vitest";
import {
  angleToLocal,
  angleToParent,
  composeFrames,
  cosSin,
  invertFrame,
  normaliseDeg,
  rotate,
  snapAngle,
  snapLength,
  snapPoint,
  snapTo,
  toLocal,
  toParent,
  type Frame,
  type Vec,
} from "../index";

function close(a: Vec, b: Vec, eps = 1e-9) {
  expect(a[0]).toBeCloseTo(b[0], 9);
  expect(a[1]).toBeCloseTo(b[1], 9);
  expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBeLessThan(eps * 10);
}

describe("rotation maths", () => {
  it("is exact at quarter turns — a 90° tent stays on its grid line", () => {
    expect(rotate([2, 0], 90)).toEqual([0, 2]);
    expect(rotate([2, 0], 180)).toEqual([-2, 0]);
    expect(rotate([2, 0], 270)).toEqual([0, -2]);
    expect(rotate([2, 0], -90)).toEqual([0, -2]);
    expect(rotate([2, 0], 450)).toEqual([0, 2]);
  });

  it("turns +x towards +y for a positive angle", () => {
    const [x, y] = rotate([1, 0], 30);
    expect(x).toBeCloseTo(Math.sqrt(3) / 2, 12);
    expect(y).toBeCloseTo(0.5, 12);
  });

  it("cosSin agrees with Math away from the quarter turns", () => {
    const [c, s] = cosSin(37);
    expect(c).toBeCloseTo(Math.cos((37 * Math.PI) / 180), 12);
    expect(s).toBeCloseTo(Math.sin((37 * Math.PI) / 180), 12);
  });
});

describe("snapping — in metres and degrees, never pixels", () => {
  it("snaps lengths to the 0.5 m grid", () => {
    expect(snapLength(3.24)).toBe(3);
    expect(snapLength(3.26)).toBe(3.5);
    expect(snapLength(3.75)).toBe(4);
    expect(snapLength(-1.3)).toBe(-1.5);
    expect(snapLength(0.1 + 0.2, 0.1)).toBe(0.3);
  });

  it("never returns -0", () => {
    expect(Object.is(snapLength(-0.1), 0)).toBe(true);
  });

  it("passes the value through when the step is off", () => {
    expect(snapTo(3.14159, 0)).toBe(3.14159);
    expect(snapTo(3.14159, -1)).toBe(3.14159);
  });

  it("snaps points on both axes", () => {
    expect(snapPoint([20.9, 14.2])).toEqual([21, 14]);
  });

  it("snaps angles to 15° and normalises into [0, 360)", () => {
    expect(snapAngle(7)).toBe(0);
    expect(snapAngle(8)).toBe(15);
    expect(snapAngle(352.6)).toBe(0);
    expect(snapAngle(-20)).toBe(345);
    expect(snapAngle(725)).toBe(0);
    expect(snapAngle(100, 0)).toBe(100);
  });

  it("normalises any angle", () => {
    expect(normaliseDeg(-90)).toBe(270);
    expect(normaliseDeg(360)).toBe(0);
    expect(normaliseDeg(720.5)).toBe(0.5);
    expect(normaliseDeg(360 - 1e-12)).toBe(0);
  });
});

describe("nested frames — local ⇄ parent", () => {
  // A Bedouin whose covered area starts at (10, 5) on the plot, turned 90°.
  const bedouin: Frame = { origin: [10, 5], rotationDeg: 90 };

  it("places a tent's local point in the plot", () => {
    // 4 m along the Bedouin's x is 4 m along the plot's y after a 90° turn.
    expect(toParent(bedouin, [4, 0])).toEqual([10, 9]);
    expect(toParent(bedouin, [0, 2])).toEqual([8, 5]);
  });

  it("round-trips at any angle", () => {
    const f: Frame = { origin: [12.3, -4.5], rotationDeg: 37 };
    const p: Vec = [3.3, 7.1];
    close(toLocal(f, toParent(f, p)), p);
    close(toParent(f, toLocal(f, p)), p);
  });

  it("composes child-of-child frames", () => {
    const plotInSite: Frame = { origin: [100, 200], rotationDeg: 30 };
    const composed = composeFrames(plotInSite, bedouin);
    const local: Vec = [1.5, 2.5];
    close(
      toParent(composed, local),
      toParent(plotInSite, toParent(bedouin, local)),
    );
    expect(composed.rotationDeg).toBe(120);
  });

  it("inverts a frame", () => {
    const f: Frame = { origin: [3, 4], rotationDeg: 200 };
    const p: Vec = [9, -2];
    close(toParent(invertFrame(f), p), toLocal(f, p));
  });

  it("carries angles across", () => {
    expect(angleToParent(bedouin, 300)).toBe(30);
    expect(angleToLocal(bedouin, 30)).toBe(300);
  });
});
