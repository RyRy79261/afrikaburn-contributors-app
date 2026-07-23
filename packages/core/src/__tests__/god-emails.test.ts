import { describe, it, expect } from "vitest";
import { parseGodEmails, isGodEmailIn } from "../god-emails";

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
