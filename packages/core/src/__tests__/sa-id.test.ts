import { describe, it, expect } from "vitest";
import {
  SA_ID_CHECKSUM_ERROR,
  SA_ID_LENGTH_ERROR,
  isValidSaIdNumber,
  normaliseSaIdNumber,
  saIdNumberError,
} from "../sa-id";

// 8001015009087 is the widely published example SA ID number: a valid check
// digit, and nobody's real number. Every other value here is derived from it.
const VALID = "8001015009087";

describe("isValidSaIdNumber", () => {
  it("accepts a number whose check digit is right", () => {
    expect(isValidSaIdNumber(VALID)).toBe(true);
  });

  it("accepts the spaces and hyphens people group it with", () => {
    expect(isValidSaIdNumber("800101 5009 087")).toBe(true);
    expect(isValidSaIdNumber("800101-5009-087")).toBe(true);
  });

  it("catches one mistyped digit, anywhere in the number", () => {
    for (let i = 0; i < VALID.length; i += 1) {
      const d = Number(VALID[i]);
      const typo =
        VALID.slice(0, i) + String((d + 1) % 10) + VALID.slice(i + 1);
      expect(`${typo} ${isValidSaIdNumber(typo)}`).toBe(`${typo} false`);
    }
  });

  it("catches two neighbouring digits swapped", () => {
    // Positions 4/5 hold "01"; swapped they read "10".
    const swapped = VALID.slice(0, 4) + "10" + VALID.slice(6);
    expect(isValidSaIdNumber(swapped)).toBe(false);
  });

  it("refuses anything that is not exactly 13 digits", () => {
    expect(isValidSaIdNumber(VALID.slice(0, 12))).toBe(false);
    expect(isValidSaIdNumber(VALID + "0")).toBe(false);
    expect(isValidSaIdNumber("800101500908A")).toBe(false);
    expect(isValidSaIdNumber("")).toBe(false);
  });
});

describe("normaliseSaIdNumber", () => {
  it("drops only grouping characters", () => {
    expect(normaliseSaIdNumber(" 800101 5009-087 ")).toBe(VALID);
  });
});

describe("saIdNumberError", () => {
  it("says nothing unless the burner chose South African ID", () => {
    expect(saIdNumberError("passport", "8001015009088")).toBeNull();
    expect(saIdNumberError(null, "8001015009088")).toBeNull();
    expect(saIdNumberError(undefined, "123")).toBeNull();
  });

  it("says nothing about a blank number — the document is optional", () => {
    expect(saIdNumberError("sa_id", "")).toBeNull();
    expect(saIdNumberError("sa_id", "   ")).toBeNull();
    expect(saIdNumberError("sa_id", null)).toBeNull();
  });

  it("names a wrong length separately from a wrong digit", () => {
    expect(saIdNumberError("sa_id", "800101500908")).toBe(SA_ID_LENGTH_ERROR);
    expect(saIdNumberError("sa_id", "8001015009088")).toBe(
      SA_ID_CHECKSUM_ERROR,
    );
    expect(saIdNumberError("sa_id", VALID)).toBeNull();
  });
});
