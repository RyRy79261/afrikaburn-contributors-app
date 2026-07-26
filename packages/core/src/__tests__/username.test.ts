import { describe, it, expect } from "vitest";
import {
  RESERVED_USERNAMES,
  UNNAMED_BURNER,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  isReservedUsername,
  normalizeUsername,
  publicMemberName,
  validateUsername,
} from "../username";
import { DEPARTED_BURNER_NAME } from "../account-sanitization";

/** Narrow a validation result to its error, failing loudly if it passed. */
function errorOf(raw: string): string {
  const r = validateUsername(raw);
  expect(r.ok, `expected "${raw}" to be rejected`).toBe(false);
  return r.ok ? "" : r.error;
}

describe("validateUsername — shape", () => {
  it("accepts an ordinary handle", () => {
    const r = validateUsername("dusty");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.username).toBe("dusty");
      expect(r.normalized).toBe("dusty");
    }
  });

  it("accepts digits and interior underscores", () => {
    for (const ok of ["a1b", "dusty_prototype", "ren404", "x_9_z"]) {
      expect(validateUsername(ok).ok, ok).toBe(true);
    }
  });

  it("trims surrounding whitespace before judging anything", () => {
    const r = validateUsername("  dusty  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.username).toBe("dusty");
  });

  it("enforces the length bounds", () => {
    expect(validateUsername("a".repeat(USERNAME_MIN_LENGTH)).ok).toBe(true);
    expect(validateUsername("a".repeat(USERNAME_MAX_LENGTH)).ok).toBe(true);
    expect(validateUsername("a".repeat(USERNAME_MAX_LENGTH + 1)).ok).toBe(false);
    expect(validateUsername("ab").ok).toBe(false);
  });

  it("requires a leading letter", () => {
    for (const bad of ["1dusty", "_dusty", "9_9_9"]) {
      expect(validateUsername(bad).ok, bad).toBe(false);
    }
  });

  it("rejects a trailing underscore and doubled underscores", () => {
    expect(validateUsername("dusty_").ok).toBe(false);
    expect(validateUsername("dusty__prototype").ok).toBe(false);
    expect(validateUsername("d___y").ok).toBe(false);
  });

  it("rejects characters outside the charset", () => {
    for (const bad of [
      "dusty prototype",
      "dusty-prototype",
      "dusty.prototype",
      "dusty@burn",
      "düsty",
      "dusty!",
      "dusty/../admin",
    ]) {
      expect(validateUsername(bad).ok, bad).toBe(false);
    }
  });

  it("rejects blank input — the caller must treat empty as 'no username'", () => {
    expect(validateUsername("").ok).toBe(false);
    expect(validateUsername("   ").ok).toBe(false);
  });
});

describe("validateUsername — case handling", () => {
  it("accepts mixed case and STORES IT AS ENTERED", () => {
    const r = validateUsername("DustyPrototype");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.username).toBe("DustyPrototype");
  });

  it("normalizes to lower case — the uniqueness key", () => {
    const r = validateUsername("DustyPrototype");
    if (r.ok) expect(r.normalized).toBe("dustyprototype");
    expect(normalizeUsername("  DUSTY  ")).toBe("dusty");
  });

  it("treats case variants as THE SAME handle (impersonation guard)", () => {
    // The whole point of the `lower(username)` unique index: `Admin` must not
    // be able to sit next to `admin`, and `Dusty` must not shadow `dusty`.
    const a = validateUsername("Dusty");
    const b = validateUsername("dUsTy");
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.normalized).toBe(b.normalized);
  });

  it("catches a reserved name typed in any case", () => {
    expect(validateUsername("Admin").ok).toBe(false);
    expect(validateUsername("AFRIKABURN").ok).toBe(false);
    expect(isReservedUsername("  Root ")).toBe(true);
  });
});

describe("validateUsername — reserved list", () => {
  it("refuses every reserved handle", () => {
    for (const name of RESERVED_USERNAMES) {
      // Only assert on entries that are otherwise well-formed — the list also
      // carries short/edge strings that other rules would catch first.
      if (name.length < USERNAME_MIN_LENGTH) continue;
      expect(validateUsername(name).ok, name).toBe(false);
    }
  });

  it("covers the impersonation + route-shadowing names Ryan named", () => {
    for (const name of [
      "admin",
      "root",
      "afrikaburn",
      "quagga",
      "org",
      "api",
      "auth",
      "suppliers",
      "support",
      "help",
      "settings",
      "account",
      "profile",
      "directory",
      "camps",
      "burners",
      "new",
      "edit",
      "continue",
      "join",
      "null",
      "undefined",
    ]) {
      expect(isReservedUsername(name), name).toBe(true);
    }
  });

  it("every reserved entry is itself lower-cased and unique", () => {
    // A reserved entry with capitals would silently never match, because the
    // lookup normalizes. A duplicate is dead weight that hides a typo.
    for (const name of RESERVED_USERNAMES) expect(name).toBe(name.toLowerCase());
    expect(new Set(RESERVED_USERNAMES).size).toBe(RESERVED_USERNAMES.length);
  });
});

describe("validateUsername — error messages are for humans", () => {
  it("names the ONE thing that is wrong, per failure mode", () => {
    expect(errorOf("ab")).toMatch(/at least 3 characters/i);
    expect(errorOf("a".repeat(21))).toMatch(/at most 20 characters/i);
    expect(errorOf("1dusty")).toMatch(/start with a letter/i);
    expect(errorOf("dusty_")).toMatch(/end with an underscore/i);
    expect(errorOf("du__sty")).toMatch(/two underscores in a row/i);
    expect(errorOf("dusty prototype")).toMatch(
      /letters, numbers and underscores/i,
    );
    expect(errorOf("admin")).toMatch(/reserved/i);
  });

  it("never dumps a regex or a character class at the user", () => {
    for (const bad of ["ab", "1dusty", "dusty_", "du__sty", "dusty!", "admin"]) {
      const message = errorOf(bad);
      expect(message, bad).not.toMatch(/[\^$\\]|\[a-z|{2,|regex/i);
      expect(message.endsWith("."), bad).toBe(true);
    }
  });
});

describe("publicMemberName — THE display fallback", () => {
  it("prefers the username", () => {
    expect(publicMemberName("dusty")).toBe("dusty");
    expect(publicMemberName("  Ember  ")).toBe("Ember");
  });

  it("falls back to the neutral placeholder when there is no username", () => {
    // Optional means optional: every roster, directory row and profile heading
    // has to render for someone who never picked a handle.
    expect(publicMemberName(null)).toBe(UNNAMED_BURNER);
    expect(publicMemberName(undefined)).toBe(UNNAMED_BURNER);
    expect(publicMemberName("")).toBe(UNNAMED_BURNER);
    expect(publicMemberName("   ")).toBe(UNNAMED_BURNER);
  });

  it("REGRESSION: the placeholder can never look like an email", () => {
    expect(publicMemberName(null)).not.toContain("@");
    expect(UNNAMED_BURNER).not.toContain("@");
  });

  it("renders a sanitized account as the Departed Burner stub", () => {
    expect(publicMemberName(null, { sanitizedAt: new Date() })).toBe(
      DEPARTED_BURNER_NAME,
    );
    // The tombstone wins even if a handle somehow survived the erasure.
    expect(publicMemberName("dusty", { sanitizedAt: new Date() })).toBe(
      DEPARTED_BURNER_NAME,
    );
  });

  it("a live account is unaffected by a null tombstone", () => {
    expect(publicMemberName("dusty", { sanitizedAt: null })).toBe("dusty");
    expect(publicMemberName(null, {})).toBe(UNNAMED_BURNER);
  });
});
