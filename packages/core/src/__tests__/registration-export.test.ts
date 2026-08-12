import { describe, it, expect } from "vitest";

import {
  buildPlacementCsv,
  escapeCsvField,
  placementCsvFilename,
  PLACEMENT_EXPORT_HEADERS,
  type PlacementExportRow,
} from "../registration-export";

function row(overrides: Partial<PlacementExportRow> = {}): PlacementExportRow {
  return {
    campName: "Mad Hatters",
    campCode: "MAH",
    erf: "K12",
    status: "approved",
    categories: ["Tea", "Workshops"],
    contactEmail: "leads@madhatters.example",
    expectedPopulation: 42,
    areaDimensions: "30m x 20m",
    workAccessPasses: 6,
    firstArrivalDate: "2027-04-20",
    amplifiedMusic: "Small rig — background only",
    placementFirstChoice: "Mid-city (3ish–9ish roads)",
    placementSecondChoice: "Outer roads (back of the city)",
    neighbourRequest: "Next to Dusty Prototype please.",
    familyFriendly: "Yes",
    wranglerName: "Sipho",
    submittedAt: new Date("2026-09-14T08:30:00.000Z"),
    ...overrides,
  };
}

describe("escapeCsvField", () => {
  it("passes plain text through", () => {
    expect(escapeCsvField("Mad Hatters")).toBe("Mad Hatters");
  });

  it("quotes and doubles embedded quotes", () => {
    expect(escapeCsvField('The "Big" Top')).toBe('"The ""Big"" Top"');
  });

  it("quotes fields containing commas or newlines", () => {
    expect(escapeCsvField("Tea, cake")).toBe('"Tea, cake"');
    expect(escapeCsvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("renders empties as empty and booleans as words", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
    expect(escapeCsvField(true)).toBe("Yes");
    expect(escapeCsvField(false)).toBe("No");
  });

  it("neutralises spreadsheet formula injection", () => {
    // A camp may name itself anything. Excel must not execute it. No quoting
    // here — an apostrophe is not a CSV special character, so the guard prefix
    // is the whole of the change.
    expect(escapeCsvField("=cmd|' /c calc'!A0")).toBe("'=cmd|' /c calc'!A0");
    expect(escapeCsvField("+1234")).toBe("'+1234");
    expect(escapeCsvField("-1234")).toBe("'-1234");
    expect(escapeCsvField("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("still quotes a guarded field that also contains a comma", () => {
    expect(escapeCsvField("=SUM(A1,B2)")).toBe(`"'=SUM(A1,B2)"`);
  });

  it("leaves ordinary leading characters alone", () => {
    expect(escapeCsvField("2027 camp")).toBe("2027 camp");
  });
});

describe("buildPlacementCsv", () => {
  it("starts with a BOM and the header row", () => {
    const csv = buildPlacementCsv([]);
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv.slice(1).split("\r\n")[0]).toBe(
      PLACEMENT_EXPORT_HEADERS.join(","),
    );
  });

  it("writes one line per camp, CRLF terminated", () => {
    const csv = buildPlacementCsv([row(), row({ campName: "Dusty Prototype" })]);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines).toHaveLength(3); // header + 2
    expect(lines[1]).toContain("Mad Hatters");
    expect(lines[2]).toContain("Dusty Prototype");
  });

  it("formats dates as plain ISO days", () => {
    const csv = buildPlacementCsv([row()]);
    expect(csv).toContain("2026-09-14");
    expect(csv).not.toContain("T08:30");
  });

  it("joins categories with a semicolon so the comma stays the delimiter", () => {
    const csv = buildPlacementCsv([row()]);
    expect(csv).toContain("Tea; Workshops");
  });

  it("never emits a hard-locked personal field", () => {
    // The export is mailed around and left in downloads folders. The guard is
    // structural — there is no column for any of these — and this test is what
    // keeps it that way.
    const forbidden = [
      "phone",
      "id number",
      "passport",
      "emergency",
      "medical",
    ];
    const headers = PLACEMENT_EXPORT_HEADERS.join(" ").toLowerCase();
    for (const term of forbidden) {
      expect(headers).not.toContain(term);
    }
  });

  it("handles a wholly unassigned camp without producing 'null'", () => {
    const csv = buildPlacementCsv([
      row({
        campCode: null,
        erf: null,
        wranglerName: null,
        submittedAt: null,
        categories: null,
        expectedPopulation: null,
      }),
    ]);
    expect(csv).not.toContain("null");
    expect(csv).not.toContain("undefined");
  });
});

describe("placementCsvFilename", () => {
  it("names the file for the edition and the day it was pulled", () => {
    expect(placementCsvFilename(2027, new Date("2026-08-12T10:00:00Z"))).toBe(
      "afrikaburn-2027-placement-2026-08-12.csv",
    );
  });
});
