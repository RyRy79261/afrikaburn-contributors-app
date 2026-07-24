import { describe, it, expect } from "vitest";
import {
  isOrgAuthor,
  isProjectAdmin,
  canAuthorAudience,
  canActivateAudience,
  canViewActivationResults,
  canManageProjectRoles,
  type AuthzMembership,
} from "../questionnaire-authz";
import type { AudienceSpec } from "@quagga/types";

const ORG = "g-org";
const CAMP_A = "g-camp-a";
const CAMP_B = "g-camp-b";

const staff: AuthzMembership[] = [{ groupId: ORG, role: "org_staff" }];
const god: AuthzMembership[] = [{ groupId: ORG, role: "god" }];
const orgPlainMember: AuthzMembership[] = [{ groupId: ORG, role: "member" }];
const campALead: AuthzMembership[] = [{ groupId: CAMP_A, role: "lead" }];
const campAAdmin: AuthzMembership[] = [{ groupId: CAMP_A, role: "admin" }];
const campAMember: AuthzMembership[] = [{ groupId: CAMP_A, role: "member" }];
// a god who is ALSO a plain member (not admin) of camp A
const godAndCampMember: AuthzMembership[] = [
  { groupId: ORG, role: "god" },
  { groupId: CAMP_A, role: "member" },
];

describe("structural predicates", () => {
  it("isOrgAuthor is true for god/org_staff on the org group only", () => {
    expect(isOrgAuthor(staff, ORG)).toBe(true);
    expect(isOrgAuthor(god, ORG)).toBe(true);
    expect(isOrgAuthor(orgPlainMember, ORG)).toBe(false);
    expect(isOrgAuthor(campALead, ORG)).toBe(false);
  });

  it("isProjectAdmin is true for lead/admin of that group only", () => {
    expect(isProjectAdmin(campALead, CAMP_A)).toBe(true);
    expect(isProjectAdmin(campAAdmin, CAMP_A)).toBe(true);
    expect(isProjectAdmin(campAMember, CAMP_A)).toBe(false);
    // admin of A is not admin of B
    expect(isProjectAdmin(campAAdmin, CAMP_B)).toBe(false);
  });
});

describe("canAuthorAudience / canActivateAudience", () => {
  const orgSpec: AudienceSpec = {
    kind: "org_outbound",
    selectors: ["camp_leads"],
  };
  const internalSpec: AudienceSpec = { kind: "org_internal" };
  const projectSpec: AudienceSpec = {
    kind: "project",
    groupId: CAMP_A,
    mode: "everyone",
    roleIds: [],
  };

  it("org specs require an org author", () => {
    expect(canAuthorAudience(staff, orgSpec, ORG)).toBe(true);
    expect(canAuthorAudience(staff, internalSpec, ORG)).toBe(true);
    expect(canAuthorAudience(campALead, orgSpec, ORG)).toBe(false);
    expect(canAuthorAudience(orgPlainMember, internalSpec, ORG)).toBe(false);
  });

  it("project specs require admin of that specific group", () => {
    expect(canAuthorAudience(campALead, projectSpec, ORG)).toBe(true);
    expect(canAuthorAudience(campAMember, projectSpec, ORG)).toBe(false);
    // org staff cannot author into a project they don't administer
    expect(canAuthorAudience(staff, projectSpec, ORG)).toBe(false);
  });

  it("activate shares the same gate", () => {
    expect(canActivateAudience).toBe(canAuthorAudience);
  });
});

describe("canViewActivationResults — scope never crosses", () => {
  it("org-scoped results: org authors only", () => {
    const act = { authoredScope: "org" as const, groupId: null };
    expect(canViewActivationResults(staff, act, ORG)).toBe(true);
    expect(canViewActivationResults(god, act, ORG)).toBe(true);
    expect(canViewActivationResults(campALead, act, ORG)).toBe(false);
  });

  it("group-scoped results: that project's admins only", () => {
    const act = { authoredScope: "group" as const, groupId: CAMP_A };
    expect(canViewActivationResults(campALead, act, ORG)).toBe(true);
    expect(canViewActivationResults(campAAdmin, act, ORG)).toBe(true);
    // a plain member cannot
    expect(canViewActivationResults(campAMember, act, ORG)).toBe(false);
  });

  it("a god who is not the project's admin CANNOT see its results", () => {
    const act = { authoredScope: "group" as const, groupId: CAMP_A };
    // org authority does not grant project-scoped visibility
    expect(canViewActivationResults(god, act, ORG)).toBe(false);
    expect(canViewActivationResults(godAndCampMember, act, ORG)).toBe(false);
  });

  it("another camp's admin cannot see camp A's results", () => {
    const act = { authoredScope: "group" as const, groupId: CAMP_A };
    const campBAdmin: AuthzMembership[] = [{ groupId: CAMP_B, role: "admin" }];
    expect(canViewActivationResults(campBAdmin, act, ORG)).toBe(false);
  });

  it("group-scoped activation with a null groupId denies everyone", () => {
    const act = { authoredScope: "group" as const, groupId: null };
    expect(canViewActivationResults(campALead, act, ORG)).toBe(false);
    expect(canViewActivationResults(god, act, ORG)).toBe(false);
  });
});

describe("canManageProjectRoles", () => {
  it("is the project admin gate", () => {
    expect(canManageProjectRoles(campALead, CAMP_A)).toBe(true);
    expect(canManageProjectRoles(campAMember, CAMP_A)).toBe(false);
    expect(canManageProjectRoles(staff, CAMP_A)).toBe(false);
  });
});
