import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";
import type { GasFuelRecord } from "@quagga/types";

// The server render must not depend on how many forms the server process has
// rendered before (CodeRabbit on #117): a module-level row counter made the
// server's "lpg-size-7" meet the client's "lpg-size-1" — a hydration mismatch.
// Two renders in one process stand in for two requests.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("@/app/(app)/camps/[slug]/gas-fuel/actions", () => ({
  saveGasFuelRecordAction: async () => ({ ok: true }),
  startGasFuelFromLastYearAction: async () => ({ ok: true }),
}));

const { GasFuelForm } = await import("../gas-fuel-form");

const RECORD: GasFuelRecord = {
  lpg: [
    { sizeKg: 48, count: 2 },
    { sizeKg: 9, count: 1 },
  ],
  jerryCans20l: 2,
  barrels200l: 0,
  fuelTrailers: 0,
  note: "",
};

function form(stored: { record: GasFuelRecord; isDraft: boolean } | null) {
  return React.createElement(GasFuelForm, {
    slug: "camp-404",
    canEdit: true,
    stored,
    lastYear: null,
    draftSourceYear: null,
    wranglerName: null,
  });
}

const ids = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
const fors = (html: string) => [...html.matchAll(/\sfor="([^"]+)"/g)].map((m) => m[1]!);

describe("GasFuelForm ids", () => {
  it("renders the same HTML for the same record, however many renders came before", () => {
    const first = renderToString(form({ record: RECORD, isDraft: false }));
    renderToString(form(null));
    const again = renderToString(form({ record: RECORD, isDraft: false }));
    expect(again).toBe(first);
  });

  it("two forms on one page share no id, and every label points at a field", () => {
    const html = renderToString(
      React.createElement(
        React.Fragment,
        null,
        form({ record: RECORD, isDraft: false }),
        form({ record: RECORD, isDraft: false }),
      ),
    );
    const all = ids(html);
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all).size).toBe(all.length);
    const labelled = fors(html);
    expect(labelled.length).toBeGreaterThan(0);
    for (const f of labelled) expect(all).toContain(f);
  });
});
