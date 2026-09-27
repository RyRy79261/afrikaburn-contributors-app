import { describe, it, expect } from "vitest";
import { MembershipRole, type ProjectPermissions } from "@quagga/types";

import {
  canArchiveMember,
  canRestoreMember,
  memberArchiveRefusalMessage,
  MEMBER_ARCHIVE_AUDIT_ACTION,
  MEMBER_RESTORE_AUDIT_ACTION,
  type ArchiveActor,
  type ArchiveTarget,
  type MemberArchiveRefusal,
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
