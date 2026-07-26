import { describe, it, expect } from "vitest";
import { SecurityEventLogKind } from "@quagga/types";
import {
  SECURITY_EVENT_TITLES,
  describeSecurityEvent,
} from "../security-events";

describe("security-events", () => {
  it("has a non-empty title for every SecurityEventLogKind", () => {
    for (const kind of SecurityEventLogKind.options) {
      const title = describeSecurityEvent(kind);
      expect(typeof title).toBe("string");
      expect(title.length).toBeGreaterThan(0);
      expect(SECURITY_EVENT_TITLES[kind]).toBe(title);
    }
  });

  it("covers exactly the enum's kinds (no drift)", () => {
    expect(Object.keys(SECURITY_EVENT_TITLES).sort()).toEqual(
      [...SecurityEventLogKind.options].sort(),
    );
  });
});
