import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { decrypt, encrypt } from "@quagga/db/crypto";
import { MEMBER_RECORDS_AUDIT, allProjectPermissions } from "@quagga/core";
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
const CAPTAIN = ProjectRoleKind.enum.captain;

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

const TEST_KEY = "member-records-test-key-not-a-secret";

beforeEach(() => {
  dbMock.reset();
  getMemberPermissions.mockReset();
  process.env.DATABASE_URL = "postgres://test";
  // Notes are encrypted at rest like medical notes (@quagga/db/crypto).
  process.env.PGCRYPTO_KEY = TEST_KEY;
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.PGCRYPTO_KEY;
});

/** The stored body is ciphertext of `text` — never `text` itself. */
function expectCiphertextOf(stored: unknown, text: string): void {
  expect(typeof stored).toBe("string");
  expect(stored).not.toContain(text);
  expect(stored).not.toContain("night shifts");
  expect(decrypt(stored as string)).toBe(text);
}

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
    });
    // Encrypted at rest (regression: the body was stored as plaintext).
    expectCiphertextOf(
      (insert!.arg("values") as { body: unknown }).body,
      SECRET,
    );
    // No bound value of the insert carries the text either.
    expect(boundStrings(insert!).join(" ")).not.toContain("night shifts");
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

  // Regression (Ryan, 17 Oct 2026: encrypt notes like medical notes). With no
  // PGCRYPTO_KEY a note is REFUSED — never stored in plaintext, never dropped
  // behind a success.
  it("with no encryption key, a note is refused and nothing is written", async () => {
    delete process.env.PGCRYPTO_KEY;
    dbMock.queue(
      campRow,
      [person(ALICE, LEAD), person(JABU, MEMBER)],
      ...rolesFor(null),
    );
    const result = await store.addMemberNote(ALICE, {
      slug: SLUG,
      subjectUserId: JABU,
      body: SECRET,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/encryption key/i);
    expect(dbMock.writesTo(schema.memberNotes)).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
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

  // Regression (member-records review): a `manage_roles` holder could tick
  // `member_notes` on the baseline role — which every member holds — and so
  // open every note to the whole camp. The read path clamps it by kind.
  it("member_notes stored on the BASELINE role grants nobody anything", async () => {
    dbMock.queue(
      campRow,
      [person(LERATO, MEMBER), person(JABU, MEMBER)],
      [
        { id: BASELINE_ROLE, kind: BASELINE, permissions: { member_notes: true } },
        { id: WELFARE_ROLE, kind: CUSTOM, permissions: {} },
      ],
      [],
    );
    expect(
      await store.addMemberNote(LERATO, {
        slug: SLUG,
        subjectUserId: JABU,
        body: "hi",
      }),
    ).toEqual({ ok: false, error: "That person isn't in this camp." });
    expect(dbMock.writesTo(schema.memberNotes)).toHaveLength(0);
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
  const note = (
    authorUserId: string | null,
    subjectUserId = JABU,
    body = encrypt("Great on build week."),
  ) => ({
    id: NOTE,
    subjectUserId,
    authorUserId,
    body,
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
    expect(update!.arg("set")).toMatchObject({ editedByUserId: REN });
    expectCiphertextOf((update!.arg("set") as { body: unknown }).body, SECRET);
    expect(boundStrings(update!)).toEqual(expect.arrayContaining([NOTE, CAMP]));
    const [row] = auditRows();
    expect(row).toMatchObject({
      action: MEMBER_RECORDS_AUDIT.noteUpdate,
      subject: NOTE,
      meta: { groupId: CAMP, noteId: NOTE, subjectUserId: JABU },
    });
    expect(JSON.stringify(row)).not.toContain("night shifts");
  });

  // Regression (PR #108 review): only the card hid Edit on a note that could
  // not be decrypted; the server would still overwrite that ciphertext.
  it("an edit of a note whose stored text cannot be decrypted is refused, nothing written", async () => {
    queueNoteWrite(person(REN, MEMBER), note(REN, JABU, "not-ciphertext"), {
      member_notes: true,
    });
    const result = await store.editMemberNote(REN, {
      slug: SLUG,
      noteId: NOTE,
      body: SECRET,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/can't be read/i);
    expect(dbMock.writesTo(schema.memberNotes)).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  it("with no encryption key, an edit is refused and nothing is written", async () => {
    delete process.env.PGCRYPTO_KEY;
    queueNoteWrite(person(REN, MEMBER), note(REN), { member_notes: true });
    const result = await store.editMemberNote(REN, {
      slug: SLUG,
      noteId: NOTE,
      body: SECRET,
    });
    expect(result.ok).toBe(false);
    expect(dbMock.writesTo(schema.memberNotes)).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
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
    body: encrypt(SECRET),
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
    // A structural lead: the export action shows (the route re-decides).
    expect(cards[0]!.canExport).toBe(true);
    expect(cards[0]!.notes.map((n) => [n.authorName, n.isOwn, n.edited, n.canEdit, n.canDelete])).toEqual([
      ["Alice Hatter", true, true, true, true],
      ["Ren Notfound", false, false, false, true],
    ]);
    // Read round-trips: the stored ciphertext comes back as the text.
    expect(cards[0]!.notes.map((n) => [n.body, n.unreadable])).toEqual([
      [SECRET, false],
      [SECRET, false],
    ]);
    // Asked about THIS camp's notes on THIS person.
    const notesQuery = dbMock.queriesTouching(schema.memberNotes)[0]!;
    expect(boundStrings(notesQuery)).toEqual(
      expect.arrayContaining([CAMP, JABU]),
    );
    expect(getMemberPermissions).toHaveBeenCalledWith(CAMP, ALICE);
  });

  it("a note this process cannot decrypt reads as unreadable: no text, no edit, still deletable", async () => {
    getMemberPermissions.mockResolvedValue(perms(LEAD));
    dbMock.queue(
      [shared()],
      [
        stored({ id: "n2", body: "not-ciphertext", authorUserId: ALICE, authorUsername: "Alice Hatter" }),
      ],
    );
    const [card] = await store.loadProfileMemberNotes({
      viewerUserId: ALICE,
      subjectUserId: JABU,
    });
    expect(card!.notes[0]).toMatchObject({
      body: "",
      unreadable: true,
      canEdit: false,
      canDelete: true,
    });
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
    // A note-keeper who is not a lead keeps notes but cannot export them.
    expect(card!.canExport).toBe(false);
    expect(card!.notes[0]!.authorName).toBe("Departed Burner");
  });

  it("the card offers the export to a captain of the camp, not to a custom all-privileges role", async () => {
    for (const [holds, expected] of [[true, true], [false, false]] as const) {
      dbMock.reset();
      getMemberPermissions.mockResolvedValue({
        ...perms(MEMBER, allProjectPermissions()),
        holdsCaptainRole: holds,
      });
      dbMock.queue([shared()], [stored()]);
      const [card] = await store.loadProfileMemberNotes({
        viewerUserId: REN,
        subjectUserId: JABU,
      });
      expect(card!.canExport).toBe(expected);
    }
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
      [{ groupId: CAMP }],
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

  // Regression (member-records review): a repeat dismissal inserted nothing
  // but still wrote an audit row for a dismissal that did not happen.
  it("a pair already dismissed is a no-op: ok, and no second audit row", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, LEAD), thandi, thandiDube],
      ...rolesFor(null),
      [],
    );
    expect(
      await store.dismissDuplicate(ALICE, {
        slug: SLUG,
        userIds: [JABU, LERATO],
      }),
    ).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.memberDuplicateDismissals)).toHaveLength(1);
    expect(auditRows()).toHaveLength(0);
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

// --- Export: POPIA s23 access request (#105; Ryan, 18 Oct 2026) --------------

describe("exporting a member's notes", () => {
  const input = { slug: SLUG, subjectUserId: JABU };
  const row = (over: Record<string, unknown> = {}) => ({
    body: encrypt(SECRET),
    editedByUserId: null,
    createdAt: new Date("2026-10-03T10:00:00Z"),
    updatedAt: new Date("2026-10-03T10:00:00Z"),
    ...over,
  });

  it("a lead gets the file: oldest first, decrypted, no author, and ONE audit row of ids and a count", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, LEAD), person(JABU, MEMBER)],
      ...rolesFor(null),
      [
        row({
          body: encrypt("Great on build week."),
          createdAt: new Date("2026-09-01T10:00:00Z"),
          editedByUserId: REN,
          updatedAt: new Date("2026-09-20T10:00:00Z"),
        }),
        row({ body: "not-ciphertext", createdAt: new Date("2026-09-10T10:00:00Z") }),
        row(),
      ],
      [],
    );
    const result = await store.exportMemberNotes(ALICE, input);
    if (!result.ok) throw new Error(result.error);
    expect(result.noteCount).toBe(3);
    expect(result.filename).toMatch(
      /^member-notes-mad-hatters-jabu-\d{4}-\d{2}-\d{2}\.txt$/,
    );
    expect(result.text).toContain("Private notes kept by Mad Hatters");
    expect(result.text).toContain("About: Jabu");
    expect(result.text).toContain(
      "Written: 1 September 2026\nLast edited: 20 September 2026\n\nGreat on build week.",
    );
    expect(result.text).toContain(
      "Written: 10 September 2026\n\n[This note could not be read]",
    );
    expect(result.text).toContain(SECRET);
    // Never the ciphertext, never an author.
    expect(result.text).not.toContain("not-ciphertext");
    expect(result.text).not.toMatch(/Ren Notfound|Alice Hatter/);
    expect(result.text).not.toContain(REN);

    // The notes query selects no author column, and reads THIS camp's notes
    // about THIS person, inside the locked transaction.
    const notesQuery = dbMock.queriesTouching(schema.memberNotes)[0]!;
    expect(notesQuery.tx).toBe(true);
    const selected = notesQuery.arg("select") as Record<string, unknown>;
    expect(Object.keys(selected).sort()).toEqual(
      ["body", "createdAt", "editedByUserId", "updatedAt"],
    );
    expect(boundStrings(notesQuery)).toEqual(
      expect.arrayContaining([CAMP, JABU]),
    );

    const audits = auditRows();
    expect(audits).toEqual([
      {
        actorId: ALICE,
        action: MEMBER_RECORDS_AUDIT.noteExport,
        subject: CAMP,
        meta: { groupId: CAMP, subjectUserId: JABU, noteCount: "3" },
      },
    ]);
    expect(JSON.stringify(audits)).not.toContain("night shifts");
    expect(JSON.stringify(audits)).not.toContain("build week");
    expect(dbMock.writesTo(schema.auditEvents)[0]!.tx).toBe(true);
    // A read: nothing is written to the notes.
    expect(dbMock.writesTo(schema.memberNotes)).toHaveLength(0);
  });

  it("a co-lead may export; an archived member's notes can be exported", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, ADMIN), person(JABU, MEMBER, { archivedAt: new Date() })],
      ...rolesFor(null),
      [row()],
      [],
    );
    const result = await store.exportMemberNotes(ALICE, input);
    expect(result.ok).toBe(true);
  });

  // Ryan, 18 Oct 2026: captains of THIS camp export too. The signal is the
  // Captain role's KIND, held with accepted consent in this camp.
  const CAPTAIN_ROLE = "77777777-0000-4000-8000-000000000003";
  const withCaptainRole = (held: boolean, kind: string = CAPTAIN) => [
    [
      { id: BASELINE_ROLE, kind: BASELINE, permissions: {} },
      { id: CAPTAIN_ROLE, kind, permissions: allProjectPermissions() },
    ],
    held ? [{ projectRoleId: CAPTAIN_ROLE }] : [],
  ];

  it("a captain of this camp (a plain member holding the Captain role) may export", async () => {
    dbMock.queue(
      campRow,
      [person(REN, MEMBER), person(JABU, MEMBER)],
      ...withCaptainRole(true),
      [row()],
      [],
    );
    const result = await store.exportMemberNotes(REN, input);
    expect(result.ok).toBe(true);
    expect(auditRows()).toEqual([
      expect.objectContaining({
        actorId: REN,
        action: MEMBER_RECORDS_AUDIT.noteExport,
      }),
    ]);
  });

  it("a CUSTOM role granting every privilege is not the Captain role: refused", async () => {
    dbMock.queue(
      campRow,
      [person(REN, MEMBER), person(JABU, MEMBER)],
      ...withCaptainRole(true, CUSTOM),
    );
    const result = await store.exportMemberNotes(REN, input);
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    expect(dbMock.queriesTouching(schema.memberNotes)).toHaveLength(0);
  });

  it("the camp has a Captain role but this member does not hold it (or not accepted): refused", async () => {
    // The assignments query only returns ACCEPTED rows; none here.
    dbMock.queue(
      campRow,
      [person(REN, MEMBER), person(JABU, MEMBER)],
      ...withCaptainRole(false),
    );
    const result = await store.exportMemberNotes(REN, input);
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("a member_notes holder who is not a lead is refused as not found: no note read, no audit", async () => {
    dbMock.queue(
      campRow,
      [person(REN, MEMBER), person(JABU, MEMBER)],
      ...rolesFor({ member_notes: true }),
    );
    const result = await store.exportMemberNotes(REN, input);
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    expect(dbMock.queriesTouching(schema.memberNotes)).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  it("the member themself, a plain member, a stranger and an archived lead are refused alike", async () => {
    const cases: [string, unknown[], Record<string, unknown>][] = [
      // The subject asks for their own notes: even as a lead of the camp.
      [JABU, [person(JABU, LEAD)], { slug: SLUG, subjectUserId: JABU }],
      // A plain member.
      [LERATO, [person(LERATO, MEMBER), person(JABU, MEMBER)], input],
      // A lead of ANOTHER camp: no membership row here at all.
      [ALICE, [person(JABU, MEMBER)], input],
      // A lead who has been archived out of the camp.
      [ALICE, [person(ALICE, LEAD, { archivedAt: new Date() }), person(JABU, MEMBER)], input],
    ];
    for (const [actor, people, payload] of cases) {
      dbMock.reset();
      dbMock.queue(campRow, people, ...rolesFor(null));
      const result = await store.exportMemberNotes(actor, payload);
      expect(result).toMatchObject({ ok: false, reason: "not_found" });
      expect(dbMock.queriesTouching(schema.memberNotes)).toHaveLength(0);
      expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
    }
  });

  it("someone not in the camp (left, erased, unknown) is not found, even to a lead", async () => {
    dbMock.queue(campRow, [person(ALICE, LEAD)], ...rolesFor(null));
    const result = await store.exportMemberNotes(ALICE, input);
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    expect(dbMock.queriesTouching(schema.memberNotes)).toHaveLength(0);
  });

  it("the org group is never a notes camp", async () => {
    dbMock.queue([{ ...campRow[0], kind: GroupKind.enum.org }]);
    const result = await store.exportMemberNotes(ALICE, input);
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    expect(dbMock.transactions).toBe(0);
  });

  it("with no encryption key, a lead is told so and gets no partial file and no audit row", async () => {
    delete process.env.PGCRYPTO_KEY;
    dbMock.queue(
      campRow,
      [person(ALICE, LEAD), person(JABU, MEMBER)],
      ...rolesFor(null),
    );
    const result = await store.exportMemberNotes(ALICE, input);
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(result.ok ? "" : result.error).toMatch(/encryption key/i);
    expect(dbMock.queriesTouching(schema.memberNotes)).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  // Regression (review): a configured but WRONG key read every note as
  // unreadable and still sent — and audited — a file of placeholders.
  it("a key that reads none of the notes is refused like no key: no file, no audit row", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, LEAD), person(JABU, MEMBER)],
      ...rolesFor(null),
      [row({ body: "not-ciphertext" }), row({ body: "also-not" })],
    );
    const result = await store.exportMemberNotes(ALICE, input);
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(result.ok ? "" : result.error).toMatch(/encryption key/i);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  it("a camp with no notes about the member still answers, with a file saying so", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, LEAD), person(JABU, MEMBER)],
      ...rolesFor(null),
      [],
      [],
    );
    const result = await store.exportMemberNotes(ALICE, input);
    if (!result.ok) throw new Error(result.error);
    expect(result.noteCount).toBe(0);
    expect(result.text).toContain("The camp keeps no notes about you.");
    expect(auditRows()).toHaveLength(1);
  });

  it("a malformed payload is not found before anything is read", async () => {
    for (const raw of [
      { slug: SLUG, subjectUserId: "not-a-uuid" },
      { slug: SLUG },
      { slug: SLUG, subjectUserId: JABU, extra: 1 },
      null,
    ]) {
      const result = await store.exportMemberNotes(ALICE, raw);
      expect(result).toMatchObject({ ok: false, reason: "not_found" });
    }
    expect(dbMock.queries).toHaveLength(0);
  });

  it("locks both people's memberships and accounts FOR SHARE before reading", async () => {
    dbMock.queue(
      campRow,
      [person(ALICE, LEAD), person(JABU, MEMBER)],
      ...rolesFor(null),
      [],
      [],
    );
    await store.exportMemberNotes(ALICE, input);
    const lock = dbMock.queriesTouching(schema.memberships)[0]!;
    expect(lock.tx).toBe(true);
    expect(lock.called("for")).toBe(true);
    expect(lock.arg("for")).toBe("share");
  });
});
