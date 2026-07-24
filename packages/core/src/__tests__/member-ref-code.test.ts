import { describe, it, expect } from "vitest";
import {
  deriveCampPrefix,
  disambiguateCampPrefix,
  formatMemberRefCode,
  isValidMemberRefCode,
  parseMemberRefCode,
  establishedCampPrefix,
  nextMemberSequence,
} from "../member-ref-code";

describe("deriveCampPrefix", () => {
  it("derives MAH from 'Mad Hatters' (first word's first two + later initials)", () => {
    expect(deriveCampPrefix("Mad Hatters")).toBe("MAH");
  });

  it("uses first-two + one-per-later-word, capped at 4", () => {
    expect(deriveCampPrefix("The Velvet Mirage")).toBe("THVM");
    expect(deriveCampPrefix("Salt & Ember Kitchen")).toBe("SAEK");
  });

  it("back-fills short names from the first word", () => {
    expect(deriveCampPrefix("Ember")).toBe("EMBE");
    expect(deriveCampPrefix("Ren")).toBe("REN");
  });

  it("ignores digits and punctuation, pads tiny names, handles empties", () => {
    expect(deriveCampPrefix("Camp 404")).toBe("CAMP");
    expect(deriveCampPrefix("Q")).toBe("QXX");
    expect(deriveCampPrefix("   ")).toBe("XXX");
    expect(deriveCampPrefix("2027")).toBe("XXX");
  });

  it("is case- and diacritic-insensitive", () => {
    expect(deriveCampPrefix("mad hatters")).toBe("MAH");
    expect(deriveCampPrefix("Ámbër Café")).toBe("AMC");
  });
});

describe("disambiguateCampPrefix (deterministic collision handling)", () => {
  it("returns the base prefix when nothing is taken", () => {
    expect(disambiguateCampPrefix("Mad Hatters", [])).toBe("MAH");
  });

  it("resolves collisions between similarly-named camps deterministically", () => {
    // Two camps both derive base "MAH".
    const first = disambiguateCampPrefix("Mad Hatters", []);
    expect(first).toBe("MAH");
    const second = disambiguateCampPrefix("Mad Haberdashery", [first]);
    expect(second).toBe("MAHA");
    const third = disambiguateCampPrefix("Mad Haciendas", [first, second]);
    expect(third).toBe("MAHB");
  });

  it("is a pure function of (name, taken) — order of taken does not matter", () => {
    expect(disambiguateCampPrefix("Mad Hatters", ["MAH", "MAHA"])).toBe("MAHB");
    expect(disambiguateCampPrefix("Mad Hatters", ["MAHA", "MAH"])).toBe("MAHB");
  });

  it("is case-insensitive against the taken set", () => {
    expect(disambiguateCampPrefix("Mad Hatters", ["mah"])).toBe("MAHA");
  });
});

describe("formatMemberRefCode", () => {
  it("formats {PREFIX}-M{NNN} with zero-padding", () => {
    expect(formatMemberRefCode("MAH", 17)).toBe("MAH-M017");
    expect(formatMemberRefCode("MAH", 1)).toBe("MAH-M001");
    expect(formatMemberRefCode("THVM", 1234)).toBe("THVM-M1234");
  });

  it("cleans the prefix and rejects bad input", () => {
    expect(formatMemberRefCode("m a h", 3)).toBe("MAH-M003");
    expect(() => formatMemberRefCode("", 1)).toThrow();
    expect(() => formatMemberRefCode("MAH", 0)).toThrow();
    expect(() => formatMemberRefCode("MAH", -1)).toThrow();
    expect(() => formatMemberRefCode("MAH", 1.5)).toThrow();
  });
});

describe("isValidMemberRefCode / parseMemberRefCode", () => {
  it("accepts well-formed codes and round-trips them", () => {
    expect(isValidMemberRefCode("MAH-M017")).toBe(true);
    expect(parseMemberRefCode("MAH-M017")).toEqual({
      prefix: "MAH",
      sequence: 17,
    });
    expect(parseMemberRefCode("THVM-M1234")).toEqual({
      prefix: "THVM",
      sequence: 1234,
    });
  });

  it("rejects malformed codes", () => {
    for (const bad of [
      "MAH-017", // no member marker
      "MAH-M17", // too few digits
      "mah-m017", // lowercase
      "MAH_M017", // wrong separator
      "-M001",
      "MAH-M",
      "",
    ]) {
      expect(isValidMemberRefCode(bad)).toBe(false);
      expect(parseMemberRefCode(bad)).toBeNull();
    }
  });
});

describe("establishedCampPrefix / nextMemberSequence", () => {
  it("reads the shared prefix from existing codes", () => {
    expect(establishedCampPrefix(["MAH-M001", "MAH-M002"])).toBe("MAH");
    expect(establishedCampPrefix([])).toBeNull();
    expect(establishedCampPrefix(["garbage", "MAH-M003"])).toBe("MAH");
    expect(establishedCampPrefix(["garbage"])).toBeNull();
  });

  it("returns one past the highest existing sequence", () => {
    expect(nextMemberSequence([])).toBe(1);
    expect(nextMemberSequence(["MAH-M001", "MAH-M002"])).toBe(3);
    // Order-independent and gap-tolerant (never reuses a lower slot).
    expect(nextMemberSequence(["MAH-M005", "MAH-M002"])).toBe(6);
    expect(nextMemberSequence(["MAH-M017", "garbage"])).toBe(18);
  });
});
