import { describe, it, expect } from "vitest";
import {
  generatePaymentReference,
  deriveSubjectCode,
  PAYMENT_REFERENCE_PREFIX,
} from "../payment-reference";

describe("generatePaymentReference", () => {
  it("builds the canonical QP-2027-MAH-001 shape", () => {
    expect(
      generatePaymentReference({ year: 2027, code: "MAH", sequence: 1 }),
    ).toBe("QP-2027-MAH-001");
  });

  it("defaults the prefix to QP and zero-pads the sequence", () => {
    expect(PAYMENT_REFERENCE_PREFIX).toBe("QP");
    expect(
      generatePaymentReference({ year: 2027, code: "abc", sequence: 42 }),
    ).toBe("QP-2027-ABC-042");
    expect(
      generatePaymentReference({ year: 2027, code: "abc", sequence: 1234 }),
    ).toBe("QP-2027-ABC-1234");
  });

  it("cleans the subject code (upper, alnum, capped)", () => {
    expect(
      generatePaymentReference({ year: 2027, code: "ma-h!", sequence: 3 }),
    ).toBe("QP-2027-MAH-003");
  });

  it("rejects an empty code and a negative sequence", () => {
    expect(() =>
      generatePaymentReference({ year: 2027, code: "!!!", sequence: 1 }),
    ).toThrow();
    expect(() =>
      generatePaymentReference({ year: 2027, code: "MAH", sequence: -1 }),
    ).toThrow();
  });
});

describe("deriveSubjectCode", () => {
  it("takes the first three alphanumerics, upper-cased", () => {
    expect(deriveSubjectCode("Mad Hatters")).toBe("MAD");
    expect(deriveSubjectCode("Dusty Prototype")).toBe("DUS");
  });

  it("falls back to XXX when nothing usable is present", () => {
    expect(deriveSubjectCode("!!!")).toBe("XXX");
  });
});
