import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROJECT_ROLES,
  normalizeRoleName,
  cleanRoleName,
  isValidRoleName,
  roleNameConflicts,
  dedupeRoleNames,
  defaultProjectRoleRows,
  officerRoleRows,
  teamLeadScopePatch,
  canDeleteRoleKind,
  canRenameRoleKind,
  isBaselineKind,
  PROJECT_ROLE_CAP,
  roleCapReached,
} from "../project-roles";
import { OFFICER_CATALOG } from "../officers";

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
  it("is Captain (captain), Team lead (default), Burner (baseline) in order", () => {
    expect(DEFAULT_PROJECT_ROLES.map((r) => r.name)).toEqual([
      "Captain",
      "Team lead",
      "Burner",
    ]);
    expect(DEFAULT_PROJECT_ROLES.map((r) => r.kind)).toEqual([
      "captain",
      "default",
      "baseline",
    ]);
    expect(DEFAULT_PROJECT_ROLES.map((r) => r.sort)).toEqual([0, 1, 2]);
  });

  it("seeds Captain with all permissions, Burner with none", () => {
    const [captain, teamLead, burner] = DEFAULT_PROJECT_ROLES;
    expect(captain?.emoji).toBe("🎩");
    expect(captain?.permissions.manage_members).toBe(true);
    expect(captain?.permissions.manage_questionnaires).toEqual({
      audienceRoles: "all",
      mayBlock: true,
    });
    expect(teamLead?.permissions.view_member_details).toBe(true);
    expect(teamLead?.permissions.manage_questionnaires?.mayBlock).toBe(false);
    expect(burner?.permissions).toEqual({});
  });

  it("builds insert rows flagged is_default with normalized keys + Roles v2 fields", () => {
    const rows = defaultProjectRoleRows("g-1");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      groupId: "g-1",
      name: "Captain",
      nameNormalized: "captain",
      isDefault: true,
      sort: 0,
      kind: "captain",
      color: "apricot",
      emoji: "🎩",
      officerKey: null,
    });
    expect(rows[1]?.nameNormalized).toBe("teamlead");
    expect(rows[2]?.kind).toBe("baseline");
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

describe("officerRoleRows", () => {
  it("materialises one row per catalog officer, not aliasable, officer-kind", () => {
    const rows = officerRoleRows("g-1");
    expect(rows).toHaveLength(OFFICER_CATALOG.length);
    expect(rows.map((r) => r.officerKey)).toEqual(
      OFFICER_CATALOG.map((c) => c.key),
    );
    for (const r of rows) {
      expect(r.kind).toBe("officer");
      expect(r.isDefault).toBe(true);
      expect(r.groupId).toBe("g-1");
    }
    // Safety Baron is the fire_safety_officer's fixed display name.
    const baron = rows.find((r) => r.officerKey === "fire_safety_officer");
    expect(baron?.name).toBe("Safety Baron");
    expect(baron?.emoji).toBe("🔥");
  });

  it("starts sort after the defaults so officers list below core roles", () => {
    const rows = officerRoleRows("g-1", 100);
    expect(rows[0]?.sort).toBe(100);
    expect(rows.at(-1)?.sort).toBe(100 + OFFICER_CATALOG.length - 1);
  });
});

describe("teamLeadScopePatch", () => {
  it("re-points Team lead's questionnaire scope to the baseline role id", () => {
    const patch = teamLeadScopePatch([
      { id: "cap", kind: "captain" },
      { id: "tl", kind: "default" },
      { id: "base", kind: "baseline" },
    ]);
    expect(patch).toEqual({
      roleId: "tl",
      permissions: {
        view_member_details: true,
        manage_questionnaires: { audienceRoles: ["base"], mayBlock: false },
      },
    });
  });

  it("returns null when default or baseline role is missing", () => {
    expect(teamLeadScopePatch([{ id: "cap", kind: "captain" }])).toBeNull();
  });
});

describe("kind guards", () => {
  it("only custom roles delete; officers never rename; baseline is the everyone-role", () => {
    expect(canDeleteRoleKind("custom")).toBe(true);
    expect(canDeleteRoleKind("captain")).toBe(false);
    expect(canDeleteRoleKind("baseline")).toBe(false);
    expect(canDeleteRoleKind("officer")).toBe(false);

    expect(canRenameRoleKind("captain")).toBe(true);
    expect(canRenameRoleKind("baseline")).toBe(true);
    expect(canRenameRoleKind("custom")).toBe(true);
    expect(canRenameRoleKind("officer")).toBe(false);

    expect(isBaselineKind("baseline")).toBe(true);
    expect(isBaselineKind("default")).toBe(false);
  });
});
