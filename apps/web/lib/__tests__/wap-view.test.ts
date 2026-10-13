import { describe, expect, it } from "vitest";
import { WapRequestStatus } from "@quagga/types";
import {
  wapDayLabel,
  wapLeftToHandOut,
  wapProjectNoun,
  wapRequestLine,
  wapRequestTitle,
} from "../wap-view";

// The Passes page's wording (canvas W1). Labels are generic — "the camp",
// "the project" — never a camp's name.

const asked = new Date("2027-03-02T10:00:00Z");
const decided = new Date("2027-03-04T10:00:00Z");
const base = {
  requested: 10,
  reason: null,
  status: WapRequestStatus.enum.granted,
  granted: 10,
  requestedByName: "Alice Hatter",
  createdAt: asked,
  decidedAt: decided,
};

describe("wap-view", () => {
  it("says camp for a theme camp and project for the rest", () => {
    expect(wapProjectNoun("theme_camp")).toBe("camp");
    expect(wapProjectNoun("artwork")).toBe("project");
    expect(wapProjectNoun("mutant_vehicle")).toBe("project");
  });

  it("dates read as a South African calendar day", () => {
    // 23:30 UTC on 1 Mar is already 2 Mar in Johannesburg.
    expect(wapDayLabel(new Date("2027-03-01T23:30:00Z"))).toBe("2 Mar 2027");
  });

  it("titles the oldest ask the first request and later ones asks for more", () => {
    expect(wapRequestTitle(base, 0)).toBe("First request · 10 passes");
    expect(wapRequestTitle({ ...base, requested: 1 }, 0)).toBe(
      "First request · 1 pass",
    );
    expect(wapRequestTitle({ ...base, requested: 4 }, 1)).toBe(
      "Ask for 4 more",
    );
  });

  it("describes each status", () => {
    expect(wapRequestLine(base)).toBe(
      "Asked 2 Mar 2027 by Alice Hatter · 10 granted on 4 Mar 2027",
    );
    expect(
      wapRequestLine({
        ...base,
        status: WapRequestStatus.enum.pending,
        granted: null,
        decidedAt: null,
      }),
    ).toBe("Asked 2 Mar 2027 by Alice Hatter · AfrikaBurn hasn't answered yet");
    expect(
      wapRequestLine({
        ...base,
        status: WapRequestStatus.enum.declined,
        granted: null,
        requestedByName: null,
      }),
    ).toBe("Asked 2 Mar 2027 · declined on 4 Mar 2027");
  });

  it("counts what is left to hand out, never below zero", () => {
    expect(wapLeftToHandOut(7, 10)).toBe("3 passes left to hand out");
    expect(wapLeftToHandOut(9, 10)).toBe("1 pass left to hand out");
    expect(wapLeftToHandOut(12, 10)).toBe("No passes left to hand out");
  });
});
