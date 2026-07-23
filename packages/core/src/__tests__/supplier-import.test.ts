import { describe, it, expect } from "vitest";
import { parseCsv, parseSuppliersCsv } from "../supplier-import";
import { AB_SUPPLIERS_SAMPLE_CSV as fixtureCsv } from "../__fixtures__/ab-suppliers-sample";

describe("parseCsv", () => {
  it("splits quoted fields, unescapes doubled quotes, and folds embedded newlines", () => {
    const rows = parseCsv(
      '"a","b""c","multi\nline"\n"d","e",""\n',
    );
    expect(rows).toEqual([
      ["a", 'b"c', "multi\nline"],
      ["d", "e", ""],
    ]);
  });

  it("handles a trailing row with no final newline", () => {
    expect(parseCsv('"x","y"')).toEqual([["x", "y"]]);
  });
});

describe("parseSuppliersCsv (real AB Suppliers List sample)", () => {
  const rows = parseSuppliersCsv(fixtureCsv);

  it("recovers one row per supplier block, not per physical CSV line", () => {
    // The fixture has 20 supplier blocks (verified against the raw sheet).
    expect(rows.length).toBe(20);
  });

  it("parses a fully-populated block: name, category, business contact, vetting status", () => {
    const dimensions = rows.find((r) => r.name === "Dimensions Bedouin Stretch Tent Hire (Pty) Ltd");
    expect(dimensions).toBeDefined();
    expect(dimensions?.services).toContain("Stretch Tents");
    expect(dimensions?.contact).toContain("Heather Dreyer");
    expect(dimensions?.contact).toContain("heather@dimensionstents.com");
    expect(dimensions?.vettingStatus).toBe("registered"); // "In Good Standing"
  });

  it("maps a blank Status cell to listed", () => {
    const bedouinMasterz = rows.find((r) => r.name === "BedouinTent Masterz");
    expect(bedouinMasterz?.vettingStatus).toBe("listed");
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

  it("every row satisfies the SupplierImportRow shape (name required, rest defaulted)", () => {
    for (const row of rows) {
      expect(row.name.length).toBeGreaterThan(0);
      expect(typeof row.services).toBe("string");
      expect(typeof row.contact).toBe("string");
      expect(row.website).toBe("");
      expect(["listed", "registered", "flagged"]).toContain(row.vettingStatus);
    }
  });
});
