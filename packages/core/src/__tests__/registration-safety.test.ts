import { describe, it, expect } from "vitest";
import type { GasFuelRecord, LayoutDocument, LayoutObject } from "@quagga/types";
import { FIRE_KINDS, GasFuelRecord as GasFuelRecordSchema } from "@quagga/types";
import { LAYOUT_CATALOG_2027 } from "../layout-catalog";
import {
  adoptGateSuggestions,
  canEditGasFuelRecord,
  canViewGasFuelRecord,
  cleanFireKinds,
  copyGasFuelRecordForNewEdition,
  decideFuelDepotNotice,
  decideGasFuelSave,
  decideStartGasFuelFromLastYear,
  describeExtinguishers,
  describeGasFuelRecord,
  describeWaterEstimate,
  emptyGasFuelRecord,
  extinguisherEstimate,
  extinguishersForStructure,
  formatLitres,
  fuelDepotAdvice,
  fuelDepotNotification,
  fuelDepotReasons,
  gasTotalKg,
  normalizeFireAnswer,
  safetyGatesComplete,
  SAFETY_POLICY_LINKS,
  shouldOfferGasFuelCarryForward,
  shouldSendDeferredWranglerCopy,
  suggestGatesFromLayout,
  tidyGasFuelRecord,
  waterEstimateLitres,
} from "../registration-safety";
import { isSectionComplete } from "../registration-sections";

// Fixtures use the REAL vocabulary: catalogue keys from LAYOUT_CATALOG_2027 and
// the AfrikaBurn 2027 dates (26 April – 2 May 2027).

const EDITION_END = "2027-05-02";
let seq = 0;
function uuid(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

function obj(
  catalogKey: string,
  w: number,
  l: number,
  extra: Partial<LayoutObject> = {},
): LayoutObject {
  const circle = catalogKey === "dome" || catalogKey === "fire-pit";
  return {
    id: uuid(),
    catalogKey,
    shape: circle ? "circle" : "rect",
    centre: [20, 20],
    width: w,
    length: l,
    ...(circle ? { diameter: w } : {}),
    rotationDeg: 0,
    clearanceM: 0,
    safetyM: 0,
    visibility: "public",
    ...extra,
  } as LayoutObject;
}

function doc(objects: LayoutObject[]): LayoutDocument {
  return {
    schemaVersion: 1,
    plot: { boundary: { kind: "rect", width: 30, depth: 25 }, objects },
  };
}

function record(over: Partial<GasFuelRecord> = {}): GasFuelRecord {
  return { ...emptyGasFuelRecord(), ...over };
}

describe("waterEstimateLitres", () => {
  it("5 L × people × days, arrival to the last day inclusive", () => {
    // The frame: 45 people from Sat 24 April to Sun 2 May = 9 days = 2,025 L.
    const w = waterEstimateLitres({
      population: 45,
      firstArrivalDate: "2027-04-24",
      editionEndDate: EDITION_END,
    });
    expect(w).toEqual({ litres: 2025, people: 45, days: 9 });
    expect(describeWaterEstimate(w!)).toBe(
      "5 L a person a day × 45 people × 9 days",
    );
    expect(formatLitres(w!.litres)).toBe("2,025 L");
  });

  it("moves with the population and the arrival", () => {
    const base = { firstArrivalDate: "2027-04-24", editionEndDate: EDITION_END };
    expect(waterEstimateLitres({ ...base, population: 18 })!.litres).toBe(810);
    expect(
      waterEstimateLitres({
        population: 45,
        firstArrivalDate: "2027-04-26",
        editionEndDate: EDITION_END,
      })!.days,
    ).toBe(7);
    // Arriving on the last day is one day.
    expect(
      waterEstimateLitres({
        population: 1,
        firstArrivalDate: EDITION_END,
        editionEndDate: EDITION_END,
      }),
    ).toEqual({ litres: 5, people: 1, days: 1 });
  });

  it("is null without a population or an arrival, or after the burn", () => {
    const base = { editionEndDate: EDITION_END };
    expect(
      waterEstimateLitres({ ...base, population: null, firstArrivalDate: "2027-04-24" }),
    ).toBeNull();
    expect(
      waterEstimateLitres({ ...base, population: 0, firstArrivalDate: "2027-04-24" }),
    ).toBeNull();
    expect(
      waterEstimateLitres({ ...base, population: 45, firstArrivalDate: null }),
    ).toBeNull();
    expect(
      waterEstimateLitres({ ...base, population: 45, firstArrivalDate: "2027-05-03" }),
    ).toBeNull();
  });
});

describe("extinguishersForStructure — 2 for each 100 m², or part of 100 m²", () => {
  it("counts a started block as a whole one", () => {
    expect(extinguishersForStructure(96)).toBe(2);
    expect(extinguishersForStructure(100)).toBe(2);
    expect(extinguishersForStructure(100.5)).toBe(4);
    expect(extinguishersForStructure(150)).toBe(4); // the spec's stretch tent
    expect(extinguishersForStructure(200)).toBe(4);
    expect(extinguishersForStructure(201)).toBe(6);
  });

  it("does not round a float hair over 100 m² up a block", () => {
    expect(extinguishersForStructure(100.000001)).toBe(2);
  });

  it("needs none for no area", () => {
    expect(extinguishersForStructure(0)).toBe(0);
    expect(extinguishersForStructure(Number.NaN)).toBe(0);
  });
});

describe("extinguisherEstimate", () => {
  it("counts every shade structure and every generator, from the layout only", () => {
    const e = extinguisherEstimate(
      doc([
        obj("bedouin", 12, 8, { label: "Bedouin tent" }), // 96 m² → 2
        obj("stretch-tent", 15, 10), // 150 m² → 4
        obj("shade", 8, 5), // 40 m² → 2
        obj("kitchen", 6, 4), // not a structure
        obj("generator", 2, 1.5), // 1 × 1.5 kg
        obj("tent-2p", 2, 2), // a private tent: not counted (open point 1)
      ]),
      LAYOUT_CATALOG_2027,
    );
    expect(e.units).toBe(8);
    expect(e.generatorUnits).toBe(1);
    expect(e.structures).toBe(3);
    expect(e.generators).toBe(1);
    expect(e.rows.map((r) => [r.name, r.units, r.generatorUnits])).toEqual([
      ["Bedouin tent", 2, 0],
      ["Stretch tent 1", 4, 0],
      ["Shade 1", 2, 0],
      ["Generator 1", 0, 1],
    ]);
    expect(describeExtinguishers(e)).toBe(
      "8 × 4.5 kg DCP and 1 × 1.5 kg by the generator",
    );
  });

  it("counts a dome by its round footprint and gazebos per structure", () => {
    // Dome Ø 12 m ≈ 113 m² → 4; two 3 × 3 gazebos → 2 each, never pooled.
    const e = extinguisherEstimate(
      doc([obj("dome", 12, 12), obj("gazebo", 3, 3), obj("gazebo", 3, 3)]),
      LAYOUT_CATALOG_2027,
    );
    expect(e.rows.map((r) => r.units)).toEqual([4, 2, 2]);
    expect(e.units).toBe(8);
    expect(e.rows.map((r) => r.name)).toEqual(["Dome 1", "Gazebo 1", "Gazebo 2"]);
  });

  it("is zero for a layout with no structures or generators", () => {
    const e = extinguisherEstimate(doc([obj("kitchen", 6, 4)]), LAYOUT_CATALOG_2027);
    expect(e).toMatchObject({ units: 0, generatorUnits: 0, rows: [] });
    expect(describeExtinguishers(e)).toBe("0 × 4.5 kg DCP");
  });

  it("ignores keys this edition does not offer", () => {
    const e = extinguisherEstimate(doc([obj("bonfire", 10, 10)]), LAYOUT_CATALOG_2027);
    expect(e.rows).toEqual([]);
  });

  it("never mentions sand", () => {
    const e = extinguisherEstimate(
      doc([obj("bedouin", 12, 8), obj("generator", 2, 1.5)]),
      LAYOUT_CATALOG_2027,
    );
    expect(JSON.stringify(e).toLowerCase()).not.toContain("sand");
    expect(describeExtinguishers(e).toLowerCase()).not.toContain("sand");
  });
});

describe("the section 4 gates", () => {
  const gates = {
    s4HasGenerator: true,
    s4HasFire: true,
    s4FireKinds: ["braai_brazier"],
    s4HasGasOrFuel: false,
  };

  it("needs G1–G3 answered, and a fire kind when G2 is yes", () => {
    expect(safetyGatesComplete(gates)).toBe(true);
    expect(safetyGatesComplete({ ...gates, s4HasGenerator: null })).toBe(false);
    expect(safetyGatesComplete({ ...gates, s4HasFire: null })).toBe(false);
    expect(safetyGatesComplete({ ...gates, s4HasGasOrFuel: null })).toBe(false);
    expect(safetyGatesComplete({ ...gates, s4FireKinds: [] })).toBe(false);
    expect(safetyGatesComplete({ ...gates, s4FireKinds: ["bonfire"] })).toBe(false);
    // No fire: no kinds needed. "No" is an answer.
    expect(
      safetyGatesComplete({ ...gates, s4HasFire: false, s4FireKinds: [] }),
    ).toBe(true);
    expect(
      safetyGatesComplete({
        s4HasGenerator: false,
        s4HasFire: false,
        s4FireKinds: null,
        s4HasGasOrFuel: false,
      }),
    ).toBe(true);
  });

  it("size_logistics requires the gates", () => {
    const rest = {
      s4ExpectedPopulation: 45,
      s4FirstArrivalDate: "2027-04-24",
      s4AreaDimensions: "30m x 25m",
    };
    expect(isSectionComplete("size_logistics", { ...rest, ...gates })).toBe(true);
    expect(isSectionComplete("size_logistics", rest)).toBe(false);
    expect(
      isSectionComplete("size_logistics", { ...rest, ...gates, s4FireKinds: [] }),
    ).toBe(false);
  });

  it("G2 = No clears the kinds; unknown kinds are dropped", () => {
    expect(normalizeFireAnswer(false, ["fire_pit"])).toEqual([]);
    expect(normalizeFireAnswer(null, ["fire_pit"])).toEqual([]);
    expect(normalizeFireAnswer(true, ["other", "bonfire", "fire_pit"])).toEqual([
      "fire_pit",
      "other",
    ]);
    expect(cleanFireKinds([...FIRE_KINDS, "x"])).toEqual([...FIRE_KINDS]);
  });

  it("the layout suggests Yes, never No", () => {
    const s = suggestGatesFromLayout(
      doc([obj("generator", 2, 1.5), obj("fire-pit", 3, 3)]),
    );
    expect(s).toEqual({
      generator: true,
      fire: true,
      fireKinds: ["fire_pit"],
      gas: false,
    });
    expect(suggestGatesFromLayout(doc([obj("gas-storage", 2, 2)])).gas).toBe(true);
    expect(suggestGatesFromLayout(null)).toEqual({
      generator: false,
      fire: false,
      fireKinds: [],
      gas: false,
    });
  });

  it("a suggestion fills only an unsaved gate; a saved No is never touched", () => {
    const s = suggestGatesFromLayout(
      doc([obj("generator", 2, 1.5), obj("fire-pit", 3, 3), obj("gas-storage", 2, 2)]),
    );
    const unsaved = {
      s4HasGenerator: null,
      s4HasFire: null,
      s4FireKinds: null,
      s4HasGasOrFuel: null,
    };
    expect(adoptGateSuggestions(unsaved, s)).toEqual({
      s4HasGenerator: true,
      s4HasFire: true,
      s4FireKinds: ["fire_pit"],
      s4HasGasOrFuel: true,
    });
    const saidNo = {
      s4HasGenerator: false,
      s4HasFire: false,
      s4FireKinds: [],
      s4HasGasOrFuel: false,
    };
    expect(adoptGateSuggestions(saidNo, s)).toEqual(saidNo);
    // Nothing drawn: nothing suggested, the gates stay unanswered.
    expect(adoptGateSuggestions(unsaved, suggestGatesFromLayout(null))).toEqual(
      unsaved,
    );
  });
});

describe("the gas & fuel record", () => {
  it("validates its shape", () => {
    expect(GasFuelRecordSchema.safeParse(emptyGasFuelRecord()).success).toBe(true);
    expect(
      GasFuelRecordSchema.safeParse({ ...emptyGasFuelRecord(), jerryCans20l: -1 })
        .success,
    ).toBe(false);
    expect(
      GasFuelRecordSchema.safeParse({ ...emptyGasFuelRecord(), note: "x".repeat(501) })
        .success,
    ).toBe(false);
    expect(
      GasFuelRecordSchema.safeParse({ ...emptyGasFuelRecord(), extra: 1 }).success,
    ).toBe(false);
  });

  it("totals the gas", () => {
    expect(gasTotalKg(record({ lpg: [{ sizeKg: 48, count: 2 }] }))).toBe(96);
    expect(
      gasTotalKg(
        record({
          lpg: [
            { sizeKg: 9, count: 3 },
            { sizeKg: 19, count: 1 },
          ],
        }),
      ),
    ).toBe(46);
  });

  describe("fuelDepotAdvice — the thresholds", () => {
    it("gas over 90 kg", () => {
      expect(fuelDepotAdvice(record({ lpg: [{ sizeKg: 9, count: 10 }] }))).toBe(false); // 90
      expect(fuelDepotAdvice(record({ lpg: [{ sizeKg: 48, count: 2 }] }))).toBe(true); // 96
    });
    it("more than 2 × 20 L jerry cans", () => {
      expect(fuelDepotAdvice(record({ jerryCans20l: 2 }))).toBe(false);
      expect(fuelDepotAdvice(record({ jerryCans20l: 3 }))).toBe(true);
    });
    it("any 200 L barrel or fuel trailer", () => {
      expect(fuelDepotAdvice(record({ barrels200l: 1 }))).toBe(true);
      expect(fuelDepotAdvice(record({ fuelTrailers: 1 }))).toBe(true);
    });
    it("an empty record is within the limits", () => {
      expect(fuelDepotAdvice(emptyGasFuelRecord())).toBe(false);
      expect(fuelDepotReasons(emptyGasFuelRecord())).toEqual([]);
    });
    it("says why", () => {
      expect(
        fuelDepotReasons(record({ lpg: [{ sizeKg: 48, count: 2 }], barrels200l: 1 })),
      ).toEqual([
        "96 kg of gas is over 90 kg",
        "a 200 L barrel always goes to the depot",
      ]);
    });
  });

  it("describes itself without the note", () => {
    expect(
      describeGasFuelRecord(
        record({
          lpg: [{ sizeKg: 48, count: 2 }],
          jerryCans20l: 2,
          barrels200l: 1,
          note: "secret",
        }),
      ),
    ).toBe(
      "2 × 48 kg gas (96 kg) · 2 × 20 L jerry cans · 1 × 200 L barrel · no fuel trailers",
    );
  });

  it("drops empty bottle rows and trims the note on save", () => {
    expect(
      tidyGasFuelRecord(
        record({
          lpg: [
            { sizeKg: 48, count: 0 },
            { sizeKg: 9, count: 2 },
          ],
          note: "  hi  ",
        }),
      ),
    ).toEqual(record({ lpg: [{ sizeKg: 9, count: 2 }], note: "hi" }));
  });

  describe("who", () => {
    const lead = { structuralRole: "lead" as const, rolePermissions: [] };
    const admin = { structuralRole: "admin" as const, rolePermissions: [] };
    const member = { structuralRole: "member" as const, rolePermissions: [] };
    const planner = {
      structuralRole: "member" as const,
      rolePermissions: [{ manage_layout: true }],
    };

    it("leads, co-leads and layout planners edit; every member reads", () => {
      expect(canEditGasFuelRecord(lead)).toBe(true);
      expect(canEditGasFuelRecord(admin)).toBe(true);
      expect(canEditGasFuelRecord(planner)).toBe(true);
      expect(canEditGasFuelRecord(member)).toBe(false);
      expect(canEditGasFuelRecord(null)).toBe(false);
      expect(canViewGasFuelRecord(member)).toBe(true);
      expect(canViewGasFuelRecord(null)).toBe(false);
    });

    it("refuses a save from a reader or without a registration", () => {
      expect(decideGasFuelSave({ canEdit: false, hasRegistration: true })).toBe(
        "not_editor",
      );
      expect(decideGasFuelSave({ canEdit: true, hasRegistration: false })).toBe(
        "no_registration",
      );
      expect(decideGasFuelSave({ canEdit: true, hasRegistration: true })).toBeNull();
    });
  });

  describe("carry-forward — a draft, never automatic", () => {
    it("offers last year only to an editor with no record and a source", () => {
      expect(
        shouldOfferGasFuelCarryForward({ canEdit: true, hasRecord: false, hasSource: true }),
      ).toBe(true);
      expect(
        shouldOfferGasFuelCarryForward({ canEdit: false, hasRecord: false, hasSource: true }),
      ).toBe(false);
      expect(
        shouldOfferGasFuelCarryForward({ canEdit: true, hasRecord: true, hasSource: true }),
      ).toBe(false);
      expect(
        shouldOfferGasFuelCarryForward({ canEdit: true, hasRecord: false, hasSource: false }),
      ).toBe(false);
    });

    it("never copies over an existing record", () => {
      const ok = { canEdit: true, hasRegistration: true, hasRecord: false, hasSource: true };
      expect(decideStartGasFuelFromLastYear(ok)).toBeNull();
      expect(decideStartGasFuelFromLastYear({ ...ok, hasRecord: true })).toBe(
        "record_exists",
      );
      expect(decideStartGasFuelFromLastYear({ ...ok, hasSource: false })).toBe(
        "no_source",
      );
      expect(decideStartGasFuelFromLastYear({ ...ok, canEdit: false })).toBe(
        "not_editor",
      );
    });

    it("copies the data only, as a fresh object", () => {
      const prior = record({ lpg: [{ sizeKg: 48, count: 2 }], barrels200l: 1, note: "n" });
      const copy = copyGasFuelRecordForNewEdition(prior);
      expect(copy).toEqual(prior);
      expect(copy.lpg).not.toBe(prior.lpg);
    });
  });
});

describe("decideFuelDepotNotice — edge-triggered", () => {
  const T = new Date("2027-01-14T10:00:00Z");
  const base = {
    isDraft: false,
    advice: true,
    campNotifiedAt: null,
    wranglerNotifiedAt: null,
    wranglerAssigned: false,
  };

  it("false → true sends the camp copy and stamps it", () => {
    expect(decideFuelDepotNotice(base)).toEqual({
      sendCamp: true,
      sendWrangler: false,
      campNotifiedAt: "set",
      wranglerNotifiedAt: "keep",
    });
  });

  it("sends the wrangler copy on the same save when one is assigned", () => {
    expect(decideFuelDepotNotice({ ...base, wranglerAssigned: true })).toEqual({
      sendCamp: true,
      sendWrangler: true,
      campNotifiedAt: "set",
      wranglerNotifiedAt: "set",
    });
  });

  it("a second save over the limit sends nothing", () => {
    expect(
      decideFuelDepotNotice({
        ...base,
        campNotifiedAt: T,
        wranglerNotifiedAt: T,
        wranglerAssigned: true,
      }),
    ).toEqual({
      sendCamp: false,
      sendWrangler: false,
      campNotifiedAt: "keep",
      wranglerNotifiedAt: "keep",
    });
  });

  it("turning false clears both, so a later true sends again", () => {
    expect(
      decideFuelDepotNotice({
        ...base,
        advice: false,
        campNotifiedAt: T,
        wranglerNotifiedAt: T,
      }),
    ).toMatchObject({
      sendCamp: false,
      sendWrangler: false,
      campNotifiedAt: "clear",
      wranglerNotifiedAt: "clear",
    });
  });

  it("a draft never sends and never touches the columns", () => {
    expect(decideFuelDepotNotice({ ...base, isDraft: true, wranglerAssigned: true })).toEqual({
      sendCamp: false,
      sendWrangler: false,
      campNotifiedAt: "keep",
      wranglerNotifiedAt: "keep",
    });
  });

  it("within limits with nothing stamped is a no-op", () => {
    expect(decideFuelDepotNotice({ ...base, advice: false })).toEqual({
      sendCamp: false,
      sendWrangler: false,
      campNotifiedAt: "keep",
      wranglerNotifiedAt: "keep",
    });
  });
});

describe("shouldSendDeferredWranglerCopy — on wrangler assignment", () => {
  const saved = { isDraft: false, advice: true, wranglerNotifiedAt: null };
  it("sends when a saved record is over and the wrangler was never told", () => {
    expect(shouldSendDeferredWranglerCopy({ record: saved, wranglerChanged: false })).toBe(true);
  });
  it("a reassignment tells the new wrangler too", () => {
    expect(
      shouldSendDeferredWranglerCopy({
        record: { ...saved, wranglerNotifiedAt: new Date() },
        wranglerChanged: true,
      }),
    ).toBe(true);
    expect(
      shouldSendDeferredWranglerCopy({
        record: { ...saved, wranglerNotifiedAt: new Date() },
        wranglerChanged: false,
      }),
    ).toBe(false);
  });
  it("never for a draft, a record within limits, or no record", () => {
    expect(
      shouldSendDeferredWranglerCopy({ record: { ...saved, isDraft: true }, wranglerChanged: true }),
    ).toBe(false);
    expect(
      shouldSendDeferredWranglerCopy({ record: { ...saved, advice: false }, wranglerChanged: true }),
    ).toBe(false);
    expect(shouldSendDeferredWranglerCopy({ record: null, wranglerChanged: true })).toBe(false);
  });
});

describe("fuelDepotNotification", () => {
  const input = {
    campName: "Karoo Kombuis",
    campSlug: "karoo-kombuis",
    registrationId: "11111111-1111-4111-8111-111111111111",
  };

  it("camp copy, no wrangler yet", () => {
    const n = fuelDepotNotification({ ...input, side: "camp", wranglerName: null });
    expect(n).toEqual({
      kind: "wrangler",
      title:
        "Your gas and fuel go to the fuel depot — your wrangler will be told when one is assigned",
      body: null,
      link: "/camps/karoo-kombuis/gas-fuel",
      linkApp: "web",
    });
  });

  it("camp copy with a wrangler", () => {
    expect(
      fuelDepotNotification({ ...input, side: "camp", wranglerName: "Jabu" }).title,
    ).toBe(
      "Your gas and fuel go to the fuel depot — talk to your wrangler about how it works",
    );
  });

  it("wrangler copy links into the console", () => {
    const n = fuelDepotNotification({ ...input, side: "wrangler" });
    expect(n.title).toBe(
      "Karoo Kombuis is over the fuel depot limit — talk to them about how the fuel depot works",
    );
    expect(n.link).toBe(`/registrations/${input.registrationId}`);
    expect(n.linkApp).toBe("org");
  });

  it("carries no amounts", () => {
    for (const side of ["camp", "wrangler"] as const) {
      const n = fuelDepotNotification({ ...input, side, wranglerName: "Jabu" });
      expect(`${n.title} ${n.body ?? ""}`).not.toMatch(/\d/);
    }
  });
});

describe("SAFETY_POLICY_LINKS", () => {
  it("are absolute https links", () => {
    for (const l of Object.values(SAFETY_POLICY_LINKS)) {
      expect(l.href.startsWith("https://")).toBe(true);
    }
  });
});
