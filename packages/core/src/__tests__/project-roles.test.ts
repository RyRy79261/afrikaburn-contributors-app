import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROJECT_ROLES,
  normalizeRoleName,
  cleanRoleName,
  isValidRoleName,
  roleNameConflicts,
  dedupeRoleNames,
  defaultProjectRoleRows,
  PROJECT_ROLE_CAP,
  roleCapReached,
} from "../project-roles";

// Regression guard for the missing 20-role cap (spec §"Custom project roles
// CRUD": "cap 20 roles/project"). createRole (roles-store) must refuse once the
// project holds PROJECT_ROLE_CAP roles.
describe("roleCapReached", () => {
  it("caps a project at 20 roles", () => {
    expect(PROJECT_ROLE_CAP).toBe(20);
  });

  it("is false below the cap and true at/over it", () => {
    expect(roleCapReached(0)).toBe(false);
    expect(roleCapReached(PROJECT_ROLE_CAP - 1)).toBe(false);
    expect(roleCapReached(PROJECT_ROLE_CAP)).toBe(true);
    expect(roleCapReached(PROJECT_ROLE_CAP + 5)).toBe(true);
  });
});

describe("DEFAULT_PROJECT_ROLES", () => {
  it("is Captain, Team lead, Burn member in order", () => {
    expect(DEFAULT_PROJECT_ROLES.map((r) => r.name)).toEqual([
      "Captain",
      "Team lead",
      "Burn member",
    ]);
    expect(DEFAULT_PROJECT_ROLES.map((r) => r.sort)).toEqual([0, 1, 2]);
  });

  it("builds insert rows flagged is_default with normalized keys", () => {
    const rows = defaultProjectRoleRows("g-1");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      groupId: "g-1",
      name: "Captain",
      nameNormalized: "captain",
      isDefault: true,
      sort: 0,
    });
    expect(rows[1]?.nameNormalized).toBe("teamlead");
  });
});

describe("normalizeRoleName", () => {
  it("collapses case/space/punct so variants collide", () => {
    expect(normalizeRoleName("Team Lead")).toBe("teamlead");
    expect(normalizeRoleName("team-lead")).toBe("teamlead");
    expect(normalizeRoleName("  TEAMLEAD ")).toBe("teamlead");
  });
});

describe("cleanRoleName / isValidRoleName", () => {
  it("trims and collapses internal whitespace", () => {
    expect(cleanRoleName("  Kitchen   Crew ")).toBe("Kitchen Crew");
  });

  it("rejects empty and punctuation-only names", () => {
    expect(isValidRoleName("")).toBe(false);
    expect(isValidRoleName("   ")).toBe(false);
    expect(isValidRoleName("!!!")).toBe(false);
    expect(isValidRoleName("Captain")).toBe(true);
  });

  it("rejects overlong names", () => {
    expect(isValidRoleName("a".repeat(61))).toBe(false);
    expect(isValidRoleName("a".repeat(60))).toBe(true);
  });
});

describe("roleNameConflicts", () => {
  const existing = ["Captain", "Team lead", "Burn member"];

  it("detects a normalized collision", () => {
    expect(roleNameConflicts(existing, "captain")).toBe(true);
    expect(roleNameConflicts(existing, "TEAM-LEAD")).toBe(true);
  });

  it("allows a genuinely new name", () => {
    expect(roleNameConflicts(existing, "Kitchen Crew")).toBe(false);
  });

  it("skips the excepted key so a rename to its own value is allowed", () => {
    // renaming "Team lead" → "Team Lead" must not self-conflict.
    expect(
      roleNameConflicts(existing, "Team Lead", normalizeRoleName("Team lead")),
    ).toBe(false);
    // but it must still conflict with a DIFFERENT existing role.
    expect(
      roleNameConflicts(existing, "Captain", normalizeRoleName("Team lead")),
    ).toBe(true);
  });
});

describe("dedupeRoleNames", () => {
  it("keeps first occurrence, drops normalized dupes and invalids", () => {
    expect(
      dedupeRoleNames(["Captain", "captain", "  ", "Team-Lead", "team lead"]),
    ).toEqual(["Captain", "Team-Lead"]);
  });
});
