import { describe, it, expect } from "vitest";
import type { GasFuelRecord, LayoutDocument } from "@quagga/types";
import {
  NOT_ANSWERED,
  placeSafetyReviewFields,
  safetyReviewFields,
  type SafetyReviewInput,
} from "@/lib/registration-safety-review";

// The org review's section 4 safety fields (docs/registration-safety-spec.md
// §"Org review"). Real values instead of a placeholder; extinguishers and
// structures from the PINNED snapshot only; the gas & fuel record only once
// saved. Fixture values come from the real vocabulary (catalogue keys, fire
// kinds, the 2027 dates).

const OVER: GasFuelRecord = {
  lpg: [{ sizeKg: 48, count: 2 }],
  jerryCans20l: 2,
  barrels200l: 1,
  fuelTrailers: 0,
  note: "The diesel barrel is for the generator.",
};

function pinned(): LayoutDocument {
  const base = {
    rotationDeg: 0,
    clearanceM: 0,
    safetyM: 0,
    visibility: "public" as const,
  };
  return {
    schemaVersion: 1,
    plot: {
      boundary: { kind: "rect", width: 30, depth: 25 },
      objects: [
        { ...base, id: "00000000-0000-4000-8000-000000000001", catalogKey: "bedouin", shape: "rect", centre: [8, 8], width: 12, length: 8, label: "Bedouin tent" },
        { ...base, id: "00000000-0000-4000-8000-000000000002", catalogKey: "stretch-tent", shape: "rect", centre: [20, 8], width: 15, length: 10, label: "Stretch tent" },
        { ...base, id: "00000000-0000-4000-8000-000000000003", catalogKey: "generator", shape: "rect", centre: [25, 20], width: 2, length: 1.5 },
      ],
    },
  };
}

function input(over: Partial<SafetyReviewInput> = {}): SafetyReviewInput {
  return {
    registration: {
      s4HasGenerator: true,
      s4HasFire: true,
      s4FireKinds: ["braai_brazier", "gas_cooking_heating"],
      s4HasGasOrFuel: true,
      s4ExpectedPopulation: 45,
      s4FirstArrivalDate: "2027-04-24",
    },
    edition: { year: 2027, endDate: "2027-05-02" },
    pinnedLayout: pinned(),
    gasFuel: {
      record: OVER,
      updatedAt: new Date("2027-01-14T10:00:00Z"),
      campNotifiedAt: new Date("2027-01-14T10:00:00Z"),
      wranglerNotifiedAt: null,
    },
    wranglerAssigned: false,
    ...over,
  };
}

const byLabel = (fields: ReturnType<typeof safetyReviewFields>) =>
  Object.fromEntries(fields.map((f) => [f.label, f]));

describe("safetyReviewFields", () => {
  it("shows the real answers and the derived numbers", () => {
    const f = byLabel(safetyReviewFields(input()));
    expect(f["Generator"]!.value).toBe("Yes");
    expect(f["Fire"]!.value).toBe(
      "Yes — braai or brazier (raised), gas cooking or heating",
    );
    expect(f["Gas or fuel"]!.value).toBe("Yes");
    expect(f["Water estimate"]!.value).toBe(
      "About 2,025 L — 5 L a person a day × 45 people × 9 days. Worked out, not asked.",
    );
    expect(f["Extinguishers (from the pinned layout)"]!.value).toMatch(
      /^6 × 4\.5 kg DCP and 1 × 1\.5 kg by the generator/,
    );
    expect(f["Structures (from the pinned layout)"]!.value).toBe(
      "Bedouin tent 12 × 8 m, Stretch tent 15 × 10 m and a generator.",
    );
  });

  it("an unanswered gate reads 'Not answered yet (Form 2)', never No", () => {
    const f = byLabel(
      safetyReviewFields(
        input({
          registration: {
            ...input().registration,
            s4HasGenerator: null,
            s4HasFire: null,
            s4HasGasOrFuel: false,
          },
        }),
      ),
    );
    expect(f["Generator"]!.value).toBe(NOT_ANSWERED);
    expect(f["Fire"]!.value).toBe(NOT_ANSWERED);
    expect(f["Gas or fuel"]!.value).toBe("No");
  });

  it("Fuel depot names only what is over the limit", () => {
    const f = byLabel(
      safetyReviewFields(
        input({
          gasFuel: {
            // 27 kg of gas and 2 × 20 L stay in camp; 3 jerry cans do not.
            record: { ...OVER, lpg: [{ sizeKg: 9, count: 3 }], jerryCans20l: 3, barrels200l: 0 },
            updatedAt: new Date("2027-01-14T10:00:00Z"),
            campNotifiedAt: null,
            wranglerNotifiedAt: null,
          },
        }),
      ),
    );
    expect(f["Fuel depot"]!.value).toMatch(/^3 × 20 L jerry cans\./);
  });

  it("Fuel depot: over the limit, with when each side was told", () => {
    const f = byLabel(safetyReviewFields(input()));
    expect(f["Fuel depot"]!.chip).toEqual({ tone: "warning", text: "Over the limit" });
    // Only what is OVER: 2 × 20 L jerry cans stay in camp (frame LN9Ap).
    expect(f["Fuel depot"]!.value).toMatch(/^96 kg of gas and a 200 L barrel\./);
    expect(f["Fuel depot"]!.value).toMatch(/Wrangler not told yet: none assigned/);

    const told = byLabel(
      safetyReviewFields(
        input({
          wranglerAssigned: true,
          gasFuel: { ...input().gasFuel!, wranglerNotifiedAt: new Date("2027-02-01T09:00:00Z") },
        }),
      ),
    );
    expect(told["Fuel depot"]!.value).toMatch(/The wrangler was told on/);
    expect(told["Fuel depot"]!.value).not.toMatch(/none assigned/);
  });

  it("Fuel depot: within the limits", () => {
    const f = byLabel(
      safetyReviewFields(
        input({
          gasFuel: {
            ...input().gasFuel!,
            record: { ...OVER, lpg: [{ sizeKg: 9, count: 2 }], barrels200l: 0 },
          },
        }),
      ),
    );
    expect(f["Fuel depot"]!.chip?.text).toBe("Within the limits");
  });

  it("leaves out the record and depot fields with no SAVED record", () => {
    const f = byLabel(safetyReviewFields(input({ gasFuel: null })));
    expect(f["Generator"]).toBeDefined();
    expect(f["Fuel depot"]).toBeUndefined();
    expect(f["Gas & fuel record"]).toBeUndefined();
  });

  it("leaves out extinguishers and structures with no pinned layout", () => {
    const f = byLabel(safetyReviewFields(input({ pinnedLayout: null })));
    expect(f["Generator"]).toBeDefined();
    expect(f["Extinguishers (from the pinned layout)"]).toBeUndefined();
    expect(f["Structures (from the pinned layout)"]).toBeUndefined();
  });

  it("never mentions sand", () => {
    const text = JSON.stringify(safetyReviewFields(input())).toLowerCase();
    expect(text).not.toContain("sand");
  });
});

describe("placeSafetyReviewFields — the frame's order (LN9Ap / oOOW1)", () => {
  it("puts the water estimate beside the population and keeps the rest in order", () => {
    const fields = safetyReviewFields(input({ gasFuel: null, pinnedLayout: null }));
    const placed = placeSafetyReviewFields(fields);
    expect(placed.besidePopulation.map((f) => f.label)).toEqual(["Water estimate"]);
    expect(placed.afterSize.map((f) => f.label)).toEqual([
      "Generator",
      "Fire",
      "Gas or fuel",
    ]);
  });
});
