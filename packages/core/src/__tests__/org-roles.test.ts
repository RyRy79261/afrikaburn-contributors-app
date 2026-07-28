import { describe, it, expect } from "vitest";
import {
  SEEDED_ORG_ROLES,
  seededOrgRoleRows,
  departmentRoleRows,
  departmentRoleKey,
  departmentRoleName,
  departmentKeyFrom,
  uniqueDepartmentKey,
  customOrgRoleKey,
  canDeleteOrgRoleKind,
  canRenameOrgRoleKind,
  canEditOrgRolePermissions,
  canRescopeOrgRole,
  cleanOrgName,
  normalizeOrgName,
  isValidDepartmentName,
  isValidOrgRoleName,
  orgNameConflicts,
  ORG_ROLE_NAME_MAX,
} from "../org-roles";
import { grantedOrgCapabilities } from "../org-permissions";
import {
  UNDELETABLE_ORG_ROLE_KINDS,
  RENAMEABLE_ORG_ROLE_KINDS,
  OrgRoleKind,
} from "@quagga/types";

describe("org role kinds mirror the camp side", () => {
  it("has exactly two kinds, and only `custom` deletes", () => {
    expect(OrgRoleKind.options).toEqual(["system", "custom"]);
    expect(canDeleteOrgRoleKind("custom")).toBe(true);
    expect(canDeleteOrgRoleKind("system")).toBe(false);
    expect(UNDELETABLE_ORG_ROLE_KINDS).toEqual(["system"]);
  });

  it("lets BOTH kinds be renamed and re-righted — permanent is not frozen", () => {
    // Ryan: "these cant be removed but they can have the rights edited".
    for (const kind of OrgRoleKind.options) {
      expect(canRenameOrgRoleKind(kind)).toBe(true);
      expect(canEditOrgRolePermissions(kind)).toBe(true);
      expect(RENAMEABLE_ORG_ROLE_KINDS).toContain(kind);
    }
  });

  it("pins a department's seeded roles to their department", () => {
    // A "Suppliers lead" role that could be re-pointed at Safety would be a
    // department-scoped grant that no longer describes a department.
    expect(
      canRescopeOrgRole({ kind: "system", departmentId: "dept-1" }),
    ).toBe(false);
    expect(canRescopeOrgRole({ kind: "system", departmentId: null })).toBe(true);
    expect(canRescopeOrgRole({ kind: "custom", departmentId: "dept-1" })).toBe(
      true,
    );
  });
});

describe("the seeded system roles", () => {
  it("carry EXACTLY the rights the hardcoded ranks carried", () => {
    const byKey = Object.fromEntries(
      SEEDED_ORG_ROLES.map((r) => [r.key, grantedOrgCapabilities(r.permissions)]),
    );
    // `write` became `create` + `update`, and `read_system` stopped being a
    // capability (it is the engineer/System manager RANK now — see
    // `runsDeployment`). Nobody gained or lost real access in either row.
    expect(byKey.org_staff).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "personal_information",
    ]);
    expect(byKey.engineer).toEqual(["create", "read", "update"]);
  });

  it("are `system` kind, org-wide, and keyed on the rank they replace", () => {
    const rows = seededOrgRoleRows();
    expect(rows.map((r) => r.key)).toEqual(["org_staff", "engineer"]);
    for (const row of rows) {
      expect(row.kind).toBe("system");
      expect(row.departmentId).toBeNull();
      expect(row.nameNormalized).toBe(normalizeOrgName(row.name));
      expect(canDeleteOrgRoleKind(row.kind)).toBe(false);
    }
  });
});

describe("departments seed their own permanent pair", () => {
  const dept = { id: "dept-1", key: "theme_camps", name: "Theme camps" };

  it("creates a LEAD and a MEMBER, both undeletable while the department lives", () => {
    const rows = departmentRoleRows(dept);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name)).toEqual([
      "Theme camps lead",
      "Theme camps member",
    ]);
    expect(rows.map((r) => r.key)).toEqual([
      "dept.theme_camps.lead",
      "dept.theme_camps.member",
    ]);
    for (const row of rows) {
      expect(row.kind).toBe("system");
      expect(canDeleteOrgRoleKind(row.kind)).toBe(false);
      expect(row.departmentId).toBe("dept-1");
    }
  });

  it("gives the lead deletion and the member none", () => {
    const [lead, member] = departmentRoleRows(dept);
    expect(grantedOrgCapabilities(lead?.permissions)).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "personal_information",
    ]);
    // The member does ordinary work: full CRUD except destruction, and no
    // personal information. Both absences are the point of the pair.
    expect(grantedOrgCapabilities(member?.permissions)).toEqual([
      "create",
      "read",
      "update",
    ]);
  });

  it("builds keys and labels from the department, not the other way round", () => {
    expect(departmentRoleKey("suppliers", "lead")).toBe("dept.suppliers.lead");
    expect(departmentRoleName("Theme camps", "member")).toBe(
      "Theme camps member",
    );
  });
});

describe("names and keys", () => {
  it("derives a stable slug that a rename does not move", () => {
    expect(departmentKeyFrom("Theme Camps")).toBe("theme_camps");
    expect(departmentKeyFrom("  Safety & Medical  ")).toBe("safety_medical");
    expect(departmentKeyFrom("!!!")).toBe("department");
  });

  it("disambiguates a taken key rather than colliding", () => {
    expect(uniqueDepartmentKey("suppliers", [])).toBe("suppliers");
    expect(uniqueDepartmentKey("suppliers", ["suppliers"])).toBe("suppliers_2");
    expect(
      uniqueDepartmentKey("suppliers", ["suppliers", "suppliers_2"]),
    ).toBe("suppliers_3");
  });

  it("namespaces a custom role's key so it can never look seeded", () => {
    expect(customOrgRoleKey("Bulletin editor", [])).toBe(
      "custom.bulletin_editor",
    );
    expect(customOrgRoleKey("Bulletin editor", ["custom.bulletin_editor"])).toBe(
      "custom.bulletin_editor_2",
    );
  });

  it("normalises names case/space/punct-insensitively", () => {
    expect(normalizeOrgName("Theme Camps")).toBe(normalizeOrgName("theme-camps"));
    expect(cleanOrgName("  Theme   camps ")).toBe("Theme camps");
  });

  it("validates labels", () => {
    expect(isValidDepartmentName("Suppliers")).toBe(true);
    expect(isValidDepartmentName("   ")).toBe(false);
    expect(isValidOrgRoleName("x".repeat(ORG_ROLE_NAME_MAX))).toBe(true);
    expect(isValidOrgRoleName("x".repeat(ORG_ROLE_NAME_MAX + 1))).toBe(false);
    expect(isValidOrgRoleName("!!!")).toBe(false);
  });

  it("detects a collision, and lets a row keep its own name", () => {
    const existing = ["Org staff", "Engineer"];
    expect(orgNameConflicts(existing, "org-staff")).toBe(true);
    expect(orgNameConflicts(existing, "Suppliers lead")).toBe(false);
    expect(
      orgNameConflicts(existing, "Org Staff", normalizeOrgName("Org staff")),
    ).toBe(false);
  });
});
