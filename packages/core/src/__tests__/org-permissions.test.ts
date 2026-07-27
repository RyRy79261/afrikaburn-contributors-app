import { describe, it, expect } from "vitest";
import {
  ORG_RANKS,
  ORG_CAPABILITIES,
  ORG_RANK_LABELS,
  GRANTABLE_ORG_CAPABILITIES,
  SYSTEM_MANAGER_ONLY_CAPABILITIES,
  DEPARTMENT_SCOPED_CAPABILITIES,
  isDepartmentScopedCapability,
  orgCan,
  orgCanIn,
  summarizeOrgActor,
  ORG_CAPABILITY_CONSEQUENCES,
  ORG_CAPABILITY_DESCRIPTIONS,
  ORG_CAPABILITY_LABELS,
  DEPARTMENT_SCOPE_NOTE,
  orgCapabilitiesFor,
  orgCapabilityRefusal,
  orgRankFromRole,
  isSystemManager,
  isDepartmentScopedGrant,
  departmentsGranting,
  grantScopeClause,
  canReadPersonalInformationAnywhere,
  canReadPersonalInformationIn,
  orgCanInDomain,
  reachesEveryDepartment,
  isRankCarveOut,
  ENGINEER_RANK_CARVE_OUTS,
  sanitizeOrgPermissions,
  orgPermissionsFromKeys,
  grantedOrgCapabilities,
  type OrgActor,
  type OrgCapability,
  type OrgRank,
  type OrgRoleGrant,
} from "../org-permissions";
import {
  SEEDED_ORG_ROLES,
  departmentRoleRows,
  DEPARTMENT_LEAD_PERMISSIONS,
  DEPARTMENT_MEMBER_PERMISSIONS,
} from "../org-roles";
import {
  buildDomainOwnership,
  ORG_DOMAINS,
  type DomainOwnership,
  type OrgDomain,
} from "../org-domains";
import { canViewMedicalNotes, isOrgStaffRole } from "../medical-access";
import { ORG_APP_ROLES, MembershipRole, type OrgPermissions } from "@quagga/types";

/** A role grant, defaulting to org-wide + nothing granted. */
function role(
  key: string,
  permissions: OrgPermissions,
  departmentId: string | null = null,
): OrgRoleGrant {
  return {
    id: `role-${key}`,
    key,
    name: key,
    kind: "custom",
    departmentId,
    permissions,
  };
}

/**
 * THE DEPLOYMENT MOST OF THESE TESTS RUN AGAINST — a Suppliers department that
 * owns the two supply-related domains, and a Theme camps department that owns
 * registrations. Everything else is unowned, which is the state a real console
 * spends its first week in and the one most likely to be got wrong.
 */
const SUPPLIERS = "dept-suppliers";
const CAMPS = "dept-theme-camps";
const SAFETY = "dept-safety";

const OWNERSHIP: DomainOwnership = buildDomainOwnership([
  { domain: "suppliers", departmentId: SUPPLIERS, departmentName: "Suppliers" },
  {
    domain: "supplier_documents",
    departmentId: SUPPLIERS,
    departmentName: "Suppliers",
  },
  {
    domain: "registrations",
    departmentId: CAMPS,
    departmentName: "Theme camps",
  },
]);

/** An actor: a door, zero or more roles, and the deployment's ownership map. */
function actor(
  rank: OrgRank,
  roles: OrgRoleGrant[] = [],
  domains: DomainOwnership = OWNERSHIP,
): OrgActor {
  return { rank, roles, domains };
}

/** The seeded role of a given key, as a grant. */
function seeded(key: "org_staff" | "engineer"): OrgRoleGrant {
  const row = SEEDED_ORG_ROLES.find((r) => r.key === key);
  if (!row) throw new Error(`no seeded role ${key}`);
  return {
    id: `seed-${key}`,
    key,
    name: row.name,
    kind: "system",
    departmentId: null,
    permissions: row.permissions,
  };
}

describe("the console door", () => {
  it("is exactly the membership roles that may enter the console", () => {
    expect([...ORG_RANKS].sort()).toEqual([...ORG_APP_ROLES].sort());
  });

  it("maps a membership role to a rank, and refuses project roles", () => {
    expect(orgRankFromRole("god")).toBe("god");
    expect(orgRankFromRole("org_staff")).toBe("org_staff");
    expect(orgRankFromRole("engineer")).toBe("engineer");
    expect(orgRankFromRole("lead")).toBeNull();
    expect(orgRankFromRole("admin")).toBeNull();
    expect(orgRankFromRole("member")).toBeNull();
    expect(orgRankFromRole(null)).toBeNull();
    expect(orgRankFromRole(undefined)).toBeNull();
  });

  it("keeps `god` as the STORED value while presenting it as System manager", () => {
    // The deliberate inconsistency (see the module header): renaming the enum
    // would migrate live rows and re-cut the GOD_EMAILS bootstrap for a label.
    expect(MembershipRole.options).toContain("god");
    expect(MembershipRole.options).not.toContain("system_manager");
    expect(ORG_RANK_LABELS.god).toBe("System manager");
  });

  it("OPENS THE DOOR AND NOTHING ELSE — a rank with no roles can do nothing", () => {
    // The single most important property of this change: `org_staff` used to BE
    // a set of rights. It is now a door, and rights come from roles.
    for (const rank of ["org_staff", "engineer"] as const) {
      for (const capability of ORG_CAPABILITIES) {
        expect(
          orgCan(actor(rank), capability),
          `${rank} with no roles should not hold ${capability}`,
        ).toBe(false);
      }
    }
  });
});

describe("THE RESOLUTION MATRIX, longhand", () => {
  // Written out rather than derived: this table is what a reviewer reads when
  // they ask "what can this person actually do?".
  //
  // The three columns are the three ways an actor gets a capability:
  //   · the god anchor         — everything, always, whatever any row says;
  //   · the seeded Org staff   — the rights org_staff held as a hardcoded rank;
  //   · the seeded Engineer    — the rights engineer held as a hardcoded rank.
  const MATRIX: Record<
    | "god"
    | "seeded_org_staff"
    | "seeded_engineer"
    | "widened_engineer"
    | "no_roles",
    Record<OrgCapability, boolean>
  > = {
    god: {
      read: true,
      read_personal_information: true,
      write: true,
      delete: true,
      manage_camp_categories: true,
      manage_accounts: true,
      read_system: true,
    },
    seeded_org_staff: {
      read: true,
      read_personal_information: true,
      write: true,
      delete: true,
      manage_camp_categories: false,
      manage_accounts: false,
      read_system: false,
    },
    seeded_engineer: {
      read: true,
      read_personal_information: false,
      write: true,
      delete: false,
      manage_camp_categories: false,
      manage_accounts: false,
      read_system: true,
    },
    // THE CEILING, stated as a row rather than a footnote: an engineer holding
    // a role that grants EVERYTHING grantable still resolves neither personal
    // information nor deletion. Reach widened; depth did not.
    widened_engineer: {
      read: true,
      read_personal_information: false,
      write: true,
      delete: false,
      manage_camp_categories: true,
      manage_accounts: false,
      read_system: true,
    },
    no_roles: {
      read: false,
      read_personal_information: false,
      write: false,
      delete: false,
      manage_camp_categories: false,
      manage_accounts: false,
      read_system: false,
    },
  };

  const ACTORS: Record<keyof typeof MATRIX, OrgActor> = {
    god: actor("god"),
    seeded_org_staff: actor("org_staff", [seeded("org_staff")]),
    seeded_engineer: actor("engineer", [seeded("engineer")]),
    widened_engineer: actor("engineer", [
      role("everything", orgPermissionsFromKeys([...ORG_CAPABILITIES])),
    ]),
    no_roles: actor("org_staff"),
  };

  for (const name of Object.keys(MATRIX) as (keyof typeof MATRIX)[]) {
    for (const capability of ORG_CAPABILITIES) {
      const expected = MATRIX[name][capability];
      it(`${name} ${expected ? "holds" : "is refused"} ${capability}`, () => {
        expect(orgCan(ACTORS[name], capability)).toBe(expected);
      });
    }
  }

  it("MIGRATES the old ranks unchanged — engineer keeps read+write, no PI, no delete", () => {
    // The rights are the same rights; only the mechanism moved. If this test
    // ever needs editing, the change of mechanism has also changed access.
    const engineer = ACTORS.seeded_engineer;
    expect(orgCan(engineer, "read")).toBe(true);
    expect(orgCan(engineer, "write")).toBe(true);
    expect(orgCan(engineer, "read_personal_information")).toBe(false);
    expect(orgCan(engineer, "delete")).toBe(false);

    const staff = ACTORS.seeded_org_staff;
    expect(orgCan(staff, "read")).toBe(true);
    expect(orgCan(staff, "read_personal_information")).toBe(true);
    expect(orgCan(staff, "write")).toBe(true);
    expect(orgCan(staff, "delete")).toBe(true);
  });

  it("resolves the UNION of several roles, not the first or the strongest", () => {
    const a = actor("org_staff", [
      role("reader", { read: true }),
      role("deleter", { delete: true }),
      role("nothing", {}),
    ]);
    expect(orgCan(a, "read")).toBe(true);
    expect(orgCan(a, "delete")).toBe(true);
    expect(orgCan(a, "write")).toBe(false);
    expect([...orgCapabilitiesFor(a)].sort()).toEqual(["delete", "read"]);
  });

  it("fails closed for a missing actor", () => {
    for (const capability of ORG_CAPABILITIES) {
      expect(orgCan(null, capability)).toBe(false);
      expect(orgCan(undefined, capability)).toBe(false);
      expect(orgCanIn(null, capability, null)).toBe(false);
    }
  });

  it("fails closed for junk in a permissions object", () => {
    // Only a literal `true` grants. A truthy string, a 1, or a missing key are
    // all refusals — the row could have been written by anything.
    const junk = {
      read: "yes",
      write: 1,
      delete: null,
    } as unknown as OrgPermissions;
    const a = actor("org_staff", [role("junk", junk)]);
    for (const capability of ORG_CAPABILITIES) {
      expect(orgCan(a, capability)).toBe(false);
    }
  });

  it("lists an actor's capabilities consistently with orgCan", () => {
    const a = actor("engineer", [seeded("engineer"), role("d", { delete: true })]);
    const listed = new Set(orgCapabilitiesFor(a));
    for (const capability of ORG_CAPABILITIES) {
      expect(listed.has(capability)).toBe(orgCan(a, capability));
    }
  });

  it("proves there is NO LADDER — role sets need not nest", () => {
    const staff = actor("org_staff", [seeded("org_staff")]);
    const engineer = actor("engineer", [seeded("engineer")]);
    const engineerOnly = ORG_CAPABILITIES.filter(
      (c) => orgCan(engineer, c) && !orgCan(staff, c),
    );
    const staffOnly = ORG_CAPABILITIES.filter(
      (c) => orgCan(staff, c) && !orgCan(engineer, c),
    );
    expect(engineerOnly).toEqual(["read_system"]);
    expect(staffOnly).toEqual(["read_personal_information", "delete"]);
  });

  it("THE ENGINEER TIER: broader in reach, narrower in depth, not a superset", () => {
    // Ryan: "an engineer is still org staff but a step up" — and the step up is
    // REACH. `ENGINEER_RANK_CARVE_OUTS` is what stops it also being depth, and
    // this test exists so that deleting the carve-out fails loudly instead of
    // quietly handing every engineer every burner's contact details.
    expect([...ENGINEER_RANK_CARVE_OUTS].sort()).toEqual(
      ["delete", "read_personal_information"].sort(),
    );

    const engineer = actor("engineer", [
      role("everything", orgPermissionsFromKeys([...ORG_CAPABILITIES])),
    ]);
    const staff = actor("org_staff", [
      role("everything", orgPermissionsFromKeys([...ORG_CAPABILITIES])),
    ]);

    // Same roles. The org_staff account can do two things the engineer cannot,
    // which is precisely what "not a strict superset" means.
    const staffOnly = ORG_CAPABILITIES.filter(
      (c) => orgCan(staff, c) && !orgCan(engineer, c),
    );
    expect(staffOnly).toEqual(["read_personal_information", "delete"]);

    // REACH: the engineer is in every department for everything else, so a
    // department-scoped role does not confine them…
    const scopedEngineer = actor("engineer", [
      role("camps.member", { read: true, write: true }, CAMPS),
    ]);
    expect(reachesEveryDepartment(scopedEngineer, "write")).toBe(true);
    expect(orgCanIn(scopedEngineer, "write", SUPPLIERS)).toBe(true);
    expect(orgCanIn(scopedEngineer, "write", null)).toBe(true);
    // …and the console never tells them a grant of theirs is confined.
    expect(isDepartmentScopedGrant(scopedEngineer, "write")).toBe(false);

    // DEPTH: the reach never extends to the carve-outs, in any department.
    expect(reachesEveryDepartment(engineer, "delete")).toBe(false);
    expect(reachesEveryDepartment(engineer, "read_personal_information")).toBe(
      false,
    );
    for (const capability of ENGINEER_RANK_CARVE_OUTS) {
      expect(isRankCarveOut(engineer, capability)).toBe(true);
      expect(orgCan(engineer, capability)).toBe(false);
      expect(orgCanIn(engineer, capability, SUPPLIERS)).toBe(false);
      expect(orgCanIn(engineer, capability, null)).toBe(false);
      for (const domain of ORG_DOMAINS) {
        expect(orgCanInDomain(engineer, capability, domain)).toBe(false);
      }
      // …and it is the RANK, not the role: org_staff with the same role holds it.
      expect(isRankCarveOut(staff, capability)).toBe(false);
      expect(orgCan(staff, capability)).toBe(true);
    }
  });

  it("a System manager is above the carve-outs, not subject to them", () => {
    // The anchor outranks every rule in this module, including this one.
    const anchored = actor("god");
    for (const capability of ENGINEER_RANK_CARVE_OUTS) {
      expect(orgCan(anchored, capability)).toBe(true);
      for (const domain of ORG_DOMAINS) {
        expect(orgCanInDomain(anchored, capability, domain)).toBe(true);
      }
    }
  });
});

describe("the System manager anchor", () => {
  it("is `memberships.role = god` and nothing else", () => {
    expect(isSystemManager(actor("god"))).toBe(true);
    expect(isSystemManager(actor("org_staff"))).toBe(false);
    expect(isSystemManager(actor("engineer"))).toBe(false);
    expect(isSystemManager(null)).toBe(false);
    // Not a permission bit: a role that claims everything is still not one.
    const impostor = actor("org_staff", [
      role("impostor", orgPermissionsFromKeys([...ORG_CAPABILITIES])),
    ]);
    expect(isSystemManager(impostor)).toBe(false);
  });

  it("LOCKOUT SCENARIO: a god with zero roles still holds everything", () => {
    // The rail that makes editable permissions survivable. Someone empties the
    // roles table, or removes every assignment; the System manager can still
    // open the console and put it back.
    const stranded = actor("god", []);
    for (const capability of ORG_CAPABILITIES) {
      expect(orgCan(stranded, capability)).toBe(true);
      expect(orgCanIn(stranded, capability, "any-department")).toBe(true);
      expect(orgCanIn(stranded, capability, null)).toBe(true);
    }
  });

  it("LOCKOUT SCENARIO: a god holding a role that grants nothing still holds everything", () => {
    // Worse than empty: an assignment that LOOKS like a downgrade. The role's
    // permissions are irrelevant to a god — the anchor is the membership row.
    const nerfed = actor("god", [role("nothing", {})]);
    for (const capability of ORG_CAPABILITIES) {
      expect(orgCan(nerfed, capability)).toBe(true);
    }
  });

  it("LOCKOUT SCENARIO: `manage_accounts` cannot be granted to any role, ever", () => {
    // The door to editing rights. If a role could carry it, a System manager
    // could grant the ability to grant abilities and the "only a System manager
    // manages roles" rail would last exactly one edit.
    expect(SYSTEM_MANAGER_ONLY_CAPABILITIES).toContain("manage_accounts");
    expect(GRANTABLE_ORG_CAPABILITIES).not.toContain("manage_accounts");

    // Even a hand-written database row does not work: the resolver refuses it
    // independently of the write path that would have stripped it.
    const crafted = actor("org_staff", [
      role("crafted", { manage_accounts: true } as OrgPermissions),
    ]);
    expect(orgCan(crafted, "manage_accounts")).toBe(false);
    expect(orgCanIn(crafted, "manage_accounts", "dept")).toBe(false);

    // …and the write path strips it too, so it never gets stored.
    expect(
      sanitizeOrgPermissions({ manage_accounts: true, read: true }),
    ).toEqual({ read: true });
    expect(orgPermissionsFromKeys(["manage_accounts", "write"])).toEqual({
      write: true,
    });

    // Only the anchor holds it.
    expect(orgCan(actor("god"), "manage_accounts")).toBe(true);
  });
});

describe("department scoping — what a department OWNS is what it reaches", () => {
  const suppliersLead = actor("org_staff", [
    role("suppliers.lead", DEPARTMENT_LEAD_PERMISSIONS, SUPPLIERS),
  ]);
  const campsLead = actor("org_staff", [
    role("camps.lead", DEPARTMENT_LEAD_PERMISSIONS, CAMPS),
  ]);
  const orgWide = actor("org_staff", [seeded("org_staff")]);

  it("names BOTH sharp capabilities as department-scoped, and nothing else", () => {
    // `read_personal_information` joined `delete` on 27 Jul 2026: a suppliers
    // lead reads supply-related details and not a theme camp's members.
    // `read`/`write` are deliberately absent — a department member whose
    // ordinary work resolved to nothing would be a role that looks granted and
    // does nothing.
    expect([...DEPARTMENT_SCOPED_CAPABILITIES].sort()).toEqual([
      "delete",
      "read_personal_information",
    ]);
    for (const capability of ORG_CAPABILITIES) {
      expect(isDepartmentScopedCapability(capability)).toBe(
        capability === "delete" || capability === "read_personal_information",
      );
    }
  });

  it("RYAN'S RULE: a suppliers lead reads supply-related details", () => {
    expect(canReadPersonalInformationIn(suppliersLead, "suppliers")).toBe(true);
    expect(
      canReadPersonalInformationIn(suppliersLead, "supplier_documents"),
    ).toBe(true);
    expect(orgCanInDomain(suppliersLead, "delete", "suppliers")).toBe(true);
  });

  it("…AND NOT a theme camp's members' details — the thing this change fixes", () => {
    // The whole correction, as one assertion. Before departments owned domains,
    // `read_personal_information` was global and this returned true.
    expect(canReadPersonalInformationIn(suppliersLead, "registrations")).toBe(
      false,
    );
    expect(orgCanInDomain(suppliersLead, "delete", "registrations")).toBe(false);
    // …and symmetrically, so the rule is a boundary rather than a special case.
    expect(canReadPersonalInformationIn(campsLead, "registrations")).toBe(true);
    expect(canReadPersonalInformationIn(campsLead, "suppliers")).toBe(false);
  });

  it("a domain NOBODY owns is reachable only by an org-wide role", () => {
    // The state a fresh deployment is in, and the fail-closed direction.
    for (const domain of ["bulletins", "accounts", "audit"] as OrgDomain[]) {
      expect(canReadPersonalInformationIn(suppliersLead, domain)).toBe(false);
      expect(orgCanInDomain(suppliersLead, "delete", domain)).toBe(false);
      expect(canReadPersonalInformationIn(orgWide, domain)).toBe(true);
      expect(orgCanInDomain(orgWide, "delete", domain)).toBe(true);
    }
  });

  it("a lead of a department that owns NOTHING reaches nothing", () => {
    // Safety exists, has a lead role with every sharp right, and owns no part
    // of the console. That is a grant that looks real and is not — which is why
    // the console says so rather than leaving it to be discovered.
    const safetyLead = actor("org_staff", [
      role("safety.lead", DEPARTMENT_LEAD_PERMISSIONS, SAFETY),
    ]);
    for (const domain of ORG_DOMAINS) {
      expect(canReadPersonalInformationIn(safetyLead, domain)).toBe(false);
      expect(orgCanInDomain(safetyLead, "delete", domain)).toBe(false);
    }
    // …while their ordinary work is untouched: read and write are not scoped.
    expect(orgCan(safetyLead, "read")).toBe(true);
    expect(orgCan(safetyLead, "write")).toBe(true);
  });

  it("a guard that names NO domain resolves as unfiled — only org-wide passes", () => {
    // The fail-closed default that stops a forgetful call site handing a
    // departmental role the whole console.
    expect(orgCanInDomain(suppliersLead, "delete", null)).toBe(false);
    expect(orgCanInDomain(suppliersLead, "read_personal_information", null)).toBe(
      false,
    );
    expect(orgCanInDomain(orgWide, "delete", null)).toBe(true);
  });

  it("an org-wide role reaches every domain, owned or not", () => {
    for (const domain of ORG_DOMAINS) {
      expect(orgCanInDomain(orgWide, "delete", domain)).toBe(true);
      expect(canReadPersonalInformationIn(orgWide, domain)).toBe(true);
    }
  });

  it("`orgCan` answers 'anywhere' — which is why guards must ask by domain", () => {
    // The trap this test exists to document: the affordance question and the
    // action question are different questions, and only one of them is scoped.
    expect(orgCan(suppliersLead, "delete")).toBe(true);
    expect(canReadPersonalInformationAnywhere(suppliersLead)).toBe(true);
    expect(orgCanInDomain(suppliersLead, "delete", "registrations")).toBe(false);
    expect(canReadPersonalInformationIn(suppliersLead, "registrations")).toBe(
      false,
    );
  });

  it("a member role in the same department still cannot delete or read details", () => {
    const member = actor("org_staff", [
      role("suppliers.member", DEPARTMENT_MEMBER_PERMISSIONS, SUPPLIERS),
    ]);
    expect(orgCanInDomain(member, "delete", "suppliers")).toBe(false);
    expect(canReadPersonalInformationIn(member, "suppliers")).toBe(false);
    expect(orgCan(member, "write")).toBe(true);
  });

  it("unions scopes across roles — two departments, both reachable", () => {
    const both = actor("org_staff", [
      role("suppliers.lead", { delete: true }, SUPPLIERS),
      role("camps.lead", { delete: true }, CAMPS),
    ]);
    expect(orgCanInDomain(both, "delete", "suppliers")).toBe(true);
    expect(orgCanInDomain(both, "delete", "registrations")).toBe(true);
    expect(orgCanInDomain(both, "delete", "bulletins")).toBe(false);
    expect([...departmentsGranting(both, "delete")].sort()).toEqual(
      [CAMPS, SUPPLIERS].sort(),
    );
  });

  it("names a scoped grant as scoped, so the console can say so out loud", () => {
    expect(isDepartmentScopedGrant(suppliersLead, "delete")).toBe(true);
    expect(isDepartmentScopedGrant(orgWide, "delete")).toBe(false);
    expect(isDepartmentScopedGrant(actor("god"), "delete")).toBe(false);
    expect(departmentsGranting(suppliersLead, "delete")).toEqual([SUPPLIERS]);
    expect(departmentsGranting(orgWide, "delete")).toEqual([]);
  });

  it("resolves by DEPARTMENT ID under the hood, so ownership can be re-assigned", () => {
    // Move suppliers to Theme camps and the same roles resolve differently with
    // no role edit at all — which is the point of ownership being data.
    const moved = buildDomainOwnership([
      { domain: "suppliers", departmentId: CAMPS, departmentName: "Theme camps" },
    ]);
    const lead = actor(
      "org_staff",
      [role("suppliers.lead", DEPARTMENT_LEAD_PERMISSIONS, SUPPLIERS)],
      moved,
    );
    expect(canReadPersonalInformationIn(lead, "suppliers")).toBe(false);
    expect(orgCanIn(lead, "delete", SUPPLIERS)).toBe(true); // still by id
    expect(orgCanInDomain(lead, "delete", "suppliers")).toBe(false); // …but not here
  });

  it("seeds a department's LEAD scoped to it and a MEMBER that cannot delete", () => {
    const rows = departmentRoleRows({
      id: SUPPLIERS,
      key: "suppliers",
      name: "Suppliers",
    });
    expect(rows.map((r) => r.key)).toEqual([
      "dept.suppliers.lead",
      "dept.suppliers.member",
    ]);
    for (const row of rows) {
      expect(row.kind).toBe("system");
      expect(row.departmentId).toBe(SUPPLIERS);
    }
    expect(rows[0]?.permissions.delete).toBe(true);
    expect(rows[0]?.permissions.read_personal_information).toBe(true);
    expect(rows[1]?.permissions.delete).toBeUndefined();
    expect(rows[1]?.permissions.read_personal_information).toBeUndefined();
  });
});

describe("personal information", () => {
  it("is a role grant now — the seeded Engineer does not hold it", () => {
    expect(
      canReadPersonalInformationAnywhere(actor("engineer", [seeded("engineer")])),
    ).toBe(false);
    expect(
      canReadPersonalInformationAnywhere(
        actor("org_staff", [seeded("org_staff")]),
      ),
    ).toBe(true);
  });

  it("CANNOT be granted to an ENGINEER-RANKED account, and that is deliberate", () => {
    // This test was the exact opposite before 27 Jul 2026, when the rank
    // forbade nothing and only the seeded row withheld personal information.
    // Ryan's tier correction made the engineer's REACH universal, and a
    // universal reach with no ceiling is one role assignment away from every
    // burner's details in every department at once. So the carve-out moved from
    // "what the seeded row happens to say" to "what the rank refuses".
    //
    // The cost, stated: an engineer who genuinely needs people's details cannot
    // be given them by editing a role. They need the org_staff door. That is the
    // trade, and it is the safe direction of it.
    const widened = actor("engineer", [
      role("engineer", {
        read: true,
        write: true,
        read_personal_information: true,
      }),
    ]);
    expect(canReadPersonalInformationAnywhere(widened)).toBe(false);
    for (const domain of ORG_DOMAINS) {
      expect(canReadPersonalInformationIn(widened, domain)).toBe(false);
    }
    expect(
      canViewMedicalNotes({
        isSelf: false,
        actorOrgRole: "engineer",
        actorOrgPersonalInformation: canReadPersonalInformationIn(
          widened,
          "registrations",
        ),
        actorLeadCampIds: [],
        subjectCampIds: [],
      }),
    ).toBe(false);

    // The same ROLE on an org_staff account does grant it — the ceiling is the
    // rank, not the row, and the role editor is not lying to anyone.
    const staff = actor("org_staff", [
      role("engineer", {
        read: true,
        write: true,
        read_personal_information: true,
      }),
    ]);
    expect(canReadPersonalInformationAnywhere(staff)).toBe(true);
  });

  it("keeps medical and the console matrix answering together, PER DOMAIN", () => {
    // Two modules, one answer. `medical-access` decides medical independently of
    // this resolver, so this asserts they agree instead of assuming it — and
    // agrees about the DOMAIN too: medical notes on a camp member are
    // `registrations`, so a suppliers lead is refused them.
    const engineer = actor("engineer", [seeded("engineer")]);
    const suppliersLead = actor("org_staff", [
      role("suppliers.lead", DEPARTMENT_LEAD_PERMISSIONS, SUPPLIERS),
    ]);
    for (const a of [engineer, suppliersLead]) {
      expect(
        canViewMedicalNotes({
          isSelf: false,
          actorOrgRole: a.rank,
          actorOrgPersonalInformation: canReadPersonalInformationIn(
            a,
            "registrations",
          ),
          actorLeadCampIds: [],
          subjectCampIds: [],
        }),
      ).toBe(false);
    }

    // The camps lead, whose department owns registrations, does see them.
    const campsLead = actor("org_staff", [
      role("camps.lead", DEPARTMENT_LEAD_PERMISSIONS, CAMPS),
    ]);
    expect(
      canViewMedicalNotes({
        isSelf: false,
        actorOrgRole: "org_staff",
        actorOrgPersonalInformation: canReadPersonalInformationIn(
          campsLead,
          "registrations",
        ),
        actorLeadCampIds: [],
        subjectCampIds: [],
      }),
    ).toBe(true);
  });

  it("LOCKOUT SCENARIO: the console DOOR alone never grants medical notes", () => {
    // An org_staff membership with no roles used to see medical notes by rank.
    // It must not any more, or the door would still be the tier.
    expect(
      canViewMedicalNotes({
        isSelf: false,
        actorOrgRole: "org_staff",
        actorOrgPersonalInformation: false,
        actorLeadCampIds: [],
        subjectCampIds: [],
      }),
    ).toBe(false);
    // The System manager anchor still does, always.
    expect(
      canViewMedicalNotes({
        isSelf: false,
        actorOrgRole: "god",
        actorOrgPersonalInformation: false,
        actorLeadCampIds: [],
        subjectCampIds: [],
      }),
    ).toBe(true);
    // The subject always wins.
    expect(
      canViewMedicalNotes({
        isSelf: true,
        actorOrgRole: "engineer",
        actorLeadCampIds: [],
        subjectCampIds: [],
      }),
    ).toBe(true);
  });

  it("still recognises the org door for what it is", () => {
    expect(isOrgStaffRole("god")).toBe(true);
    expect(isOrgStaffRole("org_staff")).toBe(true);
    expect(isOrgStaffRole("engineer")).toBe(false);
  });
});

describe("permissions objects", () => {
  it("round-trip through keys, dropping the ungrantable", () => {
    const perms = orgPermissionsFromKeys(["read", "write", "delete"]);
    expect(grantedOrgCapabilities(perms)).toEqual(["read", "write", "delete"]);
    expect(grantedOrgCapabilities(null)).toEqual([]);
    expect(grantedOrgCapabilities({})).toEqual([]);
  });

  it("sanitize drops unknown keys and non-true values", () => {
    const dirty = {
      read: true,
      write: false,
      delete: "true",
      nonsense: true,
    } as unknown as OrgPermissions;
    expect(sanitizeOrgPermissions(dirty)).toEqual({ read: true });
    expect(sanitizeOrgPermissions(null)).toEqual({});
  });
});

describe("refusals", () => {
  const engineer = actor("engineer", [seeded("engineer")]);

  it("say what is missing and who can add it", () => {
    expect(orgCapabilityRefusal(engineer, "delete")).toMatch(/system manager/i);
    expect(orgCapabilityRefusal(engineer, "read_personal_information")).toMatch(
      /personal information/i,
    );
    expect(orgCapabilityRefusal(engineer, "manage_camp_categories")).toMatch(
      /system manager/i,
    );
    expect(orgCapabilityRefusal(engineer, "manage_accounts")).toMatch(
      /not grantable/i,
    );
  });

  it("tell an account with NO roles the honest thing", () => {
    // The fail-closed state has a specific, actionable explanation rather than
    // the generic "your roles don't include this" — because they have no roles.
    const fresh = actor("org_staff");
    expect(orgCapabilityRefusal(fresh, "read")).toMatch(/no org roles/i);
    expect(orgCapabilityRefusal(fresh, "read")).toMatch(/accounts screen/i);
  });

  it("explain a department-scoped refusal as scope, not absence — and TRUTHFULLY", () => {
    // Three different refusals, because there are three different reasons and
    // the old copy told the same (usually false) one for all of them.
    const scoped = actor("org_staff", [
      role("suppliers.lead", { delete: true }, SUPPLIERS),
    ]);

    // 1. Owned by someone else — name them, so they know who to ask.
    const elsewhere = orgCapabilityRefusal(scoped, "delete", "registrations");
    expect(elsewhere).toMatch(/own department/i);
    expect(elsewhere).toMatch(/Theme camps/);

    // 2. Owned by nobody — the honest reason, not "belongs to another".
    const unowned = orgCapabilityRefusal(scoped, "delete", "bulletins");
    expect(unowned).toMatch(/not owned by any department/i);
    expect(unowned).not.toMatch(/belongs to (Suppliers|Theme camps)/);

    // 3. The guard named no domain at all.
    expect(orgCapabilityRefusal(scoped, "delete")).toMatch(
      /did not say which part of the console/i,
    );
  });

  it("tell an ENGINEER the truth: it is the rank, not a missing role", () => {
    // Sending an engineer to ask for a role edit that cannot work would waste
    // two people's afternoon, so the carve-out refusal says so outright.
    const engineer = actor("engineer", [
      role("everything", orgPermissionsFromKeys([...ORG_CAPABILITIES])),
    ]);
    const pi = orgCapabilityRefusal(
      engineer,
      "read_personal_information",
      "registrations",
    );
    expect(pi).toMatch(/every department/i);
    expect(pi).toMatch(/no role edit changes that/i);
    expect(orgCapabilityRefusal(engineer, "delete", "suppliers")).toMatch(
      /every department/i,
    );
  });

  it("never say 'god' out loud — the console calls that rank System manager", () => {
    const actors = [
      actor("engineer", [seeded("engineer")]),
      actor("org_staff", [seeded("org_staff")]),
      actor("org_staff"),
      actor("god"),
      actor("org_staff", [role("sup", DEPARTMENT_LEAD_PERMISSIONS, SUPPLIERS)]),
    ];
    for (const a of actors) {
      for (const capability of ORG_CAPABILITIES) {
        for (const domain of [null, ...ORG_DOMAINS] as (OrgDomain | null)[]) {
          expect(orgCapabilityRefusal(a, capability, domain)).not.toMatch(
            /\bgod\b/i,
          );
        }
      }
    }
  });

  it("refuse a missing actor without leaking which capability was asked for", () => {
    expect(orgCapabilityRefusal(null, "read_personal_information")).toBe(
      "Not authorised for the organiser console.",
    );
  });
});

describe("the resolved summary — 'what can this person actually do?'", () => {
  it("answers nothing for an actor with no roles, and does not invent a door", () => {
    expect(summarizeOrgActor(actor("org_staff"))).toEqual([]);
    expect(summarizeOrgActor(null)).toEqual([]);
  });

  it("resolves the UNION of several roles, not a list per role", () => {
    const a = actor("org_staff", [
      role("reader", { read: true }),
      role("writer", { write: true }),
    ]);
    expect(summarizeOrgActor(a).map((g) => g.capability)).toEqual([
      "read",
      "write",
    ]);
  });

  it("marks an org-wide grant as everywhere (null), never as an empty scope", () => {
    const a = actor("org_staff", [role("wide", { read: true, delete: true })]);
    for (const grant of summarizeOrgActor(a)) {
      expect(grant.departmentIds).toBeNull();
      expect(grant.domains).toBeNull();
    }
  });

  it("names the departments a scoped grant is confined to", () => {
    const a = actor("org_staff", [
      role("sup-lead", { read: true, delete: true }, SUPPLIERS),
      role("safety-lead", { delete: true }, SAFETY),
    ]);
    const del = summarizeOrgActor(a).find((g) => g.capability === "delete");
    expect(del?.departmentIds?.sort()).toEqual([SAFETY, SUPPLIERS].sort());
    // …and WHAT THAT REACHES: the union of the domains those departments own.
    // Safety owns nothing, so it contributes nothing rather than looking like
    // extra access.
    expect(del?.domains?.sort()).toEqual(
      ["supplier_documents", "suppliers"].sort(),
    );
  });

  it("reports an EMPTY reach for a scope whose departments own nothing", () => {
    // The summary a reviewer must not misread as access. `[]` is not `null`:
    // one means "reaches nothing", the other means "reaches everything".
    const a = actor("org_staff", [
      role("safety-lead", DEPARTMENT_LEAD_PERMISSIONS, SAFETY),
    ]);
    for (const capability of ["delete", "read_personal_information"] as const) {
      const grant = summarizeOrgActor(a).find(
        (g) => g.capability === capability,
      );
      expect(grant?.departmentIds).toEqual([SAFETY]);
      expect(grant?.domains).toEqual([]);
      expect(grantScopeClause(grant!, ["Safety"])).toMatch(/reaches nothing/i);
    }
  });

  it("phrases a real scope as the domains it reaches", () => {
    const a = actor("org_staff", [
      role("sup-lead", DEPARTMENT_LEAD_PERMISSIONS, SUPPLIERS),
    ]);
    const del = summarizeOrgActor(a).find((g) => g.capability === "delete");
    const clause = grantScopeClause(del!, ["Suppliers"]);
    expect(clause).toContain("Suppliers only");
    expect(clause).toContain("suppliers");
    expect(clause).toContain("supplier documents");
  });

  it("an ENGINEER's summary shows the carve-outs as absent, not as scoped", () => {
    const engineer = actor("engineer", [
      role("sup-lead", DEPARTMENT_LEAD_PERMISSIONS, SUPPLIERS),
    ]);
    const summary = summarizeOrgActor(engineer);
    expect(summary.map((g) => g.capability)).toEqual(["read", "write"]);
    // …and nothing they DO hold is reported as confined, because their reach is
    // every department.
    for (const grant of summary) {
      expect(grant.departmentIds).toBeNull();
      expect(grant.domains).toBeNull();
    }
  });

  it("reports a scope ONLY where one is enforced, never a smaller claim than the truth", () => {
    // `read` came from a department-scoped role, but `read` is not in
    // DEPARTMENT_SCOPED_CAPABILITIES — so `requireOrgSession` resolves it
    // through `orgCan`, which ignores the department entirely. This actor DOES
    // read the whole console, and the summary must say so: a person deciding
    // whether a grant is acceptable is misled just as badly by an understated
    // one as by an overstated one.
    const a = actor("org_staff", [
      role("sup-member", { read: true, write: true }, SUPPLIERS),
    ]);
    for (const grant of summarizeOrgActor(a)) {
      expect(isDepartmentScopedCapability(grant.capability)).toBe(false);
      expect(grant.departmentIds).toBeNull();
      // …and the summary agrees with THE GUARD THAT ACTUALLY RUNS: an unscoped
      // capability is resolved by `orgCan` (lib/session.ts `requireOrgSession`
      // routes only the scoped ones through `orgCanIn`), and `orgCan` says yes.
      expect(orgCan(a, grant.capability)).toBe(true);
    }
    // `orgCanIn` WOULD narrow this — which is exactly why the summary keys off
    // `isDepartmentScopedCapability` rather than off the role's department.
    expect(orgCanIn(a, "read", "dept-other")).toBe(false);
  });

  it("reports org-wide when ANY role grants it org-wide, scoped or not", () => {
    const a = actor("org_staff", [
      role("scoped", { delete: true }, SUPPLIERS),
      role("wide", { delete: true }),
    ]);
    const del = summarizeOrgActor(a).find((g) => g.capability === "delete");
    expect(del?.departmentIds).toBeNull();
  });

  it("gives a System manager everything, everywhere, with no roles at all", () => {
    const summary = summarizeOrgActor(actor("god"));
    expect(summary.map((g) => g.capability)).toEqual([...ORG_CAPABILITIES]);
    for (const grant of summary) {
      expect(grant.departmentIds).toBeNull();
      expect(grant.domains).toBeNull();
    }
  });

  it("never reports a capability the resolver would refuse", () => {
    // A hand-written row carrying the ungrantable capability: the summary must
    // agree with `orgCan`, or the console would advertise an access it refuses.
    const crafted = actor("org_staff", [
      role("sneaky", { manage_accounts: true, read: true }),
    ]);
    const summary = summarizeOrgActor(crafted);
    expect(summary.map((g) => g.capability)).toEqual(["read"]);
    for (const capability of ORG_CAPABILITIES) {
      expect(summary.some((g) => g.capability === capability)).toBe(
        orgCan(crafted, capability),
      );
    }
  });
});

describe("consequence copy — what an editor is actually deciding", () => {
  it("every capability has a label, a consequence and a description", () => {
    for (const capability of ORG_CAPABILITIES) {
      expect(ORG_CAPABILITY_LABELS[capability]).toBeTruthy();
      expect(ORG_CAPABILITY_CONSEQUENCES[capability].length).toBeGreaterThan(10);
      expect(ORG_CAPABILITY_DESCRIPTIONS[capability].length).toBeGreaterThan(30);
    }
  });

  it("consequences complete 'This account can …' — lowercase, no full stop", () => {
    for (const capability of ORG_CAPABILITIES) {
      const phrase = ORG_CAPABILITY_CONSEQUENCES[capability];
      expect(phrase[0]).toBe(phrase[0]?.toLowerCase());
      expect(phrase.endsWith(".")).toBe(false);
    }
  });

  it("speaks in consequences, never in permission keys", () => {
    // "delete: true" is not something to put in front of someone deciding what a
    // colleague can destroy. Every key name is banned from the copy a System
    // manager reads — except where a sentence names the vocabulary itself.
    for (const capability of ORG_CAPABILITIES) {
      for (const copy of [
        ORG_CAPABILITY_CONSEQUENCES[capability],
        ORG_CAPABILITY_DESCRIPTIONS[capability],
      ]) {
        expect(copy).not.toMatch(/\b(true|false)\b/);
        expect(copy).not.toMatch(/read_personal_information|manage_camp_categories|read_system/);
      }
    }
  });

  it("names what `delete` destroys, because that is the whole point", () => {
    expect(ORG_CAPABILITY_CONSEQUENCES.delete).toMatch(/permanently/i);
    expect(ORG_CAPABILITY_CONSEQUENCES.delete).toMatch(/supplier/i);
    expect(ORG_CAPABILITY_DESCRIPTIONS.delete).toMatch(/no undo/i);
  });

  it("states the scoping rule without claiming nothing is ever filed", () => {
    // The copy this replaced said "nothing in the console is filed under a
    // department yet" — true while no entity could declare one, a lie the
    // moment departments could own domains.
    expect(DEPARTMENT_SCOPE_NOTE).toMatch(/department/i);
    expect(DEPARTMENT_SCOPE_NOTE).toMatch(/owns none/i);
    expect(DEPARTMENT_SCOPE_NOTE).not.toMatch(/yet/i);
  });
});
