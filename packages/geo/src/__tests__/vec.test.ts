import { describe, expect, it } from "vitest";
import {
  add,
  cross,
  dot,
  isFiniteVec,
  length,
  scale,
  sub,
  vec,
} from "../index";

describe("vectors", () => {
  it("does the arithmetic", () => {
    expect(vec(1, 2)).toEqual([1, 2]);
    expect(add([1, 2], [3, 4])).toEqual([4, 6]);
    expect(sub([1, 2], [3, 4])).toEqual([-2, -2]);
    expect(scale([1, 2], 2)).toEqual([2, 4]);
    expect(dot([1, 2], [3, 4])).toBe(11);
    expect(cross([1, 0], [0, 1])).toBe(1);
    expect(length([3, 4])).toBe(5);
  });

  it("refuses non-finite coordinates", () => {
    expect(isFiniteVec([1, 2])).toBe(true);
    expect(isFiniteVec([Number.NaN, 2])).toBe(false);
    expect(isFiniteVec([1, Infinity])).toBe(false);
  });
});
