import { describe, it, expect } from "vitest";
import {
  ORG_CAPABILITIES,
  canReadPersonalInformationIn,
  isSystemManager,
  orgCan,
  orgCanInDomain,
  orgRankFromRole,
  type OrgActor,
} from "../org-permissions";
import { buildDomainOwnership, ORG_DOMAINS } from "../org-domains";
import { canViewMedicalNotes, medicalAccessBasis } from "../medical-access";
import { hasProjectPermission } from "../project-permissions";
import {
  PROJECT_ADMIN_ROLES,
  PROJECT_PERMISSION_KEYS,
  type MembershipRole,
} from "@quagga/types";

// ONE PERSON, THREE HATS — and the two sides must not bleed.
//
// Ryan, 27 Jul 2026: "Org staff can also be camp leads so all of these accounts
// can also be involved in the contributor side. Myself for example, I'm a camp
// lead, an officer, and a system engineer."
//
// That is not an edge case to tolerate; it is the normal shape of an AfrikaBurn
// volunteer, and it is exactly the shape in which authorisation bugs hide. Two
// separate ladders exist:
//
//   · THE ORG SIDE — `memberships.role` on the ORG group is the console door,
//     and org roles resolve console capabilities (`orgCan`).
//   · THE CAMP SIDE — `memberships.role` on a PROJECT group is lead/admin/member
//     and project roles resolve project permissions (`hasProjectPermission`).
//
// The failure this file exists to prevent is a resolver that reads "role" and
// does not care which group it came from: a camp lead who inherits the console,
// or an engineer whose rank quietly makes them a lead of every camp. Nothing
// should be shared between the two ladders EXCEPT one deliberate, one-way
// bridge: the org's `read_personal_information` (per domain) is one of the ways
// `canViewMedicalNotes` can say yes — and it says yes only for the org branch,
// never by turning someone into a camp lead.

/** The three-hat account. Deliberately assembled the way the apps assemble it:
 * an ORG rank + org roles for one side, a list of LED CAMP IDS for the other. */
const CAMPS_DEPT = "dept-theme-camps";
const OWNERSHIP = buildDomainOwnership([
  {
    domain: "registrations",
    departmentId: CAMPS_DEPT,
    departmentName: "Theme camps",
  },
]);

/** Ryan's account, org side: an ENGINEER (a system engineer, in his words). */
const engineerHat: OrgActor = {
  rank: "engineer",
  roles: [
    {
      id: "r-eng",
      key: "engineer",
      name: "Engineer",
      kind: "system",
      departmentId: null,
      permissions: { read: true, write: true, read_system: true },
    },
  ],
  domains: OWNERSHIP,
};

/** …camp side: structural lead of Camp 404, and an accepted officer there. */
const CAMP_404 = "group-camp-404";
const OTHER_CAMP = "group-mad-hatters";

describe("the org ladder does not reach across to a camp", () => {
  it("an org rank is NOT a project backstop — the sides share no resolver", () => {
    // `hasProjectPermission` takes a PROJECT membership role and grants
    // everything to `lead`/`admin`. The org ranks are in the same enum (one
    // `memberships` table, two kinds of group), which is exactly why this is
    // worth asserting: none of them is a project backstop, so holding `god` on
    // the org group cannot make anyone a lead of a camp.
    for (const rank of ["org_staff", "engineer", "god"] as const) {
      expect(PROJECT_ADMIN_ROLES).not.toContain<MembershipRole>(rank);
      for (const permission of PROJECT_PERMISSION_KEYS) {
        expect(
          hasProjectPermission(
            { structuralRole: rank, rolePermissions: [] },
            permission,
          ),
        ).toBe(false);
      }
    }
  });

  it("a System manager is all-powerful in the CONSOLE and is not a camp lead", () => {
    const god: OrgActor = { rank: "god", roles: [], domains: OWNERSHIP };
    expect(isSystemManager(god)).toBe(true);
    for (const capability of ORG_CAPABILITIES) {
      expect(orgCan(god, capability)).toBe(true);
    }
    // …and holds nothing on a camp they do not lead. The anchor is an org-group
    // membership row; a project's permissions come from a project membership.
    for (const permission of PROJECT_PERMISSION_KEYS) {
      expect(
        hasProjectPermission(
          { structuralRole: "member", rolePermissions: [] },
          permission,
        ),
      ).toBe(false);
    }
  });

  it("the org side never consults which camps someone leads", () => {
    // Same org actor, two totally different camp-side situations: the console
    // answer must be identical, or a camp role would be leaking into the org
    // ladder.
    const leadsEverything = { ...engineerHat };
    for (const capability of ORG_CAPABILITIES) {
      expect(orgCan(leadsEverything, capability)).toBe(
        orgCan(engineerHat, capability),
      );
    }
  });
});

describe("the camp ladder does not reach across to the console", () => {
  it("a structural camp lead holds every PROJECT permission and no console rank", () => {
    for (const permission of PROJECT_PERMISSION_KEYS) {
      expect(
        hasProjectPermission(
          { structuralRole: "lead", rolePermissions: [] },
          permission,
        ),
      ).toBe(true);
    }
    // The console door is `orgRankFromRole`, and `lead`/`admin`/`member` are not
    // org ranks. This is THE gate: a project role can never open the console.
    expect(orgRankFromRole("lead")).toBeNull();
    expect(orgRankFromRole("admin")).toBeNull();
    expect(orgRankFromRole("member")).toBeNull();
  });

  it("leading a camp grants nothing in the console, not even reading it", () => {
    // A camp lead with no org membership has no OrgActor at all — every
    // resolver fails closed on a null actor rather than inventing a rank.
    for (const capability of ORG_CAPABILITIES) {
      expect(orgCan(null, capability)).toBe(false);
      for (const domain of ORG_DOMAINS) {
        expect(orgCanInDomain(null, capability, domain)).toBe(false);
      }
    }
  });
});

describe("ALL THREE HATS AT ONCE — camp lead + officer + system engineer", () => {
  // The account Ryan described. Each hat is resolved from its own facts, and
  // the test asserts that each answer is the one that hat earns — no more.

  it("reads their OWN camp's members' medical notes as a CAMP LEAD, not as org", () => {
    const decision = canViewMedicalNotes({
      isSelf: false,
      actorOrgRole: "engineer",
      // The engineer carve-out: the org branch says no, whatever their roles.
      actorOrgPersonalInformation: canReadPersonalInformationIn(
        engineerHat,
        "registrations",
      ),
      actorLeadCampIds: [CAMP_404],
      subjectCampIds: [CAMP_404],
    });
    expect(decision).toBe(true);
    // …and the basis recorded on the audit row says WHICH hat it was. That is
    // the whole value of recording it: "org_staff" here would be a false record
    // of why the disclosure was allowed.
    expect(
      medicalAccessBasis({
        isSelf: false,
        actorOrgRole: "engineer",
        actorOrgPersonalInformation: false,
        actorLeadCampIds: [CAMP_404],
        subjectCampIds: [CAMP_404],
      }),
    ).toBe("camp_lead");
  });

  it("…and is REFUSED another camp's members, engineer rank notwithstanding", () => {
    // The bleed this test exists for: the org hat must not top up the camp hat.
    expect(
      canViewMedicalNotes({
        isSelf: false,
        actorOrgRole: "engineer",
        actorOrgPersonalInformation: canReadPersonalInformationIn(
          engineerHat,
          "registrations",
        ),
        actorLeadCampIds: [CAMP_404],
        subjectCampIds: [OTHER_CAMP],
      }),
    ).toBe(false);
  });

  it("their CONSOLE access is the engineer's, unchanged by the camp hats", () => {
    expect(orgCan(engineerHat, "read")).toBe(true);
    expect(orgCan(engineerHat, "write")).toBe(true);
    expect(orgCan(engineerHat, "read_system")).toBe(true);
    // The carve-outs hold even for someone who is, on the other side, a lead
    // with every project permission and an accepted officer consent.
    expect(orgCan(engineerHat, "read_personal_information")).toBe(false);
    expect(orgCan(engineerHat, "delete")).toBe(false);
    expect(orgCan(engineerHat, "manage_accounts")).toBe(false);
  });

  it("their OFFICER consent shares a phone with the ORG, not a console right", () => {
    // An accepted officer registration is a disclosure by the officer, not a
    // grant to them: it puts their number in front of org staff and gives the
    // officer nothing. Asserted here because "I'm also an officer" is the hat
    // most likely to be mistaken for an authority.
    const asOfficer: OrgActor = { ...engineerHat };
    for (const capability of ORG_CAPABILITIES) {
      expect(orgCan(asOfficer, capability)).toBe(orgCan(engineerHat, capability));
    }
  });

  it("an ORG_STAFF-ranked camp lead reads their department's domain AND their own camp", () => {
    // The other realistic three-hat shape: someone whose org side does carry
    // personal information. Both branches say yes, for different reasons, and
    // neither widens the other — the camp branch is still their own camp only.
    const staffLead: OrgActor = {
      rank: "org_staff",
      roles: [
        {
          id: "r-camps-lead",
          key: "dept.theme_camps.lead",
          name: "Theme camps lead",
          kind: "system",
          departmentId: CAMPS_DEPT,
          permissions: {
            read: true,
            write: true,
            read_personal_information: true,
            delete: true,
          },
        },
      ],
      domains: OWNERSHIP,
    };
    const orgBranch = canReadPersonalInformationIn(staffLead, "registrations");
    expect(orgBranch).toBe(true);

    // Org branch reaches any camp's members (their department owns
    // registrations) — that IS the department's job…
    expect(
      canViewMedicalNotes({
        isSelf: false,
        actorOrgRole: "org_staff",
        actorOrgPersonalInformation: orgBranch,
        actorLeadCampIds: [CAMP_404],
        subjectCampIds: [OTHER_CAMP],
      }),
    ).toBe(true);
    // …but the same person's SUPPLIER-side reach is still nothing, because
    // their department does not own suppliers.
    expect(canReadPersonalInformationIn(staffLead, "suppliers")).toBe(false);
    expect(orgCanInDomain(staffLead, "delete", "suppliers")).toBe(false);
  });
});
