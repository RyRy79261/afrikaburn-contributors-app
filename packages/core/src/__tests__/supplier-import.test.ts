import { describe, it, expect } from "vitest";
import {
  parseCsv,
  parseSuppliersCsv,
  mapStatusToStanding,
  mapReturning,
  normalizeCategory,
  feePhraseToStepKey,
} from "../supplier-import";
import { AB_SUPPLIERS_SAMPLE_CSV as fixtureCsv } from "../__fixtures__/ab-suppliers-sample";

describe("parseCsv", () => {
  it("splits quoted fields, unescapes doubled quotes, and folds embedded newlines", () => {
    const rows = parseCsv('"a","b""c","multi\nline"\n"d","e",""\n');
    expect(rows).toEqual([
      ["a", 'b"c', "multi\nline"],
      ["d", "e", ""],
    ]);
  });

  it("handles a trailing row with no final newline", () => {
    expect(parseCsv('"x","y"')).toEqual([["x", "y"]]);
  });
});

describe("field mappers (real sheet vocabulary)", () => {
  it("maps the Status column to standing (blank → good)", () => {
    expect(mapStatusToStanding("In Good Standing")).toBe("good");
    expect(mapStatusToStanding("Diligent First Timer")).toBe(
      "diligent_first_timer",
    );
    expect(mapStatusToStanding("Able & Willing To Adapt")).toBe("adapting");
    expect(mapStatusToStanding("Absolute Beginners")).toBe("absolute_beginner");
    expect(mapStatusToStanding("")).toBe("good");
    expect(mapStatusToStanding("something else")).toBe("good");
  });

  it("maps the Returning Supplier? column (blank → null)", () => {
    expect(mapReturning("Yes")).toBe("returning");
    expect(mapReturning("Newbie")).toBe("newbie");
    expect(mapReturning("")).toBeNull();
  });

  it("normalises categories: Transportation→Transport, FIREWOOD DELIVERY→Firewood Delivery, title-case", () => {
    expect(normalizeCategory("Transportation")).toBe("Transport");
    expect(normalizeCategory("Transport ")).toBe("Transport");
    expect(normalizeCategory("FIREWOOD DELIVERY")).toBe("Firewood Delivery");
    expect(normalizeCategory("Stretch Tents")).toBe("Stretch Tents");
    expect(normalizeCategory("Generators/Power Supply")).toBe(
      "Generators/Power Supply",
    );
    expect(normalizeCategory("Sound & Lighting")).toBe("Sound & Lighting");
    expect(normalizeCategory("")).toBe("");
  });

  it("maps the fees/crew-pass progress phrases to onboarding steps", () => {
    expect(feePhraseToStepKey("Refundable deposit paid")).toBe("deposit_paid");
    expect(feePhraseToStepKey("Supplier contract signed")).toBe(
      "agreement_signed",
    );
    expect(feePhraseToStepKey("Inventory log submitted")).toBe(
      "inventory_submitted",
    );
    expect(feePhraseToStepKey("Crew passes purchased")).toBe(
      "crew_details_submitted",
    );
    expect(feePhraseToStepKey("Supplier Registration Fee paid")).toBe(
      "registration_fee_paid",
    );
    expect(feePhraseToStepKey("Some other phrase")).toBeNull();
  });
});

describe("parseSuppliersCsv v2 (real AB Suppliers List sample)", () => {
  const rows = parseSuppliersCsv(fixtureCsv);

  it("recovers one row per supplier block, not per physical CSV line", () => {
    // The fixture has 20 supplier blocks (verified against the raw sheet).
    expect(rows.length).toBe(20);
  });

  it("parses a fully-populated block: name, normalised category, business contact, standing, returning", () => {
    const dimensions = rows.find(
      (r) => r.name === "Dimensions Bedouin Stretch Tent Hire (Pty) Ltd",
    );
    expect(dimensions).toBeDefined();
    expect(dimensions?.category).toBe("Stretch Tents");
    expect(dimensions?.contact).toContain("Heather Dreyer");
    expect(dimensions?.contact).toContain("heather@dimensionstents.com");
    expect(dimensions?.standing).toBe("good");
    expect(dimensions?.returning).toBe("returning");
  });

  it("maps the Status column into standing (real values present in the sheet)", () => {
    const dayStar = rows.find((r) => r.name === "Day Star stretch tents");
    expect(dayStar?.standing).toBe("adapting");
    const poswa = rows.find((r) => r.name === "Poswa Logistics and Services");
    expect(poswa?.standing).toBe("diligent_first_timer");
    expect(poswa?.returning).toBe("newbie");
    expect(poswa?.category).toBe("Transport");
  });

  it("pre-populates onboarding steps from the fees phrases marked TRUE", () => {
    const deharn = rows.find((r) => r.name === "Deharn Stretch Tents");
    // deposit + contract + crew passes marked TRUE; inventory + reg fee FALSE.
    expect(deharn?.onboarding).toEqual({
      deposit_paid: "completed",
      agreement_signed: "completed",
      crew_details_submitted: "completed",
    });
    // A block with no fees rows at all yields an empty onboarding map.
    const tentex = rows.find((r) => r.name === "Tentex Stretch Tents");
    expect(tentex?.onboarding).toEqual({});
  });

  it("folds multiple categories into one normalised chip", () => {
    const godfrey = rows.find((r) => r.name === "Godfrey Family Farms");
    expect(godfrey?.category).toBe("Firewood Delivery / Transport");
    const aurras = rows.find((r) => r.name === "Aurras Group (Pty) Ltd");
    expect(aurras?.category).toBe("Sound & Lighting / Generators/Power Supply");
  });

  it("NEVER retains a phone number or postal address in the contact field", () => {
    for (const row of rows) {
      // No run of 7+ digits (a phone number, with or without punctuation).
      expect(row.contact).not.toMatch(/\d[\d\s().+-]{6,}\d/);
      // The multi-line farm postal address from the Chariots Transport block.
      expect(row.contact).not.toMatch(/Tankwa Rural/i);
    }
  });

  it("folds a note-column aside into services (e.g. Chariots Transport)", () => {
    const chariots = rows.find((r) => r.name === "Chariots Transport");
    expect(chariots?.services).toMatch(/Mutant vehicles/);
    expect(chariots?.services).toMatch(/Containers/);
  });

  it("every row satisfies the SupplierImportRow v2 shape", () => {
    for (const row of rows) {
      expect(row.name.length).toBeGreaterThan(0);
      expect(typeof row.services).toBe("string");
      expect(typeof row.contact).toBe("string");
      expect(typeof row.category).toBe("string");
      expect(row.website).toBe("");
      expect([
        "good",
        "watch",
        "suspended",
        "diligent_first_timer",
        "adapting",
        "absolute_beginner",
      ]).toContain(row.standing);
      expect(
        row.returning === null ||
          row.returning === "returning" ||
          row.returning === "newbie",
      ).toBe(true);
      expect(typeof row.onboarding).toBe("object");
    }
  });
});
