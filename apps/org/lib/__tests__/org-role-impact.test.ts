import { describe, it, expect } from "vitest";
import {
  computeOrgRoleImpacts,
  noImpact,
  type AssignmentRow,
} from "../org-role-impact";

// WHAT A DELETION COSTS, tested as the sentence the dialog has to be able to
// say. Every case here is one someone will hit on the roles screen, and the
// failure mode of each is the same: a colleague quietly loses access and finds
// out by being refused.

function row(
  userId: string,
  roleId: string,
  departmentId: string | null = null,
): AssignmentRow {
  return { userId, label: `${userId}@example.com`, roleId, departmentId };
}

describe("deleting a ROLE", () => {
  it("costs nothing when nobody holds it", () => {
    const { byRole } = computeOrgRoleImpacts([row("alice", "other")]);
    expect(byRole.get("lonely")).toBeUndefined();
    expect(noImpact()).toEqual({ people: 0, leftWithNothing: 0, labels: [] });
  });

  it("counts and NAMES everyone holding it", () => {
    const { byRole } = computeOrgRoleImpacts([
      row("alice", "reviewers"),
      row("ren", "reviewers"),
    ]);
    expect(byRole.get("reviewers")).toEqual({
      people: 2,
      leftWithNothing: 2,
      labels: ["alice@example.com", "ren@example.com"],
    });
  });

  it("separates the people it strips bare from the people who keep something", () => {
    // Alice also holds Org staff; Ren holds only the doomed role.
    const { byRole } = computeOrgRoleImpacts([
      row("alice", "reviewers"),
      row("alice", "org_staff"),
      row("ren", "reviewers"),
    ]);
    const impact = byRole.get("reviewers");
    expect(impact?.people).toBe(2);
    expect(impact?.leftWithNothing).toBe(1);
  });

  it("counts a person once, however many of the doomed roles they hold", () => {
    const { byDepartment } = computeOrgRoleImpacts([
      row("alice", "suppliers.lead", "suppliers"),
      row("alice", "suppliers.member", "suppliers"),
    ]);
    expect(byDepartment.get("suppliers")).toEqual({
      people: 1,
      leftWithNothing: 1,
      labels: ["alice@example.com"],
    });
  });
});

describe("deleting a DEPARTMENT", () => {
  it("takes every role scoped to it — the seeded pair AND custom ones", () => {
    const { byDepartment } = computeOrgRoleImpacts([
      row("alice", "suppliers.lead", "suppliers"),
      row("ren", "suppliers.vetting", "suppliers"), // a custom scoped role
      row("jabu", "safety.member", "safety"),
    ]);
    const suppliers = byDepartment.get("suppliers");
    expect(suppliers?.people).toBe(2);
    expect(suppliers?.labels).toEqual(["alice@example.com", "ren@example.com"]);
    // Another department's holders are untouched by this deletion.
    expect(suppliers?.labels).not.toContain("jabu@example.com");
  });

  it("leaves an org-wide role behind, so its holder is not stripped bare", () => {
    const { byDepartment } = computeOrgRoleImpacts([
      row("alice", "suppliers.lead", "suppliers"),
      row("alice", "org_staff", null),
      row("ren", "suppliers.member", "suppliers"),
    ]);
    const suppliers = byDepartment.get("suppliers");
    expect(suppliers?.people).toBe(2);
    // Alice keeps Org staff; Ren keeps nothing.
    expect(suppliers?.leftWithNothing).toBe(1);
  });

  it("reports no department when every role is org-wide", () => {
    const { byDepartment } = computeOrgRoleImpacts([row("alice", "org_staff")]);
    expect(byDepartment.size).toBe(0);
  });

  it("is stable in order, so the dialog does not shuffle between renders", () => {
    const rows = [
      row("zoe", "suppliers.lead", "suppliers"),
      row("alice", "suppliers.lead", "suppliers"),
    ];
    expect(
      computeOrgRoleImpacts(rows).byDepartment.get("suppliers")?.labels,
    ).toEqual(["alice@example.com", "zoe@example.com"]);
  });
});
