import { describe, expect, it } from "vitest";
import type { MembershipRole, ProjectPermissions } from "@quagga/types";
import {
  MEMBER_RECORDS_AUDIT,
  MEMBER_RECORDS_AUDIT_ACTIONS,
  MEMBER_NOTES_AUDIENCE_NOTE,
  MEMBER_NOTE_EXPORT_UNREADABLE,
  buildMemberNotesExport,
  canDeleteMemberNote,
  canEditMemberNote,
  canExportMemberNotes,
  memberNotesExportFilename,
  type MemberNoteExportItem,
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

// --- Export (POPIA s23 access request, #105; Ryan, 18 Oct 2026) ---------------

describe("who may export a member's notes", () => {
  // A captain holds every privilege (member_notes included) by the role's
  // kind — but not a STRUCTURAL lead role, so not the export.
  const allGrants: ProjectPermissions = {
    member_notes: true,
    view_member_details: true,
    assign_roles: true,
  };
  const captain = viewer(WELFARE, perms("member", allGrants));

  it("the camp's structural lead and co-lead: yes", () => {
    expect(canExportMemberNotes(lead, subject)).toBe(true);
    expect(canExportMemberNotes(colead, subject)).toBe(true);
  });

  it("an archived member's notes can be exported (they are still kept)", () => {
    // `inCamp` is true for an archived membership: the store found the row.
    expect(canExportMemberNotes(lead, { userId: SUBJECT, inCamp: true })).toBe(
      true,
    );
  });

  it("a member_notes holder who is not a lead: no — keeping notes is not answering for the camp", () => {
    expect(canReadMemberNotes(welfare, subject)).toBe(true); // they DO keep notes
    expect(canExportMemberNotes(welfare, subject)).toBe(false);
    expect(canExportMemberNotes(captain, subject)).toBe(false);
  });

  it("a plain member and a roster reader: no", () => {
    expect(canExportMemberNotes(plain, subject)).toBe(false);
    expect(canExportMemberNotes(rosterReader, subject)).toBe(false);
  });

  it("the subject themself — even a lead — never: the member does not see notes in the app", () => {
    expect(canExportMemberNotes(lead, { userId: LEAD, inCamp: true })).toBe(
      false,
    );
    // Case does not smuggle the same id past the check.
    expect(
      canExportMemberNotes(lead, { userId: LEAD.toUpperCase(), inCamp: true }),
    ).toBe(false);
  });

  it("a lead of another camp (no membership here) and org staff: no", () => {
    // The store resolves membership per camp: a lead of camp B is `null` in
    // camp A, as is any org account (god / org_staff hold no camp row).
    expect(canExportMemberNotes(viewer(LEAD, null), subject)).toBe(false);
    expect(canExportMemberNotes(stranger, subject)).toBe(false);
    // Even if an org rank somehow appeared as a structural role in a camp,
    // it is not a project backstop.
    expect(canExportMemberNotes(viewer(LEAD, perms("god")), subject)).toBe(
      false,
    );
    expect(
      canExportMemberNotes(viewer(LEAD, perms("org_staff")), subject),
    ).toBe(false);
  });

  it("someone who is not in this camp (left, erased, stranger): no", () => {
    expect(canExportMemberNotes(lead, { userId: SUBJECT, inCamp: false })).toBe(
      false,
    );
  });

  it("the export is audited under its own camp-private action", () => {
    expect(MEMBER_RECORDS_AUDIT.noteExport).toBe("camp.member_note.export");
    // The org console's exclusion list is built from this list.
    expect(MEMBER_RECORDS_AUDIT_ACTIONS).toContain(
      MEMBER_RECORDS_AUDIT.noteExport,
    );
  });
});

describe("the export file", () => {
  const exportedAt = new Date("2026-10-18T10:00:00Z");
  const file = buildMemberNotesExport({
    campName: "Mad Hatters",
    memberName: "Jabu",
    exportedAt,
    // Given NEWEST first, as the card loads them: the file must reorder.
    notes: [
      {
        createdAt: new Date("2026-10-12T09:00:00Z"),
        editedAt: null,
        text: "Asked not to be on night shifts.",
      },
      {
        createdAt: new Date("2026-10-05T09:00:00Z"),
        editedAt: null,
        text: null,
      },
      {
        createdAt: new Date("2026-09-01T09:00:00Z"),
        editedAt: new Date("2026-09-20T09:00:00Z"),
        text: "Great on build week.\nNeeds a lift from Cape Town.",
      },
    ],
  });

  it("opens with the camp, the member, the date and why the file exists", () => {
    const lines = file.split("\n");
    expect(lines[0]).toBe("Private notes kept by Mad Hatters");
    expect(lines[1]).toBe("About: Jabu");
    expect(lines[2]).toBe("Exported: 18 October 2026");
    expect(file).toContain("section 23 of the Protection of Personal Information Act (POPIA)");
    expect(file).toContain("The names of the people who wrote them are not included.");
  });

  it("lists every note oldest first, with written and last-edited dates", () => {
    const first = file.indexOf("Great on build week.");
    const second = file.indexOf(MEMBER_NOTE_EXPORT_UNREADABLE);
    const third = file.indexOf("Asked not to be on night shifts.");
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
    expect(file).toContain("--- Note 1 of 3 ---\nWritten: 1 September 2026\nLast edited: 20 September 2026\n\nGreat on build week.\nNeeds a lift from Cape Town.");
    expect(file).toContain("--- Note 3 of 3 ---\nWritten: 12 October 2026\n\nAsked not to be on night shifts.");
    // Only the edited note carries an edited line.
    expect(file.match(/Last edited:/g)).toHaveLength(1);
  });

  it("an undecryptable note is listed with its date, never dropped", () => {
    expect(MEMBER_NOTE_EXPORT_UNREADABLE).toBe("[This note could not be read]");
    expect(file).toContain(
      "--- Note 2 of 3 ---\nWritten: 5 October 2026\n\n[This note could not be read]",
    );
  });

  it("carries no author — the item type has no author field to fill", () => {
    const item: MemberNoteExportItem = {
      createdAt: exportedAt,
      editedAt: null,
      text: "x",
    };
    expect(Object.keys(item).sort()).toEqual(["createdAt", "editedAt", "text"]);
    // Passing an author anyway (an excess property via a widened object)
    // does not reach the file.
    const withAuthor = {
      ...item,
      authorName: "Alice Hatter",
      authorUserId: LEAD,
    };
    const out = buildMemberNotesExport({
      campName: "Mad Hatters",
      memberName: "Jabu",
      exportedAt,
      notes: [withAuthor],
    });
    expect(out).not.toContain("Alice Hatter");
    expect(out).not.toContain(LEAD);
  });

  it("says so when the camp keeps no notes", () => {
    const empty = buildMemberNotesExport({
      campName: "Mad Hatters",
      memberName: "Jabu",
      exportedAt,
      notes: [],
    });
    expect(empty).toContain("The camp keeps no notes about you.");
    expect(empty).not.toContain("--- Note");
  });

  it("names the file with slugs only — nothing a person typed reaches the header", () => {
    expect(
      memberNotesExportFilename({
        campSlug: "mad-hatters",
        memberName: 'Jabu "the"\r\nX-Evil: 1; filename=../../etc',
        exportedAt,
      }),
    ).toBe("member-notes-mad-hatters-jabu-the-x-evil-1-filename-etc-2026-10-18.txt");
    expect(
      memberNotesExportFilename({
        campSlug: "",
        memberName: "Zoë 🔥",
        exportedAt,
      }),
    ).toBe("member-notes-camp-zoe-2026-10-18.txt");
    expect(
      memberNotesExportFilename({
        campSlug: "camp",
        memberName: "🔥🔥",
        exportedAt,
      }),
    ).toBe("member-notes-camp-member-2026-10-18.txt");
    // The day is South African: 23:30 UTC is already tomorrow in Joburg.
    expect(
      memberNotesExportFilename({
        campSlug: "c",
        memberName: "m",
        exportedAt: new Date("2026-10-18T23:30:00Z"),
      }),
    ).toBe("member-notes-c-m-2026-10-19.txt");
  });
});
