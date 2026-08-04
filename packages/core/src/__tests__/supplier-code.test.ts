import { describe, it, expect } from "vitest";
import {
  SUPPLIER_CODE_PREFIX,
  formatSupplierCode,
  isValidSupplierCode,
  parseSupplierCode,
  nextSupplierSequence,
  issueSupplierCode,
  contactNamesAddress,
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
      nextSupplierSequence(2027, [
        "SUP-2026-9999",
        "SUP-2028-5000",
        "SUP-2027-0002",
      ]),
    ).toBe(3);
  });

  it("skips nulls and unparseable legacy values rather than stalling issuance", () => {
    expect(
      nextSupplierSequence(2027, [
        null,
        undefined,
        "",
        "legacy-code",
        "SUP-2027-0005",
      ]),
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

describe("contactNamesAddress — the supplier claim boundary", () => {
  // The takeover this replaced: `ILIKE '%address%'` on a free-text contact.
  // Both attack addresses below are ordinary registerable Gmail addresses and
  // are literal substrings of a seeded supplier's contact string.
  it("refuses a shorter address that is merely a SUBSTRING of the listed one", () => {
    expect(
      contactNamesAddress(
        "Zizipho Gcasamba z.gcasamba@gmail.com",
        "gcasamba@gmail.com",
      ),
    ).toBe(false);
    expect(
      contactNamesAddress(
        "Lenny deharnstretchtents85@gmail.com",
        "harnstretchtents85@gmail.com",
      ),
    ).toBe(false);
  });

  it("accepts the address the contact actually names", () => {
    expect(
      contactNamesAddress(
        "Zizipho Gcasamba z.gcasamba@gmail.com",
        "z.gcasamba@gmail.com",
      ),
    ).toBe(true);
    expect(
      contactNamesAddress(
        "Bookings: ops@loskop.co.za / 082 555 0147",
        "OPS@LosKop.co.za",
      ),
    ).toBe(true);
  });

  it("refuses a longer address that merely CONTAINS the listed one", () => {
    expect(
      contactNamesAddress("ops@loskop.co.za", "ops@loskop.co.za.evil.net"),
    ).toBe(false);
  });

  it("handles several addresses in one contact string", () => {
    const contact = "Ops ops@loskop.co.za, accounts accounts@loskop.co.za";
    expect(contactNamesAddress(contact, "accounts@loskop.co.za")).toBe(true);
    expect(contactNamesAddress(contact, "counts@loskop.co.za")).toBe(false);
  });

  it("is safe on empty, null and address-free contacts", () => {
    expect(contactNamesAddress(null, "a@b.com")).toBe(false);
    expect(contactNamesAddress("phone only 082 555 0147", "a@b.com")).toBe(
      false,
    );
    expect(contactNamesAddress("a@b.com", "   ")).toBe(false);
  });
});
