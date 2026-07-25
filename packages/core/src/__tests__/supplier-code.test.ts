import { describe, it, expect } from "vitest";
import {
  SUPPLIER_CODE_PREFIX,
  formatSupplierCode,
  isValidSupplierCode,
  parseSupplierCode,
  nextSupplierSequence,
  issueSupplierCode,
} from "../supplier-code";

describe("formatSupplierCode", () => {
  it("produces the canvas format", () => {
    expect(formatSupplierCode(2027, 416)).toBe("SUP-2027-0416");
    expect(SUPPLIER_CODE_PREFIX).toBe("SUP");
  });

  it("zero-pads to four digits and keeps wider sequences intact", () => {
    expect(formatSupplierCode(2027, 1)).toBe("SUP-2027-0001");
    expect(formatSupplierCode(2027, 9999)).toBe("SUP-2027-9999");
    expect(formatSupplierCode(2027, 12345)).toBe("SUP-2027-12345");
  });

  it("refuses inputs that cannot make a well-formed code", () => {
    // An invalid code must never reach storage, where UNIQUE would enshrine it.
    expect(() => formatSupplierCode(27, 1)).toThrow();
    expect(() => formatSupplierCode(2027, 0)).toThrow();
    expect(() => formatSupplierCode(2027, -1)).toThrow();
    expect(() => formatSupplierCode(2027, 1.5)).toThrow();
  });
});

describe("parse / validate", () => {
  it("round-trips", () => {
    expect(parseSupplierCode("SUP-2027-0416")).toEqual({
      year: 2027,
      sequence: 416,
    });
    expect(isValidSupplierCode("SUP-2027-0416")).toBe(true);
  });

  it("tolerates surrounding whitespace when parsing", () => {
    expect(parseSupplierCode("  SUP-2027-0416 ")).toEqual({
      year: 2027,
      sequence: 416,
    });
  });

  it("rejects malformed values", () => {
    for (const bad of [
      "",
      "SUP-2027",
      "SUP-2027-041",
      "sup-2027-0416",
      "MAH-M017",
      "SUP-27-0416",
      "SUP-2027-ABCD",
      "XSUP-2027-0416",
    ]) {
      expect(isValidSupplierCode(bad), bad).toBe(false);
      expect(parseSupplierCode(bad), bad).toBeNull();
    }
  });
});

describe("nextSupplierSequence", () => {
  it("starts at 1 for a fresh year", () => {
    expect(nextSupplierSequence(2027, [])).toBe(1);
    expect(nextSupplierSequence(2027, ["SUP-2026-0999"])).toBe(1);
  });

  it("continues from the highest sequence in that year", () => {
    expect(
      nextSupplierSequence(2027, [
        "SUP-2027-0001",
        "SUP-2027-0416",
        "SUP-2027-0007",
      ]),
    ).toBe(417);
  });

  it("ignores other years", () => {
    expect(
      nextSupplierSequence(2027, ["SUP-2026-9999", "SUP-2028-5000", "SUP-2027-0002"]),
    ).toBe(3);
  });

  it("skips nulls and unparseable legacy values rather than stalling issuance", () => {
    expect(
      nextSupplierSequence(2027, [null, undefined, "", "legacy-code", "SUP-2027-0005"]),
    ).toBe(6);
  });
});

describe("issueSupplierCode", () => {
  it("is deterministic — the same year and set always yield the same code", () => {
    const existing = ["SUP-2027-0001", "SUP-2027-0002"];
    expect(issueSupplierCode(2027, existing)).toBe("SUP-2027-0003");
    expect(issueSupplierCode(2027, existing)).toBe("SUP-2027-0003");
  });

  it("advances once a code is taken", () => {
    const existing = ["SUP-2027-0001"];
    const first = issueSupplierCode(2027, existing);
    expect(issueSupplierCode(2027, [...existing, first])).toBe("SUP-2027-0003");
  });
});
