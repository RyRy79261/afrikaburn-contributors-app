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
  DEPARTMENT_SCOPE_TODAY,
  orgCapabilitiesFor,
  orgCapabilityRefusal,
  orgRankFromRole,
  isSystemManager,
  isDepartmentScopedGrant,
  departmentsGranting,
  canReadPersonalInformation,
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

/** An actor: a door plus zero or more roles. */
function actor(rank: OrgRank, roles: OrgRoleGrant[] = []): OrgActor {
  return { rank, roles };
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
    "god" | "seeded_org_staff" | "seeded_engineer" | "no_roles",
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

describe("department scoping — the delete rule", () => {
  const SUPPLIERS = "dept-suppliers";
  const CAMPS = "dept-theme-camps";

  const scopedDeleter = actor("org_staff", [
    role("suppliers.lead", DEPARTMENT_LEAD_PERMISSIONS, SUPPLIERS),
  ]);
  const orgWideDeleter = actor("org_staff", [seeded("org_staff")]);

  it("a department-scoped role deletes in its own department", () => {
    expect(orgCanIn(scopedDeleter, "delete", SUPPLIERS)).toBe(true);
  });

  it("…and NOT in another department", () => {
    expect(orgCanIn(scopedDeleter, "delete", CAMPS)).toBe(false);
  });

  it("…and NOT on a thing that belongs to no department", () => {
    // A departmental grant is a grant over that department's things. An unfiled
    // row belongs to no department, so only an org-wide role reaches it.
    expect(orgCanIn(scopedDeleter, "delete", null)).toBe(false);
  });

  it("an org-wide role deletes anywhere, including unfiled things", () => {
    expect(orgCanIn(orgWideDeleter, "delete", SUPPLIERS)).toBe(true);
    expect(orgCanIn(orgWideDeleter, "delete", CAMPS)).toBe(true);
    expect(orgCanIn(orgWideDeleter, "delete", null)).toBe(true);
  });

  it("`orgCan` answers 'anywhere' — which is why actions must ask `orgCanIn`", () => {
    // The trap this test exists to document: the affordance question and the
    // action question are different questions, and only one of them is scoped.
    expect(orgCan(scopedDeleter, "delete")).toBe(true);
    expect(orgCanIn(scopedDeleter, "delete", CAMPS)).toBe(false);
  });

  it("names `delete` as the department-scoped capability, and nothing else", () => {
    // Which capabilities fail closed when a guard does not name a department.
    // `read`/`write` are deliberately absent: a department member whose ordinary
    // work resolved to nothing (because no console entity declares a department
    // yet) would be a role that looks granted and does nothing.
    expect(DEPARTMENT_SCOPED_CAPABILITIES).toEqual(["delete"]);
    expect(isDepartmentScopedCapability("delete")).toBe(true);
    for (const capability of ORG_CAPABILITIES) {
      if (capability === "delete") continue;
      expect(isDepartmentScopedCapability(capability)).toBe(false);
    }
  });

  it("names a scoped grant as scoped, so the console can say so out loud", () => {
    expect(isDepartmentScopedGrant(scopedDeleter, "delete")).toBe(true);
    expect(isDepartmentScopedGrant(orgWideDeleter, "delete")).toBe(false);
    expect(isDepartmentScopedGrant(actor("god"), "delete")).toBe(false);
    expect(departmentsGranting(scopedDeleter, "delete")).toEqual([SUPPLIERS]);
    expect(departmentsGranting(orgWideDeleter, "delete")).toEqual([]);
  });

  it("a member role in the same department still cannot delete", () => {
    const member = actor("org_staff", [
      role("suppliers.member", DEPARTMENT_MEMBER_PERMISSIONS, SUPPLIERS),
    ]);
    expect(orgCanIn(member, "delete", SUPPLIERS)).toBe(false);
    expect(orgCanIn(member, "write", SUPPLIERS)).toBe(true);
    expect(orgCanIn(member, "write", CAMPS)).toBe(false);
  });

  it("unions scopes across roles — two departments, both reachable", () => {
    const both = actor("org_staff", [
      role("suppliers.lead", { delete: true }, SUPPLIERS),
      role("camps.lead", { delete: true }, CAMPS),
    ]);
    expect(orgCanIn(both, "delete", SUPPLIERS)).toBe(true);
    expect(orgCanIn(both, "delete", CAMPS)).toBe(true);
    expect(orgCanIn(both, "delete", "dept-safety")).toBe(false);
    expect([...departmentsGranting(both, "delete")].sort()).toEqual(
      [CAMPS, SUPPLIERS].sort(),
    );
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
    expect(rows[1]?.permissions.delete).toBeUndefined();
  });
});

describe("personal information", () => {
  it("is a role grant now — the seeded Engineer does not hold it", () => {
    expect(canReadPersonalInformation(actor("engineer", [seeded("engineer")]))).toBe(
      false,
    );
    expect(
      canReadPersonalInformation(actor("org_staff", [seeded("org_staff")])),
    ).toBe(true);
  });

  it("CAN be granted to an engineer's role — that is the point of the change", () => {
    // Stated as a test because it is a real consequence a reviewer should meet
    // deliberately rather than discover. The rank no longer forbids it; a System
    // manager decides, and the change is audited.
    const widened = actor("engineer", [
      role("engineer", { read: true, write: true, read_personal_information: true }),
    ]);
    expect(canReadPersonalInformation(widened)).toBe(true);
    expect(
      canViewMedicalNotes({
        isSelf: false,
        actorOrgRole: "engineer",
        actorOrgPersonalInformation: canReadPersonalInformation(widened),
        actorLeadCampIds: [],
        subjectCampIds: [],
      }),
    ).toBe(true);
  });

  it("keeps medical and the console matrix answering together", () => {
    // Two modules, one answer. `medical-access` decides medical independently of
    // this resolver, so this asserts they agree instead of assuming it.
    const engineer = actor("engineer", [seeded("engineer")]);
    expect(canReadPersonalInformation(engineer)).toBe(false);
    expect(
      canViewMedicalNotes({
        isSelf: false,
        actorOrgRole: "engineer",
        actorOrgPersonalInformation: canReadPersonalInformation(engineer),
        actorLeadCampIds: [],
        subjectCampIds: [],
      }),
    ).toBe(false);
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

  it("explain a department-scoped refusal as scope, not absence", () => {
    const scoped = actor("org_staff", [
      role("suppliers.lead", { delete: true }, "dept-suppliers"),
    ]);
    expect(orgCapabilityRefusal(scoped, "delete")).toMatch(/own department/i);
  });

  it("never say 'god' out loud — the console calls that rank System manager", () => {
    const actors = [
      actor("engineer", [seeded("engineer")]),
      actor("org_staff", [seeded("org_staff")]),
      actor("org_staff"),
      actor("god"),
    ];
    for (const a of actors) {
      for (const capability of ORG_CAPABILITIES) {
        expect(orgCapabilityRefusal(a, capability)).not.toMatch(/\bgod\b/i);
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
    }
  });

  it("names the departments a scoped grant is confined to", () => {
    const a = actor("org_staff", [
      role("sup-lead", { read: true, delete: true }, "dept-suppliers"),
      role("safety-lead", { delete: true }, "dept-safety"),
    ]);
    const del = summarizeOrgActor(a).find((g) => g.capability === "delete");
    expect(del?.departmentIds?.sort()).toEqual(["dept-safety", "dept-suppliers"]);
  });

  it("reports a scope ONLY where one is enforced, never a smaller claim than the truth", () => {
    // `read` came from a department-scoped role, but `read` is not in
    // DEPARTMENT_SCOPED_CAPABILITIES — so `requireOrgSession` resolves it
    // through `orgCan`, which ignores the department entirely. This actor DOES
    // read the whole console, and the summary must say so: a person deciding
    // whether a grant is acceptable is misled just as badly by an understated
    // one as by an overstated one.
    const a = actor("org_staff", [
      role("sup-member", { read: true, write: true }, "dept-suppliers"),
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
      role("scoped", { delete: true }, "dept-suppliers"),
      role("wide", { delete: true }),
    ]);
    const del = summarizeOrgActor(a).find((g) => g.capability === "delete");
    expect(del?.departmentIds).toBeNull();
  });

  it("gives a System manager everything, everywhere, with no roles at all", () => {
    const summary = summarizeOrgActor(actor("god"));
    expect(summary.map((g) => g.capability)).toEqual([...ORG_CAPABILITIES]);
    for (const grant of summary) expect(grant.departmentIds).toBeNull();
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

  it("says out loud that a department-scoped delete grants nothing yet", () => {
    // The honest gap: no console entity carries a department, so `orgCanIn`
    // resolves every target as unfiled. Discovering that by being refused in
    // front of a colleague is not acceptable, so the copy states it.
    expect(DEPARTMENT_SCOPE_TODAY).toMatch(/nothing/i);
    expect(DEPARTMENT_SCOPE_TODAY).toMatch(/department/i);
  });
});
