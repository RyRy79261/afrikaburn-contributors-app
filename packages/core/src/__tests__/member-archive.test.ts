import { describe, it, expect } from "vitest";
import {
  GroupKind,
  MembershipRole,
  OfficerKey,
  OrgOutboundSelector,
  ProjectRoleKind,
  RegistrationStatus,
  RoleAssignmentConsent,
  type ProjectPermissions,
} from "@quagga/types";

import type { AudienceContext } from "../audience";
import {
  canArchiveMember,
  canRestoreMember,
  memberArchiveRefusalMessage,
  orgActionsLostByArchive,
  MEMBER_ARCHIVE_AUDIT_ACTION,
  MEMBER_RESTORE_AUDIT_ACTION,
  type ArchiveActor,
  type ArchiveTarget,
  type MemberArchiveRefusal,
  type PendingOrgAction,
} from "../member-archive";

// Former camp members (CDB-036). Values from the real vocabularies (AGENTS.md
// "Verification": a fixture outside the enum is inert). Ids are fictional.
const LEAD = MembershipRole.enum.lead;
const ADMIN = MembershipRole.enum.admin;
const MEMBER = MembershipRole.enum.member;
const GOD = MembershipRole.enum.god;
const ORG_STAFF = MembershipRole.enum.org_staff;
const ENGINEER = MembershipRole.enum.engineer;

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // lead of Mad Hatters
const REN = "aaaaaaaa-0000-4000-8000-000000000002";
const JABU = "aaaaaaaa-0000-4000-8000-000000000003";

function actor(
  role: MembershipRole | null,
  rolePermissions: ProjectPermissions[] = [],
  userId = ALICE,
): ArchiveActor {
  return {
    userId,
    membership: role ? { structuralRole: role, rolePermissions } : null,
  };
}

function target(
  role: MembershipRole,
  archived = false,
  userId = REN,
): ArchiveTarget {
  return { userId, role, archived };
}

const refusal = (reason: MemberArchiveRefusal) => ({ ok: false, reason });

describe("canArchiveMember — who may archive whom", () => {
  it("lets the lead archive a member", () => {
    expect(canArchiveMember(actor(LEAD), target(MEMBER))).toEqual({ ok: true });
  });

  it("lets a co-lead archive a member (the backstop holds manage_members)", () => {
    expect(canArchiveMember(actor(ADMIN), target(MEMBER))).toEqual({
      ok: true,
    });
  });

  it("lets a plain member archive only through a role granting manage_members", () => {
    expect(
      canArchiveMember(actor(MEMBER), target(MEMBER, false, JABU)),
    ).toEqual(refusal("no_permission"));
    // A role that grants something else does not widen it.
    expect(
      canArchiveMember(
        actor(MEMBER, [{ view_member_details: true, assign_roles: true }]),
        target(MEMBER, false, JABU),
      ),
    ).toEqual(refusal("no_permission"));
    expect(
      canArchiveMember(
        actor(MEMBER, [{ manage_members: true }]),
        target(MEMBER, false, JABU),
      ),
    ).toEqual({ ok: true });
  });

  it("refuses a non-member of the camp (a lead of camp A in camp B, or a former member)", () => {
    // The loader resolves the actor's membership OF THIS GROUP; an archived
    // membership resolves to null exactly like none at all.
    expect(canArchiveMember(actor(null), target(MEMBER))).toEqual(
      refusal("no_permission"),
    );
  });

  it("refuses a target that is not in this camp", () => {
    expect(canArchiveMember(actor(LEAD), null)).toEqual(refusal("not_member"));
  });

  it("refuses yourself — that is Leave camp", () => {
    expect(canArchiveMember(actor(ADMIN), target(ADMIN, false, ALICE))).toEqual(
      refusal("self"),
    );
  });

  // THE NO-LOCKOUT BACKSTOP. The lead is never archivable, so a camp with
  // members always keeps its lead whatever anyone archives.
  it("NEVER archives the lead — not by a co-lead, not by a manage_members holder", () => {
    expect(canArchiveMember(actor(ADMIN), target(LEAD))).toEqual(
      refusal("lead"),
    );
    expect(
      canArchiveMember(actor(MEMBER, [{ manage_members: true }]), target(LEAD)),
    ).toEqual(refusal("lead"));
  });

  it("lets only the lead archive a co-lead", () => {
    expect(canArchiveMember(actor(LEAD), target(ADMIN))).toEqual({ ok: true });
    expect(canArchiveMember(actor(ADMIN, [], JABU), target(ADMIN))).toEqual(
      refusal("needs_lead"),
    );
    expect(
      canArchiveMember(
        actor(MEMBER, [{ manage_members: true }]),
        target(ADMIN),
      ),
    ).toEqual(refusal("needs_lead"));
  });

  it("refuses org ranks holding a camp membership", () => {
    for (const role of [GOD, ORG_STAFF, ENGINEER]) {
      expect(canArchiveMember(actor(LEAD), target(role))).toEqual(
        refusal("not_camp_role"),
      );
    }
  });

  it("refuses archiving someone twice", () => {
    expect(canArchiveMember(actor(LEAD), target(MEMBER, true))).toEqual(
      refusal("already_archived"),
    );
  });

  it("covers every structural role in the enum (a new one must be decided on)", () => {
    // If a role is added to the enum, this forces a decision about it here
    // rather than letting it default silently.
    const decided = new Map(
      MembershipRole.options.map((role) => [
        role,
        canArchiveMember(actor(LEAD), target(role)).ok,
      ]),
    );
    expect(Object.fromEntries(decided)).toEqual({
      god: false,
      org_staff: false,
      lead: false,
      admin: true,
      member: true,
      engineer: false,
    });
  });
});

describe("canRestoreMember — the mirror, with the same authority", () => {
  it("lets the lead restore a former member", () => {
    expect(canRestoreMember(actor(LEAD), target(MEMBER, true))).toEqual({
      ok: true,
    });
  });

  it("refuses restoring someone who is still a current member", () => {
    expect(canRestoreMember(actor(LEAD), target(MEMBER, false))).toEqual(
      refusal("not_archived"),
    );
  });

  it("lets only the lead restore a former co-lead (it gives back a structural role)", () => {
    expect(canRestoreMember(actor(LEAD), target(ADMIN, true))).toEqual({
      ok: true,
    });
    expect(
      canRestoreMember(actor(ADMIN, [], JABU), target(ADMIN, true)),
    ).toEqual(refusal("needs_lead"));
  });

  it("refuses a restorer without manage_members, and a former member restoring anyone", () => {
    expect(
      canRestoreMember(actor(MEMBER, [], JABU), target(MEMBER, true)),
    ).toEqual(refusal("no_permission"));
    expect(canRestoreMember(actor(null), target(MEMBER, true))).toEqual(
      refusal("no_permission"),
    );
  });

  it("refuses restoring yourself", () => {
    expect(canRestoreMember(actor(ADMIN), target(MEMBER, true, ALICE))).toEqual(
      refusal("self"),
    );
  });
});

describe("refusal copy and audit actions", () => {
  it("has a message for every refusal", () => {
    const reasons: MemberArchiveRefusal[] = [
      "no_permission",
      "not_member",
      "self",
      "lead",
      "needs_lead",
      "not_camp_role",
      "already_archived",
      "not_archived",
    ];
    for (const r of reasons) {
      expect(memberArchiveRefusalMessage(r)).toMatch(/\w/);
    }
    expect(memberArchiveRefusalMessage("lead")).toMatch(/Transfer the lead/);
  });

  it("names the audit actions distinctly", () => {
    expect(MEMBER_ARCHIVE_AUDIT_ACTION).toBe("camp.member.archive");
    expect(MEMBER_RESTORE_AUDIT_ACTION).toBe("camp.member.restore");
  });
});

// ── Org questionnaires reached through the camp (decided 2026-09-28) ─────────
//
// `required_actions` does not record the membership an org audience reached
// someone through, so the archive re-derives it: resolve each camp-role
// audience for the person with and without the archived membership, and waive
// only what the archive took them out of. These run the REAL resolver.
describe("orgActionsLostByArchive", () => {
  const EDITION = "eeeeeeee-0000-4000-8000-000000000027";
  const MAD_HATTERS = "11111111-0000-4000-8000-00000000000a";
  const CAMP_404 = "11111111-0000-4000-8000-00000000000b";
  const M_HATTERS = "22222222-0000-4000-8000-00000000000a";
  const M_404 = "22222222-0000-4000-8000-00000000000b";
  const SAFETY_ROLE = "33333333-0000-4000-8000-00000000000a";
  const THEME_CAMP = GroupKind.enum.theme_camp;
  const APPROVED = RegistrationStatus.enum.approved;
  const REGISTERED_LEADS = OrgOutboundSelector.enum.registered_camp_leads;
  const ALL_BURNERS = OrgOutboundSelector.enum.all_current_burners;
  const SAFETY = OfficerKey.enum.safety_officer;
  const OFFICER = ProjectRoleKind.enum.officer;
  const ACCEPTED = RoleAssignmentConsent.enum.accepted;

  const leadsForm: PendingOrgAction = {
    id: "ra-leads",
    editionId: EDITION,
    audience: { kind: "org_outbound", selectors: [REGISTERED_LEADS] },
  };
  const officerForm: PendingOrgAction = {
    id: "ra-officers",
    editionId: EDITION,
    audience: { kind: "org_officer", officerKeys: [SAFETY] },
  };
  const burnersOrLeadsForm: PendingOrgAction = {
    id: "ra-burners-or-leads",
    editionId: EDITION,
    audience: {
      kind: "org_outbound",
      selectors: [ALL_BURNERS, REGISTERED_LEADS],
    },
  };
  const internalForm: PendingOrgAction = {
    id: "ra-internal",
    editionId: EDITION,
    audience: { kind: "org_internal" },
  };

  /** Jabu: co-lead of Mad Hatters (registered) and its Safety Officer;
   * optionally co-lead of Camp 404 (also registered) too. */
  function ctx(
    opts: { alsoLeads404?: boolean; bio?: boolean } = {},
  ): AudienceContext {
    return {
      editionId: "",
      orgGroupId: "",
      memberships: [
        {
          membershipId: M_HATTERS,
          userId: JABU,
          groupId: MAD_HATTERS,
          role: ADMIN,
        },
        ...(opts.alsoLeads404
          ? [
              {
                membershipId: M_404,
                userId: JABU,
                groupId: CAMP_404,
                role: ADMIN,
              },
            ]
          : []),
      ],
      groups: [
        { id: MAD_HATTERS, kind: THEME_CAMP },
        { id: CAMP_404, kind: THEME_CAMP },
      ],
      registrations: [MAD_HATTERS, CAMP_404].map((groupId) => ({
        groupId,
        editionId: EDITION,
        status: APPROVED,
        grantsInterest: false,
      })),
      bios: opts.bio ? [{ userId: JABU, editionId: EDITION }] : [],
      roleAssignments: [
        {
          membershipId: M_HATTERS,
          projectRoleId: SAFETY_ROLE,
          consent: ACCEPTED,
        },
      ],
      projectRoles: [
        {
          id: SAFETY_ROLE,
          groupId: MAD_HATTERS,
          kind: OFFICER,
          officerKey: SAFETY,
        },
      ],
    };
  }

  it("waives the camp-lead and officer forms that reached them only through this camp", () => {
    expect(
      orgActionsLostByArchive(JABU, M_HATTERS, [leadsForm, officerForm], ctx()),
    ).toEqual(["ra-leads", "ra-officers"]);
  });

  it("keeps a camp-lead form they still get as a co-lead of ANOTHER registered camp", () => {
    expect(
      orgActionsLostByArchive(
        JABU,
        M_HATTERS,
        [leadsForm, officerForm],
        ctx({ alsoLeads404: true }),
      ),
    ).toEqual(["ra-officers"]);
  });

  it("keeps a form whose audience still reaches them another way (all current burners)", () => {
    expect(
      orgActionsLostByArchive(
        JABU,
        M_HATTERS,
        [burnersOrLeadsForm],
        ctx({ bio: true }),
      ),
    ).toEqual([]);
    // …and the fixture moves the number: without the bio it is lost.
    expect(
      orgActionsLostByArchive(JABU, M_HATTERS, [burnersOrLeadsForm], ctx()),
    ).toEqual(["ra-burners-or-leads"]);
  });

  it("never waives a form that is not camp-role based, or has no audience", () => {
    expect(
      orgActionsLostByArchive(
        JABU,
        M_HATTERS,
        [internalForm, { id: "ra-none", editionId: EDITION, audience: null }],
        ctx(),
      ),
    ).toEqual([]);
  });

  it("leaves a form they did not qualify for BEFORE the archive (not this archive's doing)", () => {
    const unregistered: AudienceContext = { ...ctx(), registrations: [] };
    expect(
      orgActionsLostByArchive(JABU, M_HATTERS, [leadsForm], unregistered),
    ).toEqual([]);
  });

  it("a plain member with no officer role loses nothing", () => {
    const plain = ctx();
    const asMember: AudienceContext = {
      ...plain,
      memberships: [{ ...plain.memberships[0]!, role: MEMBER }],
      roleAssignments: [],
    };
    expect(
      orgActionsLostByArchive(
        JABU,
        M_HATTERS,
        [leadsForm, officerForm],
        asMember,
      ),
    ).toEqual([]);
  });
});
