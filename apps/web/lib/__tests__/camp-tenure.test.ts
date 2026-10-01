import { describe, it, expect, beforeEach, vi } from "vitest";
import { dbMock } from "@/test/db-mock";

// CAMP TENURE LOADER (epic #54). The rule itself is @quagga/core
// `classifyCampTenure` (tested there); this pins what the loader FEEDS it:
// only camp-held facts (membership start, logistics years), keyed by
// membership, and nothing at all for an unknown edition or an empty camp.

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

const { loadCampTenure } = await import("../camp-tenure");

const EDITIONS = [
  { year: 2026, endDate: "2026-05-04" },
  { year: 2027, endDate: "2027-05-02" },
];

beforeEach(() => dbMock.reset());

describe("loadCampTenure", () => {
  it("returns nothing, and stops, for an edition that doesn't exist", async () => {
    dbMock.queue([]);
    expect((await loadCampTenure("camp", "nope")).size).toBe(0);
    expect(dbMock.queries).toHaveLength(1);
  });

  it("returns nothing for a camp with no current members, without a logistics read", async () => {
    dbMock.queue([{ year: 2027 }], EDITIONS, []);
    expect((await loadCampTenure("camp", "ed-2027")).size).toBe(0);
    expect(dbMock.queries).toHaveLength(3);
  });

  it("sorts each member by the camp's own records", async () => {
    dbMock.queue(
      [{ year: 2027 }],
      EDITIONS,
      [
        // Joined during 2026's event: returning.
        { membershipId: "m-old", createdAt: new Date("2026-04-30T10:00:00Z") },
        // Joined after 2026 ended, no earlier logistics: new.
        { membershipId: "m-new", createdAt: new Date("2026-11-01T10:00:00Z") },
        // Joined late, but the camp holds 2026 logistics for them: returning.
        { membershipId: "m-log", createdAt: new Date("2027-01-10T10:00:00Z") },
      ],
      [
        { membershipId: "m-log", year: 2026 },
        // This edition's logistics never make anyone "returning".
        { membershipId: "m-new", year: 2027 },
      ],
    );
    const out = await loadCampTenure("camp", "ed-2027");
    expect(Object.fromEntries(out)).toEqual({
      "m-old": "returning",
      "m-new": "new",
      "m-log": "returning",
    });
    expect(dbMock.pending).toBe(0);
  });
});
