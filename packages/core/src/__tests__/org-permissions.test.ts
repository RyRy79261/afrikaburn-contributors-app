import { describe, it, expect } from "vitest";
import {
  ORG_RANKS,
  ORG_CAPABILITIES,
  ORG_RANK_LABELS,
  orgCan,
  orgCapabilitiesFor,
  orgCapabilityRefusal,
  orgRankFromRole,
  canReadPersonalInformation,
  normalizeDepartment,
  type OrgActor,
  type OrgCapability,
  type OrgRank,
} from "../org-permissions";
import { canViewMedicalNotes, isOrgStaffRole } from "../medical-access";
import { ORG_APP_ROLES, MembershipRole } from "@quagga/types";

function actor(rank: OrgRank, overrides: Partial<OrgActor> = {}): OrgActor {
  return { rank, department: null, isDepartmentLead: false, ...overrides };
}

describe("org ranks", () => {
  it("are exactly the roles that may enter the console", () => {
    expect([...ORG_RANKS].sort()).toEqual([...ORG_APP_ROLES].sort());
  });

  it("map a membership role to a rank, and refuse project roles", () => {
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
});

describe("the capability matrix", () => {
  // The matrix, written out longhand. If a rank's powers change, this table is
  // what a reviewer reads — so it is spelled out rather than derived.
  const MATRIX: Record<OrgRank, Record<OrgCapability, boolean>> = {
    engineer: {
      read: true,
      read_personal_information: false,
      write: true,
      delete: false,
      manage_camp_categories: false,
      manage_accounts: false,
      read_system: true,
    },
    org_staff: {
      read: true,
      read_personal_information: true,
      write: true,
      delete: true,
      manage_camp_categories: false,
      manage_accounts: false,
      read_system: false,
    },
    god: {
      read: true,
      read_personal_information: true,
      write: true,
      delete: true,
      manage_camp_categories: true,
      manage_accounts: true,
      read_system: true,
    },
  };

  for (const rank of ORG_RANKS) {
    for (const capability of ORG_CAPABILITIES) {
      const expected = MATRIX[rank][capability];
      it(`${rank} ${expected ? "holds" : "is refused"} ${capability}`, () => {
        expect(orgCan(actor(rank), capability)).toBe(expected);
      });
    }
  }

  it("fails closed for a missing actor", () => {
    for (const capability of ORG_CAPABILITIES) {
      expect(orgCan(null, capability)).toBe(false);
      expect(orgCan(undefined, capability)).toBe(false);
    }
  });

  it("fails closed for a rank that is not a rank", () => {
    // Someone hand-rolls an actor from an unvalidated string — every capability
    // must refuse rather than throw or pass.
    const bogus = { rank: "member", department: null, isDepartmentLead: false };
    for (const capability of ORG_CAPABILITIES) {
      expect(orgCan(bogus as OrgActor, capability)).toBe(false);
    }
  });

  it("lists a rank's capabilities consistently with orgCan", () => {
    for (const rank of ORG_RANKS) {
      const listed = new Set(orgCapabilitiesFor(rank));
      for (const capability of ORG_CAPABILITIES) {
        expect(listed.has(capability)).toBe(orgCan(actor(rank), capability));
      }
    }
  });

  it("every rank can read — 'access everywhere' is the engineer's grant", () => {
    for (const rank of ORG_RANKS) {
      expect(orgCan(actor(rank), "read")).toBe(true);
    }
  });
});

describe("engineers and personal information", () => {
  it("are refused it, whatever their department or lead flag", () => {
    expect(canReadPersonalInformation(actor("engineer"))).toBe(false);
    expect(
      canReadPersonalInformation(
        actor("engineer", { department: "Suppliers", isDepartmentLead: true }),
      ),
    ).toBe(false);
  });

  it("are refused medical notes by the medical predicate too", () => {
    // Two modules, one answer. `medical-access` decides medical independently of
    // this matrix, so this asserts they agree instead of assuming it.
    expect(isOrgStaffRole("engineer")).toBe(false);
    expect(
      canViewMedicalNotes({
        isSelf: false,
        actorOrgRole: "engineer",
        actorLeadCampIds: [],
        subjectCampIds: [],
      }),
    ).toBe(false);
  });

  it("still see their own notes — the subject always wins", () => {
    expect(
      canViewMedicalNotes({
        isSelf: true,
        actorOrgRole: "engineer",
        actorLeadCampIds: [],
        subjectCampIds: [],
      }),
    ).toBe(true);
  });

  it("are refused destruction, whatever their department or lead flag", () => {
    expect(orgCan(actor("engineer"), "delete")).toBe(false);
    expect(
      orgCan(
        actor("engineer", { department: "Theme camps", isDepartmentLead: true }),
        "delete",
      ),
    ).toBe(false);
  });
});

describe("the system panel is IT's, not the operator tier's", () => {
  it("is held by engineer and System manager, and refused to org staff", () => {
    expect(orgCan(actor("engineer"), "read_system")).toBe(true);
    expect(orgCan(actor("god"), "read_system")).toBe(true);
    expect(orgCan(actor("org_staff"), "read_system")).toBe(false);
  });

  it("proves the ranks are NOT a ladder", () => {
    // The one property most likely to be assumed and never checked. org_staff
    // outranks engineer on personal information and destruction, and engineer
    // outranks org_staff on the system panel — so any `rank >= other` style
    // check is wrong in BOTH directions. Asserted rather than commented,
    // because a future capability could quietly make it true again and the
    // comment would then be a lie nobody notices.
    const engineerOnly = ORG_CAPABILITIES.filter(
      (c) => orgCan(actor("engineer"), c) && !orgCan(actor("org_staff"), c),
    );
    const staffOnly = ORG_CAPABILITIES.filter(
      (c) => orgCan(actor("org_staff"), c) && !orgCan(actor("engineer"), c),
    );
    expect(engineerOnly).toEqual(["read_system"]);
    expect(staffOnly).toEqual(["read_personal_information", "delete"]);
  });

  it("is a READ — nothing on that page mutates on page access alone", () => {
    // `read_system` opens the panel. The account controls it renders re-check
    // `manage_accounts`, which an engineer does not hold, so "can open the
    // system panel" never implies "can change someone's access".
    expect(orgCan(actor("engineer"), "read_system")).toBe(true);
    expect(orgCan(actor("engineer"), "manage_accounts")).toBe(false);
  });
});

describe("camp categories are the system manager's", () => {
  it("refuses org staff and engineers alike", () => {
    expect(orgCan(actor("god"), "manage_camp_categories")).toBe(true);
    expect(orgCan(actor("org_staff"), "manage_camp_categories")).toBe(false);
    expect(orgCan(actor("engineer"), "manage_camp_categories")).toBe(false);
  });
});

describe("departments", () => {
  it("grant nothing — a lead is recorded, not privileged", () => {
    const plain = actor("engineer");
    const lead = actor("engineer", {
      department: "Suppliers",
      isDepartmentLead: true,
    });
    for (const capability of ORG_CAPABILITIES) {
      expect(orgCan(lead, capability)).toBe(orgCan(plain, capability));
    }
  });

  it("normalise to a trimmed label or null", () => {
    expect(normalizeDepartment("  Theme   camps ")).toBe("Theme camps");
    expect(normalizeDepartment("")).toBeNull();
    expect(normalizeDepartment("   ")).toBeNull();
    expect(normalizeDepartment(null)).toBeNull();
    expect(normalizeDepartment(undefined)).toBeNull();
    expect(normalizeDepartment("x".repeat(200))).toHaveLength(80);
  });
});

describe("refusals", () => {
  it("name the rank and say what would be needed", () => {
    const engineer = actor("engineer");
    expect(orgCapabilityRefusal(engineer, "delete")).toMatch(/engineer/i);
    expect(orgCapabilityRefusal(engineer, "delete")).toMatch(/system manager/i);
    expect(orgCapabilityRefusal(engineer, "read_personal_information")).toMatch(
      /personal information/i,
    );
    expect(
      orgCapabilityRefusal(actor("org_staff"), "manage_camp_categories"),
    ).toMatch(/system manager/i);
    expect(orgCapabilityRefusal(actor("org_staff"), "manage_accounts")).toMatch(
      /system manager/i,
    );
    expect(orgCapabilityRefusal(actor("org_staff"), "read_system")).toMatch(
      /org staff/i,
    );
    expect(orgCapabilityRefusal(actor("org_staff"), "read_system")).toMatch(
      /engineer/i,
    );
  });

  it("never say 'god' out loud — the console calls that rank System manager", () => {
    for (const rank of ORG_RANKS) {
      for (const capability of ORG_CAPABILITIES) {
        expect(orgCapabilityRefusal(actor(rank), capability)).not.toMatch(
          /\bgod\b/i,
        );
      }
    }
  });

  it("refuse a missing actor without leaking which capability was asked for", () => {
    expect(orgCapabilityRefusal(null, "read_personal_information")).toBe(
      "Not authorised for the organiser console.",
    );
  });
});
