import { describe, it, expect } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ExtinguisherEstimate, ExtinguisherRow } from "@quagga/core";
import { ExtinguishersCard } from "../extinguishers-card";

// The Extinguishers card (docs/registration-safety-spec.md §"Extinguisher
// count"). The rule names the size it counts — "2 × 4.5 kg DCP for each
// 100 m²", never "2 of each" — and never mentions sand (Ryan, 18 Oct 2026).

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

const stretch: ExtinguisherRow = {
  objectId: "00000000-0000-4000-8000-000000000001",
  catalogKey: "stretch-tent",
  name: "Stretch tent",
  kind: "structure",
  width: 15,
  length: 10,
  shape: "rect",
  areaM2: 150,
  units: 4,
  generatorUnits: 0,
};
const generator: ExtinguisherRow = {
  ...stretch,
  objectId: "00000000-0000-4000-8000-000000000002",
  catalogKey: "generator",
  name: "Generator 1",
  kind: "generator",
  width: 2,
  length: 1.5,
  areaM2: 3,
  units: 0,
  generatorUnits: 1,
};

function render(e: ExtinguisherEstimate) {
  return text(renderToStaticMarkup(React.createElement(ExtinguishersCard, { estimate: e, mode: "view" })));
}

describe("ExtinguishersCard", () => {
  it("names the size in the rule, and no sand", () => {
    const t = render({ units: 4, generatorUnits: 1, structures: 1, generators: 1, rows: [stretch, generator] });
    expect(t).toContain("2 × 4.5 kg DCP for each 100 m², or part of 100 m², of every tent or shade structure");
    expect(t).not.toContain("2 of each");
    expect(t).not.toMatch(/sand/i);
    expect(t).toContain("4 × 4.5 kg DCP + 1 × 1.5 kg");
  });

  it("a generator and no structures totals only the small one", () => {
    const t = render({ units: 0, generatorUnits: 1, structures: 0, generators: 1, rows: [generator] });
    expect(t).toContain("1 × 1.5 kg");
    expect(t).not.toContain("0 × 4.5 kg DCP");
  });
});
