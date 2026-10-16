import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { MEMBER_RECORDS_AUDIT } from "@quagga/core";
import {
  GroupKind,
  MembershipRole,
  ProjectRoleKind,
  type ProjectPermissions,
} from "@quagga/types";
import { boundStrings, dbMock, nullChecksOn } from "@/test/db-mock";

// Member records store (docs/member-records-spec.md). Asserts DECISIONS — who
// is refused before which read or write, what is written, in which
// transaction, and what an audit row carries — not SQL (see db-mock's
// header). Fixture roles and kinds come from the real vocabularies: a value
// outside its enum would make a gate inert.

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());
const getMemberPermissions = vi.fn();
vi.mock("../roles-store", () => ({
  getMemberPermissions: (...args: unknown[]) => getMemberPermissions(...args),
}));

const store = await import("../member-records-store");

const LEAD = MembershipRole.enum.lead;
const ADMIN = MembershipRole.enum.admin;
const MEMBER = MembershipRole.enum.member;
const THEME_CAMP = GroupKind.enum.theme_camp;
const CUSTOM = ProjectRoleKind.enum.custom;
const BASELINE = ProjectRoleKind.enum.baseline;

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // lead
const REN = "aaaaaaaa-0000-4000-8000-000000000002"; // welfare (member_notes)
const JABU = "aaaaaaaa-0000-4000-8000-000000000003"; // the subject
const LERATO = "aaaaaaaa-0000-4000-8000-000000000004"; // plain member
const CAMP = "11111111-0000-4000-8000-00000000000a";
const NOTE = "99999999-0000-4000-8000-000000000001";
const WELFARE_ROLE = "77777777-0000-4000-8000-000000000001";
const BASELINE_ROLE = "77777777-0000-4000-8000-000000000002";
const SLUG = "mad-hatters";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = "Asked not to be on night shifts this year.";

const campRow = [{ id: CAMP, name: "Mad Hatters", slug: SLUG, kind: THEME_CAMP }];

const person = (
  userId: string,
  role: string,
  over: Record<string, unknown> = {},
) => ({
  userId,
  membershipId: `m-${userId}`,
  role,
  archivedAt: null,
  username:
    userId === ALICE
      ? "Alice Hatter"
      : userId === REN
        ? "Ren Notfound"
        : userId === JABU
          ? "Jabu"
          : "Lerato Dlamini",
  sanitizedAt: null,
  ...over,
});

/** The camp's roles, then the actor's accepted assignments. */
function rolesFor(grant: ProjectPermissions | null): unknown[] {
  const roles = [
    { id: BASELINE_ROLE, kind: BASELINE, permissions: {} },
    { id: WELFARE_ROLE, kind: CUSTOM, permissions: { member_notes: true } },
  ];
  if (grant) roles[1]!.permissions = grant;
  return [roles, grant ? [{ projectRoleId: WELFARE_ROLE }] : []];
}

const perms = (role: string, grant: ProjectPermissions = {}) => ({
  structuralRole: role,
  rolePermissions: [{}, grant],
});

beforeEach(() => {
  dbMock.reset();
  getMemberPermissions.mockReset();
  process.env.DATABASE_URL = "postgres://test";
});

afterEach(() => {
  delete process.env.DATABASE_URL;
});

/** Does the chain's WHERE reference this exact schema column (identity)? */
function whereMentions(
  query: { arg(method: string): unknown },
  column: object,
): boolean {
  const seen = new WeakSet<object>();
  const walk = (value: unknown, depth: number): boolean => {
    if (value === column) return true;
    if (depth > 8 || typeof value !== "object" || value === null) return false;
    if (seen.has(value)) return false;
    seen.add(value);
    const chunks = (value as { queryChunks?: unknown[] }).queryChunks;
    return Array.isArray(chunks) && chunks.some((c) => walk(c, depth + 1));
  };
  return walk(query.arg("where"), 0);
}

/** The audit rows written, as values. */
function auditRows(): Record<string, unknown>[] {
  return dbMock
    .writesTo(schema.auditEvents)
    .map((q) => q.arg("values") as Record<string, unknown>);
}

describe("adding a note", () => {
  it("a lead adds a note about a member: one insert and one audit row, ids only, in one transaction", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, LEAD), person(JABU, MEMBER)],
      ...rolesFor(null),
      [{ id: NOTE }],
      [],
    );
    const result = await store.addMemberNote(ALICE, {
      slug: SLUG,
      subjectUserId: JABU,
      body: `  ${SECRET}  `,
    });
    expect(result).toEqual({ ok: true, noteId: NOTE });
    const [insert] = dbMock.writesTo(schema.memberNotes);
    expect(insert!.tx).toBe(true);
    expect(insert!.arg("values")).toMatchObject({
      groupId: CAMP,
      subjectUserId: JABU,
      authorUserId: ALICE,
      body: SECRET,
    });
    const [row] = auditRows();
    expect(row).toEqual({
      actorId: ALICE,
      action: MEMBER_RECORDS_AUDIT.noteCreate,
      subject: NOTE,
      meta: { groupId: CAMP, noteId: NOTE, subjectUserId: JABU },
    });
    // The audit row never carries the text.
    expect(JSON.stringify(row)).not.toContain("night shifts");
    expect(dbMock.writesTo(schema.auditEvents)[0]!.tx).toBe(true);
  });

  it("locks both people's memberships AND accounts FOR SHARE, erased accounts excluded", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, LEAD), person(JABU, MEMBER)],
      ...rolesFor(null),
      [{ id: NOTE }],
    );
    await store.addMemberNote(ALICE, {
      slug: SLUG,
      subjectUserId: JABU,
      body: "hi",
    });
    const [lock] = dbMock.queries.filter((q) => q.called("for"));
    expect(lock!.tx).toBe(true);
    expect(lock!.arg("for")).toBe("share");
    const of = (
      lock!.calls.find((c) => c.method === "for")!.args[1] as { of: unknown[] }
    ).of;
    expect(of).toEqual([schema.memberships, schema.users]);
    expect(nullChecksOn(lock!, schema.users.sanitizedAt)).toEqual(["is null"]);
    expect(boundStrings(lock!)).toEqual(
      expect.arrayContaining([CAMP, ALICE, JABU]),
    );
    // Archived members still come back: notes are about them too.
    expect(nullChecksOn(lock!, schema.memberships.archivedAt)).toEqual([]);
  });

  it("a member_notes holder may; the grant is read from the camp's roles", async () => {
    dbMock.queue(
      campRow,
      [person(REN, MEMBER), person(JABU, MEMBER)],
      ...rolesFor({ member_notes: true }),
      [{ id: NOTE }],
    );
    expect(
      await store.addMemberNote(REN, {
        slug: SLUG,
        subjectUserId: JABU,
        body: "Great on build week.",
      }),
    ).toEqual({ ok: true, noteId: NOTE });
  });

  it("an ARCHIVED member can still have notes added (archive keeps them)", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, LEAD), person(JABU, MEMBER, { archivedAt: new Date() })],
      ...rolesFor(null),
      [{ id: NOTE }],
    );
    expect(
      await store.addMemberNote(ALICE, {
        slug: SLUG,
        subjectUserId: JABU,
        body: "Might come back next year.",
      }),
    ).toEqual({ ok: true, noteId: NOTE });
  });

  it("a plain member, or a roster reader without member_notes, is refused before any write", async () => {
    for (const grant of [null, { view_member_details: true }]) {
      dbMock.reset();
      dbMock.queue(
        campRow,
        [person(LERATO, MEMBER), person(JABU, MEMBER)],
        ...rolesFor(grant),
      );
      const result = await store.addMemberNote(LERATO, {
        slug: SLUG,
        subjectUserId: JABU,
        body: "hi",
      });
      expect(result).toEqual({
        ok: false,
        error: "That person isn't in this camp.",
      });
      expect(dbMock.writesTo(schema.memberNotes)).toHaveLength(0);
      expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
    }
  });

  it("a note about someone outside the camp is refused as not found", async () => {
    dbMock.queue(campRow, [person(ALICE, LEAD)], ...rolesFor(null));
    const result = await store.addMemberNote(ALICE, {
      slug: SLUG,
      subjectUserId: JABU,
      body: "hi",
    });
    expect(result).toEqual({
      ok: false,
      error: "That person isn't in this camp.",
    });
    expect(dbMock.writesTo(schema.memberNotes)).toHaveLength(0);
  });

  it("an erased person (the lock re-reads sanitized_at) is not found", async () => {
    dbMock.queue(
      campRow,
      [
        person(ALICE, LEAD),
        person(JABU, MEMBER, { sanitizedAt: new Date() }),
      ],
      ...rolesFor(null),
    );
    expect(
      (
        await store.addMemberNote(ALICE, {
          slug: SLUG,
          subjectUserId: JABU,
          body: "hi",
        })
      ).ok,
    ).toBe(false);
    expect(dbMock.writesTo(schema.memberNotes)).toHaveLength(0);
  });

  it("a lead may not write about themselves; an archived lead may write nothing", async () => {
    dbMock.queue(campRow, [person(ALICE, LEAD)], ...rolesFor(null));
    expect(
      (
        await store.addMemberNote(ALICE, {
          slug: SLUG,
          subjectUserId: ALICE,
          body: "hi",
        })
      ).ok,
    ).toBe(false);
    dbMock.reset();
    dbMock.queue(campRow, [
      person(ALICE, LEAD, { archivedAt: new Date() }),
      person(JABU, MEMBER),
    ]);
    expect(
      (
        await store.addMemberNote(ALICE, {
          slug: SLUG,
          subjectUserId: JABU,
          body: "hi",
        })
      ).ok,
    ).toBe(false);
    expect(dbMock.writesTo(schema.memberNotes)).toHaveLength(0);
  });

  it("an invalid input, an unknown camp or no database is refused before any query or with no write", async () => {
    expect(
      await store.addMemberNote(ALICE, {
        slug: SLUG,
        subjectUserId: JABU,
        body: "x".repeat(2001),
      }),
    ).toEqual({ ok: false, error: "Check the note and try again." });
    expect(dbMock.queries).toHaveLength(0);

    dbMock.queue([]);
    expect(
      (
        await store.addMemberNote(ALICE, {
          slug: "nope",
          subjectUserId: JABU,
          body: "hi",
        })
      ).ok,
    ).toBe(false);
    expect(dbMock.transactions).toBe(0);

    dbMock.reset();
    dbMock.queue([{ ...campRow[0], kind: GroupKind.enum.org }]);
    expect(
      (
        await store.addMemberNote(ALICE, {
          slug: SLUG,
          subjectUserId: JABU,
          body: "hi",
        })
      ).ok,
    ).toBe(false);
    expect(dbMock.transactions).toBe(0);

    dbMock.reset();
    delete process.env.DATABASE_URL;
    expect(
      (
        await store.addMemberNote(ALICE, {
          slug: SLUG,
          subjectUserId: JABU,
          body: "hi",
        })
      ).ok,
    ).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("a failed insert (no row back) is reported, not audited", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, LEAD), person(JABU, MEMBER)],
      ...rolesFor(null),
      [],
    );
    expect(
      (
        await store.addMemberNote(ALICE, {
          slug: SLUG,
          subjectUserId: JABU,
          body: "hi",
        })
      ).ok,
    ).toBe(false);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });
});

describe("editing and deleting a note", () => {
  const note = (authorUserId: string | null, subjectUserId = JABU) => ({
    id: NOTE,
    subjectUserId,
    authorUserId,
  });

  /** findCamp, the note's subject, the lock, the actor's roles, the note. */
  function queueNoteWrite(
    actor: ReturnType<typeof person>,
    stored: ReturnType<typeof note> | null,
    grant: ProjectPermissions | null = null,
    people: unknown[] = [actor, person(JABU, MEMBER)],
  ) {
    dbMock.queue(
      campRow,
      stored ? [{ subjectUserId: stored.subjectUserId }] : [],
      people,
      ...rolesFor(grant),
      stored ? [stored] : [],
    );
  }

  it("the author edits their own: the body, who edited and when; one audit row without the text", async () => {
    queueNoteWrite(person(REN, MEMBER), note(REN), { member_notes: true });
    const result = await store.editMemberNote(REN, {
      slug: SLUG,
      noteId: NOTE,
      body: SECRET,
    });
    expect(result).toEqual({ ok: true });
    const [update] = dbMock.writesTo(schema.memberNotes);
    expect(update!.kind).toBe("update");
    expect(update!.tx).toBe(true);
    expect(update!.arg("set")).toMatchObject({
      body: SECRET,
      editedByUserId: REN,
    });
    expect(boundStrings(update!)).toEqual(expect.arrayContaining([NOTE, CAMP]));
    const [row] = auditRows();
    expect(row).toMatchObject({
      action: MEMBER_RECORDS_AUDIT.noteUpdate,
      subject: NOTE,
      meta: { groupId: CAMP, noteId: NOTE, subjectUserId: JABU },
    });
    expect(JSON.stringify(row)).not.toContain("night shifts");
  });

  it("locks the people FOR SHARE, then the note FOR UPDATE, scoped to this camp", async () => {
    queueNoteWrite(person(REN, MEMBER), note(REN), { member_notes: true });
    await store.editMemberNote(REN, { slug: SLUG, noteId: NOTE, body: "x" });
    const locks = dbMock.queries.filter((q) => q.called("for"));
    expect(locks.map((q) => q.arg("for"))).toEqual(["share", "update"]);
    expect(locks[1]!.arg("from")).toBe(schema.memberNotes);
    expect(boundStrings(locks[1]!)).toEqual(
      expect.arrayContaining([NOTE, CAMP]),
    );
  });

  it("a lead may not edit someone else's note", async () => {
    queueNoteWrite(person(ALICE, LEAD), note(REN));
    expect(
      await store.editMemberNote(ALICE, { slug: SLUG, noteId: NOTE, body: "x" }),
    ).toEqual({
      ok: false,
      error: "Only the person who wrote a note can change it.",
    });
    expect(dbMock.writesTo(schema.memberNotes)).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  it("a co-lead deletes anyone's note, and the audit row names the author by id", async () => {
    queueNoteWrite(person(ALICE, ADMIN), note(REN));
    expect(
      await store.deleteMemberNote(ALICE, { slug: SLUG, noteId: NOTE }),
    ).toEqual({ ok: true });
    const [del] = dbMock.writesTo(schema.memberNotes);
    expect(del!.kind).toBe("delete");
    expect(del!.tx).toBe(true);
    expect(boundStrings(del!)).toEqual(expect.arrayContaining([NOTE, CAMP]));
    expect(auditRows()[0]).toMatchObject({
      action: MEMBER_RECORDS_AUDIT.noteDelete,
      subject: NOTE,
      meta: {
        groupId: CAMP,
        noteId: NOTE,
        subjectUserId: JABU,
        authorUserId: REN,
      },
    });
  });

  it("a lead deletes a note whose author is gone; the audit row then has no author", async () => {
    queueNoteWrite(person(ALICE, LEAD), note(null));
    expect(
      await store.deleteMemberNote(ALICE, { slug: SLUG, noteId: NOTE }),
    ).toEqual({ ok: true });
    expect(auditRows()[0]!.meta).toEqual({
      groupId: CAMP,
      noteId: NOTE,
      subjectUserId: JABU,
    });
  });

  it("a member_notes holder deletes only their own", async () => {
    queueNoteWrite(person(REN, MEMBER), note(ALICE), { member_notes: true });
    expect(
      (await store.deleteMemberNote(REN, { slug: SLUG, noteId: NOTE })).ok,
    ).toBe(false);
    expect(dbMock.writesTo(schema.memberNotes)).toHaveLength(0);
  });

  it("someone who is no note person is refused before the note is even locked", async () => {
    queueNoteWrite(person(LERATO, MEMBER), note(LERATO));
    expect(
      await store.deleteMemberNote(LERATO, { slug: SLUG, noteId: NOTE }),
    ).toEqual({ ok: false, error: "That person isn't in this camp." });
    expect(
      dbMock.queries.filter((q) => q.arg("for") === "update"),
    ).toHaveLength(0);
    expect(dbMock.writesTo(schema.memberNotes)).toHaveLength(0);
  });

  it("an unknown note — or another camp's — is not found", async () => {
    queueNoteWrite(person(ALICE, LEAD), null, null, [person(ALICE, LEAD)]);
    expect(
      await store.deleteMemberNote(ALICE, { slug: SLUG, noteId: NOTE }),
    ).toEqual({ ok: false, error: "That note doesn't exist." });
    // Only the actor was locked: there was no person to look up.
    const [lock] = dbMock.queries.filter((q) => q.arg("for") === "share");
    expect(boundStrings(lock!)).not.toContain(JABU);
  });

  it("a note whose person has left (or been erased) meanwhile is not found", async () => {
    queueNoteWrite(person(ALICE, LEAD), note(ALICE), null, [
      person(ALICE, LEAD),
    ]);
    expect(
      await store.editMemberNote(ALICE, { slug: SLUG, noteId: NOTE, body: "x" }),
    ).toEqual({ ok: false, error: "That note doesn't exist." });
    expect(dbMock.writesTo(schema.memberNotes)).toHaveLength(0);
  });

  it("a note about the viewer is not found, even to its author's co-lead", async () => {
    queueNoteWrite(
      person(ALICE, LEAD),
      note(REN, ALICE),
      null,
      [person(ALICE, LEAD)],
    );
    expect(
      await store.deleteMemberNote(ALICE, { slug: SLUG, noteId: NOTE }),
    ).toEqual({ ok: false, error: "That note doesn't exist." });
  });

  it("invalid input, an unknown camp or no database writes nothing", async () => {
    expect(
      (await store.editMemberNote(ALICE, { slug: SLUG, noteId: NOTE, body: "" }))
        .ok,
    ).toBe(false);
    expect(
      (await store.deleteMemberNote(ALICE, { slug: SLUG, noteId: "x" })).ok,
    ).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
    dbMock.queue([]);
    expect(
      (await store.deleteMemberNote(ALICE, { slug: SLUG, noteId: NOTE })).ok,
    ).toBe(false);
    expect(dbMock.transactions).toBe(0);
    delete process.env.DATABASE_URL;
    dbMock.reset();
    expect(
      (await store.deleteMemberNote(ALICE, { slug: SLUG, noteId: NOTE })).ok,
    ).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
  });
});

describe("notes on a burner's profile", () => {
  const shared = (over: Record<string, unknown> = {}) => ({
    id: CAMP,
    name: "Mad Hatters",
    slug: SLUG,
    kind: THEME_CAMP,
    subjectArchivedAt: null,
    ...over,
  });
  const stored = (over: Record<string, unknown> = {}) => ({
    id: NOTE,
    body: SECRET,
    authorUserId: REN,
    editedByUserId: null,
    createdAt: new Date("2026-10-03T10:00:00Z"),
    updatedAt: new Date("2026-10-03T10:00:00Z"),
    authorUsername: "Ren Notfound",
    authorSanitizedAt: null,
    ...over,
  });

  it("a lead sees the camp's notes about a member, newest first, with their rights on each", async () => {
    getMemberPermissions.mockResolvedValue(perms(LEAD));
    dbMock.queue(
      [shared()],
      [
        stored({ id: "n2", authorUserId: ALICE, authorUsername: "Alice Hatter", editedByUserId: ALICE }),
        stored(),
      ],
    );
    const cards = await store.loadProfileMemberNotes({
      viewerUserId: ALICE,
      subjectUserId: JABU,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.camp).toEqual({ id: CAMP, name: "Mad Hatters", slug: SLUG });
    expect(cards[0]!.subjectArchived).toBe(false);
    expect(cards[0]!.notes.map((n) => [n.authorName, n.isOwn, n.edited, n.canEdit, n.canDelete])).toEqual([
      ["Alice Hatter", true, true, true, true],
      ["Ren Notfound", false, false, false, true],
    ]);
    // Asked about THIS camp's notes on THIS person.
    const notesQuery = dbMock.queriesTouching(schema.memberNotes)[0]!;
    expect(boundStrings(notesQuery)).toEqual(
      expect.arrayContaining([CAMP, JABU]),
    );
    expect(getMemberPermissions).toHaveBeenCalledWith(CAMP, ALICE);
  });

  it("an erased author reads as a departed account; an archived member's card says so", async () => {
    getMemberPermissions.mockResolvedValue(perms(MEMBER, { member_notes: true }));
    dbMock.queue(
      [shared({ subjectArchivedAt: new Date() })],
      [stored({ authorUsername: null, authorSanitizedAt: new Date() })],
    );
    const [card] = await store.loadProfileMemberNotes({
      viewerUserId: REN,
      subjectUserId: JABU,
    });
    expect(card!.subjectArchived).toBe(true);
    expect(card!.notes[0]!.authorName).toBe("Departed Burner");
  });

  it("a plain camp-mate, or a roster reader without member_notes, gets nothing and no note is read", async () => {
    for (const p of [perms(MEMBER), perms(MEMBER, { view_member_details: true }), null]) {
      dbMock.reset();
      getMemberPermissions.mockResolvedValue(p);
      dbMock.queue([shared()]);
      expect(
        await store.loadProfileMemberNotes({
          viewerUserId: LERATO,
          subjectUserId: JABU,
        }),
      ).toEqual([]);
      expect(dbMock.queriesTouching(schema.memberNotes)).toHaveLength(0);
    }
  });

  it("the member never sees notes about themselves: nothing is even queried", async () => {
    expect(
      await store.loadProfileMemberNotes({
        viewerUserId: JABU,
        subjectUserId: JABU,
      }),
    ).toEqual([]);
    expect(dbMock.queries).toHaveLength(0);
    expect(getMemberPermissions).not.toHaveBeenCalled();
  });

  it("no shared camp (a lead of another camp, the org) gets nothing", async () => {
    dbMock.queue([]);
    expect(
      await store.loadProfileMemberNotes({
        viewerUserId: ALICE,
        subjectUserId: JABU,
      }),
    ).toEqual([]);
    expect(dbMock.queriesTouching(schema.memberNotes)).toHaveLength(0);
    // The shared-camp read requires the VIEWER's membership to be current and
    // the subject's account not erased.
    // Only the WHERE call is walked: the join's `alias()` columns are proxies
    // that mint a fresh object on every read, so walking them never ends.
    const sharedQuery = dbMock.queries[0]!;
    const whereOnly = {
      ...sharedQuery,
      calls: sharedQuery.calls.filter((c) => c.method === "where"),
    };
    expect(nullChecksOn(whereOnly, schema.users.sanitizedAt)).toEqual([
      "is null",
    ]);
  });

  it("the org group is never a notes camp, even when shared", async () => {
    getMemberPermissions.mockResolvedValue(perms(LEAD));
    dbMock.queue([shared({ kind: GroupKind.enum.org })]);
    expect(
      await store.loadProfileMemberNotes({
        viewerUserId: ALICE,
        subjectUserId: JABU,
      }),
    ).toEqual([]);
    expect(getMemberPermissions).not.toHaveBeenCalled();
  });

  it("no database: nothing", async () => {
    delete process.env.DATABASE_URL;
    expect(
      await store.loadProfileMemberNotes({
        viewerUserId: ALICE,
        subjectUserId: JABU,
      }),
    ).toEqual([]);
  });
});

describe("the roster's note counts and duplicate hints", () => {
  const candidates = [
    { userId: JABU, username: "Thandi Mokoena" },
    { userId: LERATO, username: "Thandi Mokoena-Dube" },
    { userId: REN, username: "Pieter van Wyk" },
  ];

  it("a lead gets note counts (never their own) and duplicate pairs", async () => {
    getMemberPermissions.mockResolvedValue(perms(LEAD));
    dbMock.queue(
      campRow,
      [
        { userId: JABU, count: 2 },
        { userId: ALICE, count: 5 },
        { userId: REN, count: 0 },
      ],
      candidates,
      [],
    );
    const records = await store.loadRosterMemberRecords({
      slug: SLUG,
      viewerUserId: ALICE,
    });
    expect(records!.noteCounts).toEqual({ [JABU]: 2 });
    expect(records!.duplicatePairs).toEqual([
      {
        userIds: [JABU, LERATO],
        names: ["Thandi Mokoena", "Thandi Mokoena-Dube"],
      },
    ]);
    expect(records!.duplicates).toEqual({
      [JABU]: [{ userId: LERATO, name: "Thandi Mokoena-Dube" }],
      [LERATO]: [{ userId: JABU, name: "Thandi Mokoena" }],
    });
    // The counts query excludes the viewer in SQL as well.
    const counts = dbMock.queriesTouching(schema.memberNotes)[0]!;
    expect(boundStrings(counts)).toEqual(expect.arrayContaining([CAMP, ALICE]));
    // Counts only: the note body is never selected for the roster.
    expect(
      Object.keys(counts.arg("select") as Record<string, unknown>),
    ).toEqual(["userId", "count"]);
    // Candidates are CURRENT members on accounts that are not erased.
    const cand = dbMock.queries.find(
      (q) => q.kind === "select" && q.arg("from") === schema.memberships,
    )!;
    expect(nullChecksOn(cand, schema.memberships.archivedAt)).toEqual([
      "is null",
    ]);
    expect(nullChecksOn(cand, schema.users.sanitizedAt)).toEqual(["is null"]);
    // Names only: nothing else about a person is selected for the check.
    expect(Object.keys(cand.arg("select") as Record<string, unknown>)).toEqual([
      "userId",
      "username",
    ]);
  });

  it("a dismissed pair is not flagged again", async () => {
    getMemberPermissions.mockResolvedValue(perms(MEMBER, { view_member_details: true }));
    dbMock.queue(campRow, candidates, [{ a: JABU, b: LERATO }]);
    const records = await store.loadRosterMemberRecords({
      slug: SLUG,
      viewerUserId: REN,
    });
    expect(records).toEqual({
      noteCounts: null,
      duplicates: {},
      duplicatePairs: [],
    });
    // A roster reader without member_notes: no note is counted at all.
    expect(dbMock.queriesTouching(schema.memberNotes)).toHaveLength(0);
  });

  it("a member_notes holder who is no roster viewer gets counts, not hints", async () => {
    getMemberPermissions.mockResolvedValue(perms(MEMBER, { member_notes: true }));
    dbMock.queue(campRow, [{ userId: JABU, count: 1 }]);
    expect(
      await store.loadRosterMemberRecords({ slug: SLUG, viewerUserId: REN }),
    ).toEqual({
      noteCounts: { [JABU]: 1 },
      duplicates: null,
      duplicatePairs: null,
    });
    expect(
      dbMock.queriesTouching(schema.memberDuplicateDismissals),
    ).toHaveLength(0);
  });

  it("a plain member gets neither; a non-member or unknown camp gets null", async () => {
    getMemberPermissions.mockResolvedValue(perms(MEMBER));
    dbMock.queue(campRow);
    expect(
      await store.loadRosterMemberRecords({ slug: SLUG, viewerUserId: LERATO }),
    ).toEqual({ noteCounts: null, duplicates: null, duplicatePairs: null });
    expect(dbMock.queries).toHaveLength(1);

    dbMock.reset();
    getMemberPermissions.mockResolvedValue(null);
    dbMock.queue(campRow);
    expect(
      await store.loadRosterMemberRecords({ slug: SLUG, viewerUserId: LERATO }),
    ).toBeNull();

    dbMock.reset();
    dbMock.queue([]);
    expect(
      await store.loadRosterMemberRecords({ slug: "nope", viewerUserId: ALICE }),
    ).toBeNull();

    delete process.env.DATABASE_URL;
    expect(
      await store.loadRosterMemberRecords({ slug: SLUG, viewerUserId: ALICE }),
    ).toBeNull();
  });
});

describe("dismissing a possible duplicate", () => {
  // The pair is stored ordered; LERATO's id sorts after JABU's.
  const thandi = person(JABU, MEMBER, { username: "Thandi Mokoena" });
  const thandiDube = person(LERATO, MEMBER, {
    username: "Thandi Mokoena-Dube",
  });

  it("a roster viewer dismisses a flagged pair: one ordered row and an audit row", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, LEAD), thandi, thandiDube],
      ...rolesFor(null),
      [],
      [],
    );
    expect(
      await store.dismissDuplicate(ALICE, {
        slug: SLUG,
        userIds: [LERATO, JABU],
      }),
    ).toEqual({ ok: true });
    const [insert] = dbMock.writesTo(schema.memberDuplicateDismissals);
    expect(insert!.tx).toBe(true);
    expect(insert!.arg("values")).toEqual({
      groupId: CAMP,
      userAId: JABU,
      userBId: LERATO,
      dismissedByUserId: ALICE,
    });
    // A repeat is a no-op, not an error.
    expect(insert!.called("onConflictDoNothing")).toBe(true);
    expect(auditRows()[0]).toEqual({
      actorId: ALICE,
      action: MEMBER_RECORDS_AUDIT.duplicateDismiss,
      subject: CAMP,
      meta: { groupId: CAMP, userIds: [JABU, LERATO] },
    });
  });

  it("refuses a pair whose names are not similar, so no row can be planted", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, LEAD), thandi, person(REN, MEMBER)],
      ...rolesFor(null),
    );
    expect(
      await store.dismissDuplicate(ALICE, { slug: SLUG, userIds: [JABU, REN] }),
    ).toEqual({
      ok: false,
      error: "Those two aren't flagged as a possible duplicate.",
    });
    expect(dbMock.writesTo(schema.memberDuplicateDismissals)).toHaveLength(0);
  });

  it("refuses an archived or absent person, and a viewer who is no roster viewer", async () => {
    dbMock.queue(
      campRow,
      [
        person(ALICE, LEAD),
        thandi,
        { ...thandiDube, archivedAt: new Date() },
      ],
      ...rolesFor(null),
    );
    expect(
      (
        await store.dismissDuplicate(ALICE, {
          slug: SLUG,
          userIds: [JABU, LERATO],
        })
      ).ok,
    ).toBe(false);

    dbMock.reset();
    dbMock.queue(
      campRow,
      [person(REN, MEMBER), thandi, thandiDube],
      ...rolesFor({ member_notes: true }),
    );
    expect(
      await store.dismissDuplicate(REN, {
        slug: SLUG,
        userIds: [JABU, LERATO],
      }),
    ).toEqual({ ok: false, error: "That person isn't in this camp." });
    expect(dbMock.writesTo(schema.memberDuplicateDismissals)).toHaveLength(0);
  });

  it("refuses invalid input before any query", async () => {
    expect(
      (await store.dismissDuplicate(ALICE, { slug: SLUG, userIds: [JABU, JABU] }))
        .ok,
    ).toBe(false);
    expect(dbMock.queries).toHaveLength(0);
  });
});

describe("cleanup", () => {
  it("leaving a camp deletes that camp's notes about the person and dismissals naming them", async () => {
    await dbMock.runTransaction((tx) =>
      store.removeMemberRecordsForCamp(tx, { userId: JABU, groupId: CAMP }),
    );
    const notes = dbMock.writesTo(schema.memberNotes);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.kind).toBe("delete");
    expect(boundStrings(notes[0]!)).toEqual(
      expect.arrayContaining([CAMP, JABU]),
    );
    const dismissals = dbMock.writesTo(schema.memberDuplicateDismissals);
    expect(dismissals).toHaveLength(1);
    expect(boundStrings(dismissals[0]!)).toEqual(
      expect.arrayContaining([CAMP, JABU]),
    );
  });

  it("erasure deletes every camp's notes about the person and every dismissal naming them", async () => {
    await dbMock.runTransaction((tx) =>
      store.removeAllMemberRecords(tx, JABU),
    );
    // Only ids bound by the query (boundStrings also walks column metadata).
    const ids = (q: Parameters<typeof boundStrings>[0]) =>
      boundStrings(q).filter((s) => UUID.test(s));
    const [notes] = dbMock.writesTo(schema.memberNotes);
    expect(notes!.kind).toBe("delete");
    // Every camp: scoped to the person and nothing else (no camp id).
    expect(ids(notes!)).toEqual([JABU]);
    // ...and on the SUBJECT column: notes they WROTE about others stay.
    expect(whereMentions(notes!, schema.memberNotes.subjectUserId)).toBe(true);
    expect(whereMentions(notes!, schema.memberNotes.authorUserId)).toBe(false);
    const [dismissals] = dbMock.writesTo(schema.memberDuplicateDismissals);
    expect(dismissals!.kind).toBe("delete");
    expect(ids(dismissals!)).toEqual([JABU, JABU]);
  });
});
