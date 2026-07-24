import { describe, it, expect } from "vitest";
import {
  hasProjectPermission,
  canManageQuestionnaireAudience,
  allProjectPermissions,
  enforceKindPermissions,
  isPermissionsLockedKind,
  isPermissionBackstop,
  type PermissionMembership,
} from "../project-permissions";
import type { ProjectPermissions } from "@quagga/types";

const NONE: ProjectPermissions = {};

function member(
  structuralRole: PermissionMembership["structuralRole"],
  ...rolePermissions: ProjectPermissions[]
): PermissionMembership {
  return { structuralRole, rolePermissions };
}

describe("lead/admin backstop — irrevocable, no self-lockout", () => {
  it("lead and admin implicitly hold every permission even with zero role grants", () => {
    for (const role of ["lead", "admin"] as const) {
      const m = member(role);
      expect(hasProjectPermission(m, "view_member_details")).toBe(true);
      expect(hasProjectPermission(m, "manage_roles")).toBe(true);
      expect(hasProjectPermission(m, "manage_members")).toBe(true);
      expect(hasProjectPermission(m, "manage_questionnaires")).toBe(true);
      expect(hasProjectPermission(m, "assign_roles")).toBe(true);
    }
    expect(isPermissionBackstop("lead")).toBe(true);
    expect(isPermissionBackstop("member")).toBe(false);
  });

  it("a plain member with no grants holds nothing", () => {
    const m = member("member", NONE);
    expect(hasProjectPermission(m, "view_member_details")).toBe(false);
    expect(hasProjectPermission(m, "manage_roles")).toBe(false);
  });
});

describe("hasProjectPermission — grants on top for plain members", () => {
  it("grants a permission present on any held role", () => {
    const m = member("member", { view_member_details: true }, NONE);
    expect(hasProjectPermission(m, "view_member_details")).toBe(true);
    expect(hasProjectPermission(m, "manage_members")).toBe(false);
  });

  it("manage_roles implies assign_roles", () => {
    const m = member("member", { manage_roles: true });
    expect(hasProjectPermission(m, "assign_roles")).toBe(true);
    expect(hasProjectPermission(m, "manage_roles")).toBe(true);
  });

  it("manage_questionnaires counts as held when its scope config is present", () => {
    const m = member("member", {
      manage_questionnaires: { audienceRoles: "all", mayBlock: false },
    });
    expect(hasProjectPermission(m, "manage_questionnaires")).toBe(true);
  });
});

describe("canManageQuestionnaireAudience — scope enforced server-side", () => {
  const scopedToBurner = member("member", {
    manage_questionnaires: { audienceRoles: ["role-burner"], mayBlock: false },
  });

  it("lead/admin ignore scope entirely (backstop)", () => {
    const lead = member("lead");
    expect(
      canManageQuestionnaireAudience(lead, {
        targetRoleIds: ["anything"],
        blocking: true,
      }),
    ).toBe(true);
  });

  it("denies a member with no manage_questionnaires grant", () => {
    const m = member("member", { view_member_details: true });
    expect(
      canManageQuestionnaireAudience(m, {
        targetRoleIds: ["role-burner"],
        blocking: false,
      }),
    ).toBe(false);
  });

  it("SCOPE VIOLATION: denies targeting a role outside the allowed set", () => {
    expect(
      canManageQuestionnaireAudience(scopedToBurner, {
        targetRoleIds: ["role-crew"],
        blocking: false,
      }),
    ).toBe(false);
  });

  it("allows targeting a role within the allowed set", () => {
    expect(
      canManageQuestionnaireAudience(scopedToBurner, {
        targetRoleIds: ["role-burner"],
        blocking: false,
      }),
    ).toBe(true);
  });

  it("BLOCK VIOLATION: denies a blocking send when mayBlock is false", () => {
    expect(
      canManageQuestionnaireAudience(scopedToBurner, {
        targetRoleIds: ["role-burner"],
        blocking: true,
      }),
    ).toBe(false);
  });

  it("audienceRoles:'all' permits any target; mayBlock permits blocking", () => {
    const wide = member("member", {
      manage_questionnaires: { audienceRoles: "all", mayBlock: true },
    });
    expect(
      canManageQuestionnaireAudience(wide, {
        targetRoleIds: ["role-x", "role-y"],
        blocking: true,
      }),
    ).toBe(true);
  });

  it("unions scope across multiple granting roles", () => {
    const m = member(
      "member",
      { manage_questionnaires: { audienceRoles: ["a"], mayBlock: false } },
      { manage_questionnaires: { audienceRoles: ["b"], mayBlock: true } },
    );
    expect(
      canManageQuestionnaireAudience(m, {
        targetRoleIds: ["a", "b"],
        blocking: true,
      }),
    ).toBe(true);
    expect(
      canManageQuestionnaireAudience(m, {
        targetRoleIds: ["a", "c"],
        blocking: false,
      }),
    ).toBe(false);
  });
});

describe("captain lock", () => {
  it("captain permissions are forced to all, regardless of input", () => {
    expect(isPermissionsLockedKind("captain")).toBe(true);
    const stripped = enforceKindPermissions("captain", { view_member_details: false });
    expect(stripped).toEqual(allProjectPermissions());
  });

  it("non-captain kinds keep their supplied permissions unchanged", () => {
    const perms: ProjectPermissions = { assign_roles: true };
    expect(enforceKindPermissions("custom", perms)).toBe(perms);
    expect(enforceKindPermissions("baseline", perms)).toBe(perms);
    expect(isPermissionsLockedKind("default")).toBe(false);
  });
});
