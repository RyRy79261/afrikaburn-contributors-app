import { describe, it, expect } from "vitest";
import { parseGodEmails, isGodEmailIn, canBootstrapGod } from "../god-emails";

describe("parseGodEmails", () => {
  it("returns an empty list for null/undefined/empty", () => {
    expect(parseGodEmails(null)).toEqual([]);
    expect(parseGodEmails(undefined)).toEqual([]);
    expect(parseGodEmails("")).toEqual([]);
    expect(parseGodEmails("   ")).toEqual([]);
  });

  it("splits, trims, and lowercases a comma list", () => {
    expect(parseGodEmails("A@Example.com, b@Example.COM ,  ")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("drops empty entries from stray commas", () => {
    expect(parseGodEmails("a@example.com,,b@example.com,")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });
});

describe("isGodEmailIn", () => {
  const list = parseGodEmails("dusty.prototype@example.com, playa@example.com");

  it("matches case-insensitively", () => {
    expect(isGodEmailIn("Dusty.Prototype@Example.com", list)).toBe(true);
    expect(isGodEmailIn("  playa@example.com  ", list)).toBe(true);
  });

  it("rejects non-members and empty input", () => {
    expect(isGodEmailIn("stranger@example.com", list)).toBe(false);
    expect(isGodEmailIn(null, list)).toBe(false);
    expect(isGodEmailIn(undefined, list)).toBe(false);
    expect(isGodEmailIn("", list)).toBe(false);
  });
});

describe("canBootstrapGod (regression: verified-email gate)", () => {
  const list = parseGodEmails("dusty.prototype@example.com, playa@example.com");

  it("grants only when the email is BOTH listed and verified", () => {
    expect(canBootstrapGod("dusty.prototype@example.com", true, list)).toBe(
      true,
    );
    expect(canBootstrapGod("Playa@Example.com", true, list)).toBe(true);
  });

  it("refuses a listed but UNVERIFIED email — the elevation exploit", () => {
    // The core of the fix: a matching but unverified address (attacker-asserted
    // OIDC claim, unverified email-change, self-service sign-up) must NOT elevate.
    expect(canBootstrapGod("dusty.prototype@example.com", false, list)).toBe(
      false,
    );
    expect(canBootstrapGod("playa@example.com", false, list)).toBe(false);
  });

  it("refuses a verified email that is not on the list", () => {
    expect(canBootstrapGod("stranger@example.com", true, list)).toBe(false);
  });

  it("refuses empty / missing emails regardless of the verified flag", () => {
    expect(canBootstrapGod(null, true, list)).toBe(false);
    expect(canBootstrapGod(undefined, true, list)).toBe(false);
    expect(canBootstrapGod("", true, list)).toBe(false);
  });
});
