import { describe, it, expect } from "vitest";
import type { ProjectAudience } from "@quagga/types";
import { resolveAudience, type AudienceContext } from "../audience";

// The project audience's NARROWING filters (camp onboarding, epic #54):
// `tenure` and `structuralRoles`. They may only ever SUBTRACT — that is what
// keeps the existing send-scope check (on mode/roleIds) sufficient — and an
// audience without them must resolve exactly as it always did.

const G = "g-camp";
const BASELINE = "r-baseline";
const KITCHEN = "r-kitchen";

const ctx = (withTenure: boolean): AudienceContext => ({
  editionId: "e",
  orgGroupId: "",
  groups: [],
  registrations: [],
  bios: [],
  memberships: [
    { membershipId: "m-lead", userId: "lead", groupId: G, role: "lead" as const },
    { membershipId: "m-new", userId: "newbie", groupId: G, role: "member" as const },
    { membershipId: "m-vet", userId: "vet", groupId: G, role: "member" as const },
  ].map((m) =>
    withTenure
      ? {
          ...m,
          tenure: m.userId === "newbie" ? ("new" as const) : ("returning" as const),
        }
      : m,
  ),
  roleAssignments: [
    { membershipId: "m-lead", projectRoleId: KITCHEN },
    { membershipId: "m-vet", projectRoleId: KITCHEN },
  ],
  projectRoles: [
    { id: BASELINE, groupId: G, kind: "baseline", officerKey: null },
    { id: KITCHEN, groupId: G, kind: "custom", officerKey: null },
  ],
});

const base: ProjectAudience = {
  kind: "project",
  groupId: G,
  mode: "everyone",
  roleIds: [],
};

describe("project audience narrowing", () => {
  it("without filters resolves exactly as before (leads included)", () => {
    expect(resolveAudience(base, ctx(false))).toEqual(["lead", "newbie", "vet"]);
  });

  it("a tenure filter FAILS CLOSED when tenure is unknown", () => {
    expect(
      resolveAudience({ ...base, tenure: ["new", "returning"] }, ctx(false)),
    ).toEqual([]);
  });

  it("narrows the baseline (whole-camp) shortcut too", () => {
    // Targeting the baseline role is "everyone" — it must still be narrowed.
    expect(
      resolveAudience(
        {
          ...base,
          mode: "roles",
          roleIds: [BASELINE],
          structuralRoles: ["member"],
          tenure: ["new"],
        },
        ctx(true),
      ),
    ).toEqual(["newbie"]);
  });

  it("combines with a custom-role filter by intersection", () => {
    expect(
      resolveAudience(
        { ...base, mode: "roles", roleIds: [KITCHEN], structuralRoles: ["member"] },
        ctx(true),
      ),
    ).toEqual(["vet"]);
    expect(
      resolveAudience(
        { ...base, mode: "roles", roleIds: [KITCHEN], tenure: ["new"] },
        ctx(true),
      ),
    ).toEqual([]);
  });

  it("never reaches another camp's members", () => {
    const c = ctx(true);
    c.memberships = [
      ...c.memberships,
      { membershipId: "x", userId: "stranger", groupId: "g-other", role: "member", tenure: "new" },
    ];
    expect(
      resolveAudience({ ...base, tenure: ["new"], structuralRoles: ["member"] }, c),
    ).toEqual(["newbie"]);
  });
});
