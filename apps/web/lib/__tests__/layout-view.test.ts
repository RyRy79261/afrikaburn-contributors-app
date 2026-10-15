import { describe, expect, it } from "vitest";
import { createEmptyLayoutDocument } from "@quagga/core";
import {
  insideText,
  lastEditedLine,
  lastEditedPhrase,
  layoutDayLabel,
  layoutPath,
  layoutPrintPath,
  layoutTileLine,
  layoutTileView,
  layoutWhen,
  objectCountText,
  parseAreaParam,
  plotDimsText,
} from "../layout-view";

// The read-only layout's copy (frame L3 QZeG7 / t7aOZ3). Times are South
// African, whatever the server's zone: 12:32 UTC is 14:32 in Johannesburg.

const NOW = new Date("2027-03-04T12:32:00Z"); // 4 Mar 2027, 14:32 SAST
const UUID = "00000000-0000-4000-8000-000000000001";

describe("when a layout was last edited", () => {
  it("today, yesterday, or the date", () => {
    expect(layoutWhen(new Date("2027-03-04T12:32:00Z"), NOW)).toBe(
      "today, 14:32",
    );
    expect(layoutWhen(new Date("2027-03-03T07:05:00Z"), NOW)).toBe(
      "yesterday, 09:05",
    );
    expect(layoutWhen(new Date("2027-03-02T08:05:00Z"), NOW)).toBe(
      "2 Mar 2027, 10:05",
    );
  });

  it("decides the day in South African time, not UTC", () => {
    // 23:30 UTC on 3 Mar is 01:30 on 4 Mar in Johannesburg: today.
    expect(layoutWhen(new Date("2027-03-03T23:30:00Z"), NOW)).toBe(
      "today, 01:30",
    );
    // 21:30 UTC on 3 Mar is 23:30 on 3 Mar there: yesterday.
    expect(layoutWhen(new Date("2027-03-03T21:30:00Z"), NOW)).toBe(
      "yesterday, 23:30",
    );
  });

  it("names who edited it, and leaves a gone account out", () => {
    const at = new Date("2027-03-04T12:32:00Z");
    expect(lastEditedLine(at, "Alice Hatter", NOW)).toBe(
      "Last edited today, 14:32, by Alice Hatter",
    );
    expect(lastEditedPhrase(at, null, NOW)).toBe("last edited today, 14:32");
  });

  it("writes a day as the frames do", () => {
    expect(layoutDayLabel(new Date("2027-03-02T08:05:00Z"))).toBe("2 Mar 2027");
  });
});

describe("the tile's line", () => {
  it("plot size, count and last edit", () => {
    expect(
      layoutTileLine(
        { width: 40, depth: 30, objectCount: 13 },
        new Date("2027-03-04T12:32:00Z"),
        "Alice Hatter",
        NOW,
      ),
    ).toBe(
      "Plot 40 m × 30 m · 13 objects · last edited today, 14:32, by Alice Hatter",
    );
  });

  it("trims sizes to a tenth and counts one object as one", () => {
    expect(plotDimsText({ width: 12.25, depth: 8 })).toBe("12.3 m × 8 m");
    expect(objectCountText(1)).toBe("1 object");
    expect(objectCountText(0)).toBe("0 objects");
  });
});

describe("what is under a shade structure", () => {
  it("says tents when everything under it is a tent", () => {
    expect(insideText(7, 7)).toBe("7 tents inside");
    expect(insideText(1, 1)).toBe("1 tent inside");
    expect(insideText(3, 2)).toBe("3 things inside");
    expect(insideText(1, 0)).toBe("1 thing inside");
    expect(insideText(0, 0)).toBe("0 things inside");
  });
});

describe("?area=", () => {
  it("accepts one uuid and nothing else", () => {
    expect(parseAreaParam(UUID)).toBe(UUID);
    expect(parseAreaParam(undefined)).toBeNull();
    expect(parseAreaParam([UUID, UUID])).toBeNull();
    expect(parseAreaParam("bedouin-1")).toBeNull();
    expect(parseAreaParam(`${UUID}' or 1=1`)).toBeNull();
  });

  it("builds the page's links", () => {
    expect(layoutPath("mad-hatters")).toBe("/camps/mad-hatters/layout");
    expect(layoutPath("mad-hatters", UUID)).toBe(
      `/camps/mad-hatters/layout?area=${UUID}`,
    );
    expect(layoutPath("mad-hatters", null)).toBe("/camps/mad-hatters/layout");
    expect(layoutPrintPath("mad-hatters")).toBe(
      "/camps/mad-hatters/layout/print",
    );
  });
});

describe("the camp tile's state", () => {
  const doc = createEmptyLayoutDocument(40, 30);
  const layout = {
    document: doc,
    updatedAt: NOW,
    updatedByName: "Alice Hatter",
  };
  const summary = { width: 40, depth: 30, objectCount: 0 };

  it("needs a registration before anything else", () => {
    expect(
      layoutTileView({ registration: null, layout: null, summary: null }),
    ).toEqual({ kind: "no_registration" });
  });

  it("is not drawn while the registration has no layout", () => {
    expect(
      layoutTileView({ registration: { id: "r" }, layout: null, summary: null }),
    ).toEqual({ kind: "not_drawn" });
  });

  it("carries the plan when there is one", () => {
    expect(
      layoutTileView({ registration: { id: "r" }, layout, summary }),
    ).toEqual({
      kind: "drawn",
      document: doc,
      summary,
      updatedAt: NOW,
      updatedByName: "Alice Hatter",
    });
  });
});
