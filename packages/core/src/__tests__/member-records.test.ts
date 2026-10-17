import { describe, expect, it } from "vitest";
import type { MembershipRole, ProjectPermissions } from "@quagga/types";
import {
  MEMBER_RECORDS_AUDIT,
  MEMBER_NOTES_AUDIENCE_NOTE,
  canDeleteMemberNote,
  canEditMemberNote,
  canManageMemberNotes,
  canReadMemberNotes,
  canSeeDuplicateHints,
  decideAddMemberNote,
  decideDeleteMemberNote,
  decideDismissDuplicate,
  decideEditMemberNote,
  duplicatePairKey,
  duplicatesByUser,
  findDuplicatePairs,
  memberRecordsAvailableForGroup,
  memberRecordsRefusalMessage,
  orderedUserPair,
  type MemberNotesViewer,
  type MemberRecordsRefusal,
} from "../member-records";
import type { PermissionMembership } from "../project-permissions";

const LEAD = "00000000-0000-4000-8000-00000000000a";
const COLEAD = "00000000-0000-4000-8000-00000000000b";
const WELFARE = "00000000-0000-4000-8000-00000000000c";
const MEMBER = "00000000-0000-4000-8000-00000000000d";
const SUBJECT = "00000000-0000-4000-8000-00000000000e";

function perms(
  role: MembershipRole,
  grant: ProjectPermissions = {},
): PermissionMembership {
  return { structuralRole: role, rolePermissions: [{}, grant] };
}

const viewer = (
  userId: string,
  membership: PermissionMembership | null,
): MemberNotesViewer => ({ userId, membership });

const lead = viewer(LEAD, perms("lead"));
const colead = viewer(COLEAD, perms("admin"));
const welfare = viewer(WELFARE, perms("member", { member_notes: true }));
const plain = viewer(MEMBER, perms("member"));
// A roster reader is NOT a note person: seeing member details is a different
// grant from reading the camp's private notes.
const rosterReader = viewer(
  MEMBER,
  perms("member", { view_member_details: true }),
);
const stranger = viewer(MEMBER, null);

const subject = { userId: SUBJECT, inCamp: true };

describe("who keeps notes", () => {
  it("leads, co-leads and member_notes holders — nobody else", () => {
    expect(canManageMemberNotes(lead.membership)).toBe(true);
    expect(canManageMemberNotes(colead.membership)).toBe(true);
    expect(canManageMemberNotes(welfare.membership)).toBe(true);
    expect(canManageMemberNotes(plain.membership)).toBe(false);
    expect(canManageMemberNotes(rosterReader.membership)).toBe(false);
    // Not a member of THIS camp (a lead elsewhere, the org): nothing.
    expect(canManageMemberNotes(null)).toBe(false);
  });

  it("other privileges never imply member_notes", () => {
    expect(
      canManageMemberNotes(
        perms("member", {
          manage_members: true,
          manage_roles: true,
          manage_money: true,
          schedule_meetings: true,
        }),
      ),
    ).toBe(false);
  });

  it("exists for every project, never the org group", () => {
    expect(memberRecordsAvailableForGroup("theme_camp")).toBe(true);
    expect(memberRecordsAvailableForGroup("artwork")).toBe(true);
    expect(memberRecordsAvailableForGroup("mutant_vehicle")).toBe(true);
    expect(memberRecordsAvailableForGroup("org")).toBe(false);
  });
});

describe("reading and adding notes", () => {
  it("a note person reads notes about a current or archived member", () => {
    expect(canReadMemberNotes(lead, subject)).toBe(true);
    expect(canReadMemberNotes(welfare, subject)).toBe(true);
    expect(decideAddMemberNote(welfare, subject)).toEqual({ ok: true });
  });

  it("anyone else in the camp reads nothing", () => {
    expect(canReadMemberNotes(plain, subject)).toBe(false);
    expect(canReadMemberNotes(rosterReader, subject)).toBe(false);
    expect(canReadMemberNotes(stranger, subject)).toBe(false);
  });

  it("a person outside the camp is refused as not found", () => {
    const outsider = { userId: SUBJECT, inCamp: false };
    expect(canReadMemberNotes(lead, outsider)).toBe(false);
    expect(decideAddMemberNote(lead, outsider)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("nobody reads or writes notes about themselves — the member never sees them", () => {
    const self = { userId: LEAD, inCamp: true };
    expect(canReadMemberNotes(lead, self)).toBe(false);
    expect(decideAddMemberNote(lead, self)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("a non-note person is refused as not found, the same as a stranger", () => {
    expect(decideAddMemberNote(plain, subject)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("editing and deleting notes", () => {
  const byWelfare = { authorUserId: WELFARE, subjectUserId: SUBJECT };
  const byColead = { authorUserId: COLEAD, subjectUserId: SUBJECT };
  const orphan = { authorUserId: null, subjectUserId: SUBJECT };

  it("the author edits and deletes their own", () => {
    expect(canEditMemberNote(welfare, byWelfare)).toBe(true);
    expect(canDeleteMemberNote(welfare, byWelfare)).toBe(true);
    expect(decideEditMemberNote(welfare, byWelfare)).toEqual({ ok: true });
    expect(decideDeleteMemberNote(welfare, byWelfare)).toEqual({ ok: true });
  });

  it("nobody edits another person's words, a lead included", () => {
    expect(canEditMemberNote(lead, byWelfare)).toBe(false);
    expect(canEditMemberNote(welfare, byColead)).toBe(false);
    expect(decideEditMemberNote(lead, byWelfare)).toEqual({
      ok: false,
      reason: "not_your_note",
    });
    // An author-less note (the author row went) is nobody's to edit.
    expect(canEditMemberNote(lead, orphan)).toBe(false);
  });

  it("leads and co-leads delete any note; a member_notes holder only their own", () => {
    expect(canDeleteMemberNote(lead, byWelfare)).toBe(true);
    expect(canDeleteMemberNote(colead, byWelfare)).toBe(true);
    expect(canDeleteMemberNote(lead, orphan)).toBe(true);
    expect(canDeleteMemberNote(welfare, byColead)).toBe(false);
    expect(decideDeleteMemberNote(welfare, byColead)).toEqual({
      ok: false,
      reason: "not_your_note",
    });
  });

  it("an author who lost the privilege can no longer touch their notes", () => {
    const former = viewer(WELFARE, perms("member"));
    expect(canEditMemberNote(former, byWelfare)).toBe(false);
    expect(canDeleteMemberNote(former, byWelfare)).toBe(false);
    expect(decideEditMemberNote(former, byWelfare)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(decideDeleteMemberNote(stranger, byWelfare)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("a missing note, or one about the viewer, is not found", () => {
    expect(decideEditMemberNote(lead, null)).toEqual({
      ok: false,
      reason: "note_not_found",
    });
    expect(decideDeleteMemberNote(lead, null)).toEqual({
      ok: false,
      reason: "note_not_found",
    });
    const aboutLead = { authorUserId: COLEAD, subjectUserId: LEAD };
    expect(canDeleteMemberNote(lead, aboutLead)).toBe(false);
    expect(canEditMemberNote(lead, { ...aboutLead, authorUserId: LEAD })).toBe(
      false,
    );
    expect(decideDeleteMemberNote(lead, aboutLead)).toEqual({
      ok: false,
      reason: "note_not_found",
    });
    expect(decideEditMemberNote(lead, aboutLead)).toEqual({
      ok: false,
      reason: "note_not_found",
    });
  });
});

describe("duplicate hints", () => {
  const A = "00000000-0000-4000-8000-0000000000a1";
  const B = "00000000-0000-4000-8000-0000000000b2";
  const C = "00000000-0000-4000-8000-0000000000c3";

  it("are for roster viewers only", () => {
    expect(canSeeDuplicateHints(lead.membership)).toBe(true);
    expect(canSeeDuplicateHints(rosterReader.membership)).toBe(true);
    expect(canSeeDuplicateHints(welfare.membership)).toBe(false);
    expect(canSeeDuplicateHints(plain.membership)).toBe(false);
    expect(canSeeDuplicateHints(null)).toBe(false);
  });

  it("flag two members with similar names, and only them", () => {
    const pairs = findDuplicatePairs([
      { userId: B, name: "Thandi Mokoena-Dube" },
      { userId: A, name: "Thandi Mokoena" },
      { userId: C, name: "Pieter van Wyk" },
    ]);
    expect(pairs).toEqual([
      {
        userIds: [A, B],
        names: ["Thandi Mokoena", "Thandi Mokoena-Dube"],
      },
    ]);
  });

  it("skip placeholder names, blanks and repeated rows", () => {
    expect(
      findDuplicatePairs([
        { userId: A, name: "Unnamed burner" },
        { userId: B, name: "Unnamed burner" },
        { userId: C, name: "  " },
      ]),
    ).toEqual([]);
    expect(
      findDuplicatePairs([
        { userId: A, name: "Departed Burner" },
        { userId: B, name: "Departed burner" },
      ]),
    ).toEqual([]);
    expect(
      findDuplicatePairs([
        { userId: A, name: "Jabu" },
        { userId: A, name: "Jabu" },
      ]),
    ).toEqual([]);
  });

  it("drop a dismissed pair whichever way round it was stored", () => {
    const members = [
      { userId: A, name: "Thandi Mokoena" },
      { userId: B, name: "Thandi Mokoena-Dube" },
    ];
    expect(findDuplicatePairs(members, [[B, A]])).toEqual([]);
    expect(findDuplicatePairs(members, [[A, B]])).toEqual([]);
    // A dismissal of some OTHER pair hides nothing here.
    expect(findDuplicatePairs(members, [[A, C]])).toHaveLength(1);
  });

  it("sort pairs by name", () => {
    const D = "00000000-0000-4000-8000-0000000000d4";
    const pairs = findDuplicatePairs([
      { userId: A, name: "Zola Nkosi" },
      { userId: B, name: "Zola Nkosi-M" },
      { userId: C, name: "Alice Hatter" },
      { userId: D, name: "Alice Hatters" },
    ]);
    expect(pairs.map((p) => p.names[0])).toEqual(["Alice Hatter", "Zola Nkosi"]);
  });

  it("index each flagged member to the other", () => {
    const map = duplicatesByUser([
      { userIds: [A, B], names: ["Thandi Mokoena", "Thandi Mokoena-Dube"] },
      { userIds: [A, C], names: ["Thandi Mokoena", "Thandi M"] },
    ]);
    expect(map.get(A)).toEqual([
      { userId: B, name: "Thandi Mokoena-Dube" },
      { userId: C, name: "Thandi M" },
    ]);
    expect(map.get(B)).toEqual([{ userId: A, name: "Thandi Mokoena" }]);
    expect(map.has("nobody")).toBe(false);
  });

  it("order a pair the way the DB CHECK stores it", () => {
    expect(orderedUserPair(B, A)).toEqual([A, B]);
    expect(orderedUserPair(A, B)).toEqual([A, B]);
    expect(orderedUserPair(B.toUpperCase(), A)).toEqual([A, B]);
    expect(duplicatePairKey(B, A)).toBe(duplicatePairKey(A, B));
  });

  it("are dismissed by a roster viewer, for two current members with similar names", () => {
    const a = { userId: A, name: "Thandi Mokoena" };
    const b = { userId: B, name: "Thandi Mokoena-Dube" };
    const c = { userId: C, name: "Pieter van Wyk" };
    expect(
      decideDismissDuplicate({ membership: lead.membership, pair: [a, b] }),
    ).toEqual({ ok: true });
    expect(
      decideDismissDuplicate({
        membership: rosterReader.membership,
        pair: [b, a],
      }),
    ).toEqual({ ok: true });
    // Not a roster viewer: the camp's not-found.
    expect(
      decideDismissDuplicate({ membership: plain.membership, pair: [a, b] }),
    ).toEqual({ ok: false, reason: "not_found" });
    // Someone who is not a current member: not found.
    expect(
      decideDismissDuplicate({ membership: lead.membership, pair: [a, null] }),
    ).toEqual({ ok: false, reason: "not_found" });
    // Names that are not similar: no dismissal can be planted.
    expect(
      decideDismissDuplicate({ membership: lead.membership, pair: [a, c] }),
    ).toEqual({ ok: false, reason: "not_a_duplicate" });
    expect(
      decideDismissDuplicate({ membership: lead.membership, pair: [a, a] }),
    ).toEqual({ ok: false, reason: "not_a_duplicate" });
  });
});

describe("copy", () => {
  it("has a sentence for every refusal", () => {
    const reasons: MemberRecordsRefusal[] = [
      "not_found",
      "note_not_found",
      "not_your_note",
      "not_a_duplicate",
    ];
    const messages = reasons.map(memberRecordsRefusalMessage);
    expect(new Set(messages).size).toBe(reasons.length);
    for (const m of messages) expect(m).toMatch(/\.$/);
  });

  it("names the audience in the note form, and audits ids under camp.*", () => {
    expect(MEMBER_NOTES_AUDIENCE_NOTE).toContain("leads and note-keepers");
    expect(MEMBER_NOTES_AUDIENCE_NOTE).toContain("POPIA");
    for (const action of Object.values(MEMBER_RECORDS_AUDIT)) {
      expect(action).toMatch(/^camp\.member_/);
    }
  });
});
