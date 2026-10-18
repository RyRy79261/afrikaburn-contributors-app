import { describe, it, expect } from "vitest";
import type { ExtinguisherEstimate } from "@quagga/core";
import { extinguisherHeading } from "../safety-fields";

// Section 4's extinguisher heading. A layout with a generator and no tent or
// shade structure once read "Have 0 fire extinguishers and a small
// extinguisher by the generator" (CodeRabbit on #117).

const est = (units: number, generatorUnits: number): ExtinguisherEstimate => ({
  units,
  generatorUnits,
  structures: units > 0 ? 1 : 0,
  generators: generatorUnits,
  rows: [],
});

describe("extinguisherHeading", () => {
  it("a generator and no structures names only the small extinguisher", () => {
    expect(extinguisherHeading(est(0, 1))).toBe("Have a small extinguisher by the generator");
    expect(extinguisherHeading(est(0, 2))).toBe("Have 2 small extinguishers, one by each generator");
  });
  it("structures, with and without a generator", () => {
    expect(extinguisherHeading(est(2, 0))).toBe("Have 2 fire extinguishers");
    expect(extinguisherHeading(est(1, 0))).toBe("Have 1 fire extinguisher");
    expect(extinguisherHeading(est(4, 1))).toBe(
      "Have 4 fire extinguishers and a small extinguisher by the generator",
    );
  });
  it("nothing on the layout, and no layout", () => {
    expect(extinguisherHeading(est(0, 0))).toBe("No tent or shade structures or generators on your layout yet");
    expect(extinguisherHeading(null)).toBe("Fire extinguishers: worked out from your layout");
  });
});
