import "server-only";

import { alias } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { activeMembership } from "@quagga/db";
import {
  MEMBER_RECORDS_AUDIT,
  buildMemberNotesExport,
  canDeleteMemberNote,
  canEditMemberNote,
  canExportMemberNotes,
  canManageMemberNotes,
  canReadMemberNotes,
  canSeeDuplicateHints,
  decideAddMemberNote,
  decideDeleteMemberNote,
  decideDismissDuplicate,
  decideEditMemberNote,
  duplicatesByUser,
  enforceKindPermissions,
  findDuplicatePairs,
  holdsCaptainRole,
  memberRecordsAvailableForGroup,
  memberNotesExportFilename,
  memberRecordsRefusalMessage,
  orderedUserPair,
  publicMemberName,
  type DuplicateCandidate,
  type DuplicatePair,
  type MemberNoteFacts,
  type MemberNotesViewer,
  type MemberRecordsDecision,
  type PermissionMembership,
} from "@quagga/core";
import {
  AddMemberNoteInput,
  DeleteMemberNoteInput,
  DismissDuplicateInput,
  EditMemberNoteInput,
  ExportMemberNotesInput,
  type GroupKind,
  type MembershipRole,
  type ProjectPermissions,
  type ProjectRoleKind,
} from "@quagga/types";
import { isDatabaseConfigured } from "./config";
import { decryptField, isCryptoConfigured, safeEncrypt } from "./crypto-guard";
import { db, schema, withTransaction, type Tx } from "./db";
import { getMemberPermissions } from "./roles-store";

// Member records: lead notes and duplicate hints (docs/member-records-spec.md).
// Every rule is a pure @quagga/core function (member-records.ts); this file
// loads the facts those functions read — from the database, never from the
// request — and performs the writes.
//
// SCOPING. A request names a camp by slug and then ids: a person, a note, a
// pair. The viewer's ACTIVE membership of that camp is resolved first, and
// their permissions from the camp's roles. A note is only ever found by
// (id, this camp), so another camp's note answers like an unknown id. The
// person a note is about must hold a membership of THIS camp — current or
// archived — on an account that is not erased; anyone else is "not found".
//
// RACES. Every write runs in one transaction that first locks the memberships
// AND accounts it depends on — the actor's and the person's — `FOR SHARE`, in
// one statement, ordered by membership id (the camp-teams / Work Access Pass
// pattern). `leaveCamp` deletes the membership row before it deletes the
// notes, and erasure takes the users row `FOR UPDATE` first, so either the
// note write waits and then finds nobody, or the cleanup comes after it and
// deletes what it wrote. A note being edited or deleted is then locked
// `FOR UPDATE`, so two writes to one note serialise. Lock order is
// memberships/users → note row everywhere in this file.
//
// AUDIT. Every create, edit, delete and dismissal writes an `audit_events`
// row in the same transaction: ids only, NEVER the note's text. Reading is not
// audited, as roster reads are not.
//
// PRIVACY. Notes are read here and nowhere else, and only for a note person of
// the camp about someone other than themselves. The roster gets a COUNT per
// member for note people (never text); nothing here feeds a roster or CSV
// export, stats, search, the org console or a notification. The ONE export is
// `exportMemberNotes`: a lead's, co-lead's or captain's file of one member's
// notes, to answer that member's POPIA s23 request (#105) — no author, audited. Duplicate hints compare the
// names the roster shows and nothing else — no phone, ID or other hard-locked
// field is selected by this file.

/** A member-records write's result: ok with extras, or one sentence. */
export type MemberRecordsResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string };

const INVALID = "Check the note and try again.";
const NOT_FOUND = memberRecordsRefusalMessage("not_found");
// REFUSE, DON'T DROP — the medical-notes rule (bio-store.ts). A note's body is
// encrypted at rest exactly like `burner_bios.medical_notes`; with no
// PGCRYPTO_KEY it is never stored, in plaintext or at all, and the writer is
// told so rather than shown a success.
// An edit of a note whose stored text cannot be decrypted (a wrong or rotated
// PGCRYPTO_KEY): refused, so the edit cannot overwrite words nobody can read.
// The card hides Edit on such a note; this is the server's own refusal.
const UNREADABLE_NOTE =
  "This note can't be read with the site's current encryption key, so it " +
  "can't be edited. It can still be deleted.";
const NO_KEY =
  "Private notes can't be saved right now: this site's encryption key isn't " +
  "configured. Nothing was saved. Tell an organiser (PGCRYPTO_KEY is missing).";

/** A note's text as stored: AES-256-GCM ciphertext, or null with no key. */
function encryptNoteBody(text: string): string | null {
  return isCryptoConfigured() ? safeEncrypt(text) : null;
}

function refused(decision: MemberRecordsDecision): {
  ok: false;
  error: string;
} {
  return {
    ok: false,
    error: decision.ok ? INVALID : memberRecordsRefusalMessage(decision.reason),
  };
}

type Handle = Tx | ReturnType<typeof db>;

// --- Camp and people -----------------------------------------------------------

interface RecordsCamp {
  id: string;
  name: string;
  slug: string;
}

/** The camp by slug, if it is a kind that keeps member records (any project). */
async function findCamp(slug: string): Promise<RecordsCamp | null> {
  const [group] = await db()
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      slug: schema.groups.slug,
      kind: schema.groups.kind,
    })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  if (!group || !memberRecordsAvailableForGroup(group.kind as GroupKind))
    return null;
  return { id: group.id, name: group.name, slug: group.slug };
}

interface CampRoleRow {
  id: string;
  kind: ProjectRoleKind;
  permissions: ProjectPermissions;
}

/** The viewer's permissions in a camp, read on the write's handle: the
 * baseline role's plus every role they hold with ACCEPTED consent, each
 * clamped to what its kind may grant (a captain always holds everything). */
async function loadPermissions(
  handle: Handle,
  groupId: string,
  membershipId: string,
  role: MembershipRole,
): Promise<PermissionMembership & { holdsCaptainRole: boolean }> {
  const roles: CampRoleRow[] = await handle
    .select({
      id: schema.projectRoles.id,
      kind: schema.projectRoles.kind,
      permissions: schema.projectRoles.permissions,
    })
    .from(schema.projectRoles)
    .where(eq(schema.projectRoles.groupId, groupId));
  const held = await handle
    .select({ projectRoleId: schema.memberRoleAssignments.projectRoleId })
    .from(schema.memberRoleAssignments)
    .where(
      and(
        eq(schema.memberRoleAssignments.membershipId, membershipId),
        eq(schema.memberRoleAssignments.consentStatus, "accepted"),
      ),
    );
  const heldIds = new Set(held.map((h) => h.projectRoleId));
  return {
    structuralRole: role,
    rolePermissions: roles
      .filter((r) => r.kind === "baseline" || heldIds.has(r.id))
      .map((r) => enforceKindPermissions(r.kind, r.permissions)),
    // The Captain role's KIND, held with accepted consent in THIS camp — never
    // inferred from permissions (a custom role may grant every privilege).
    holdsCaptainRole: holdsCaptainRole(
      roles.filter((r) => heldIds.has(r.id)).map((r) => r.kind),
    ),
  };
}

interface LockedPerson {
  userId: string;
  membershipId: string;
  role: MembershipRole;
  archived: boolean;
  name: string;
}

/**
 * Lock the memberships of this camp AND the accounts of everyone named —
 * `FOR SHARE`, in ONE statement, before any note row. Current and archived
 * memberships both come back (`archived` says which); an erased account never
 * does. Postgres re-checks the WHERE on a row it waited for, so a membership
 * deleted by `leaveCamp` or an account tombstoned by erasure meanwhile is gone.
 */
async function lockPeople(
  tx: Tx,
  groupId: string,
  userIds: readonly string[],
): Promise<Map<string, LockedPerson>> {
  const ids = [...new Set(userIds.map((id) => id.toLowerCase()))];
  const rows = await tx
    .select({
      userId: schema.memberships.userId,
      membershipId: schema.memberships.id,
      role: schema.memberships.role,
      archivedAt: schema.memberships.archivedAt,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        inArray(schema.memberships.userId, ids),
        isNull(schema.users.sanitizedAt),
      ),
    )
    .orderBy(asc(schema.memberships.id))
    // The USERS row too: erasure locks it `FOR UPDATE` before deleting notes
    // (account-sanitize.ts step 1c) and never touches a membership row.
    .for("share", { of: [schema.memberships, schema.users] });
  const out = new Map<string, LockedPerson>();
  for (const r of rows) {
    // `isNull(sanitizedAt)` is re-evaluated on the waited-for row; this is
    // the belt to that brace.
    if (r.sanitizedAt !== null) continue;
    out.set(r.userId.toLowerCase(), {
      userId: r.userId,
      membershipId: r.membershipId,
      role: r.role,
      archived: r.archivedAt !== null,
      name: publicMemberName(r.username),
    });
  }
  return out;
}

/** The actor as the rules see them: a CURRENT membership, with permissions. */
async function actorViewer(
  tx: Tx,
  groupId: string,
  userId: string,
  people: Map<string, LockedPerson>,
): Promise<MemberNotesViewer> {
  const me = people.get(userId.toLowerCase());
  if (!me || me.archived) return { userId, membership: null };
  const { holdsCaptainRole: captain, ...membership } = await loadPermissions(
    tx,
    groupId,
    me.membershipId,
    me.role,
  );
  return { userId, membership, holdsCaptainRole: captain };
}

/** One `audit_events` row in the caller's transaction. `meta` holds ids
 * only — never a note's text. */
async function audit(
  tx: Tx,
  actorId: string,
  action: string,
  subject: string,
  meta: Record<string, string | readonly string[]>,
): Promise<void> {
  await tx
    .insert(schema.auditEvents)
    .values({ actorId, action, subject, meta });
}

/**
 * The shape every write shares: parse, find the camp, open the transaction,
 * lock the actor and the people named, and hand over.
 */
async function withRecordsWrite<T>(
  slug: string,
  viewerUserId: string,
  otherUserIds: readonly string[],
  fn: (
    tx: Tx,
    ctx: {
      camp: RecordsCamp;
      viewer: MemberNotesViewer;
      people: Map<string, LockedPerson>;
      now: Date;
    },
  ) => Promise<MemberRecordsResult<T>>,
): Promise<MemberRecordsResult<T>> {
  if (!isDatabaseConfigured()) return { ok: false, error: NOT_FOUND };
  const camp = await findCamp(slug);
  if (!camp) return { ok: false, error: NOT_FOUND };
  return withTransaction(async (tx) => {
    const people = await lockPeople(tx, camp.id, [
      viewerUserId,
      ...otherUserIds,
    ]);
    const viewer = await actorViewer(tx, camp.id, viewerUserId, people);
    return fn(tx, { camp, viewer, people, now: new Date() });
  });
}

// --- Reads: notes on a profile -------------------------------------------------

/** One note as the Private notes card shows it. */
export interface MemberNoteView {
  id: string;
  /** The decrypted text; "" when `unreadable`. */
  body: string;
  /** Ciphertext is stored but this process cannot decrypt it (a wrong or
   * rotated PGCRYPTO_KEY). Shown as such — never as an empty note — and not
   * editable, so an edit can never overwrite text nobody could read. */
  unreadable: boolean;
  /** The author's handle ("Departed Burner" for an erased account). */
  authorName: string;
  isOwn: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** The author rewrote it after writing it. */
  edited: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

/** The Private notes card for one camp the viewer and the person share. */
export interface ProfileMemberNotes {
  camp: RecordsCamp;
  /** The person is an archived (former) member of this camp. */
  subjectArchived: boolean;
  /** The viewer may export these notes for the member (a structural lead,
   * co-lead or captain: @quagga/core `canExportMemberNotes`). The export route decides
   * again from the database on every call; this only shows the button. */
  canExport: boolean;
  notes: MemberNoteView[];
}

/** A camp's notes about one person, newest first, shaped for the viewer. */
async function loadNotes(
  groupId: string,
  subjectUserId: string,
  viewer: MemberNotesViewer,
): Promise<MemberNoteView[]> {
  const rows = await db()
    .select({
      id: schema.memberNotes.id,
      body: schema.memberNotes.body,
      authorUserId: schema.memberNotes.authorUserId,
      editedByUserId: schema.memberNotes.editedByUserId,
      createdAt: schema.memberNotes.createdAt,
      updatedAt: schema.memberNotes.updatedAt,
      authorUsername: schema.users.username,
      authorSanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.memberNotes)
    .leftJoin(schema.users, eq(schema.users.id, schema.memberNotes.authorUserId))
    .where(
      and(
        eq(schema.memberNotes.groupId, groupId),
        eq(schema.memberNotes.subjectUserId, subjectUserId),
      ),
    )
    .orderBy(desc(schema.memberNotes.createdAt), desc(schema.memberNotes.id));
  return rows.map((r) => {
    const facts: MemberNoteFacts = {
      authorUserId: r.authorUserId,
      subjectUserId,
    };
    const text = decryptField(r.body);
    const unreadable = text.state !== "ok";
    return {
      id: r.id,
      body: text.value ?? "",
      unreadable,
      authorName: publicMemberName(r.authorUsername, {
        sanitizedAt: r.authorSanitizedAt,
      }),
      isOwn: r.authorUserId !== null && r.authorUserId === viewer.userId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      edited: r.editedByUserId !== null,
      canEdit: !unreadable && canEditMemberNote(viewer, facts),
      canDelete: canDeleteMemberNote(viewer, facts),
    };
  });
}

/**
 * The Private notes cards a burner's profile shows THIS viewer (frame R1):
 * one per project the viewer is a CURRENT member of, where the person holds a
 * membership (current or archived) on an account that is not erased, and the
 * viewer is a note person of that camp. Everyone else — a plain camp-mate, a
 * roster reader without `member_notes`, a lead of another camp, the person
 * themselves, the org — gets an empty list, decided by @quagga/core before
 * any note is read.
 */
export async function loadProfileMemberNotes(input: {
  viewerUserId: string;
  subjectUserId: string;
}): Promise<ProfileMemberNotes[]> {
  if (!isDatabaseConfigured()) return [];
  // The person never sees notes about themselves: nothing is even queried.
  if (input.viewerUserId === input.subjectUserId) return [];
  // former members: the SUBJECT may be archived (notes outlive archiving),
  // while the VIEWER's aliased membership is filtered to current below.
  const viewerMs = alias(schema.memberships, "viewer_membership");
  const shared = await db()
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      slug: schema.groups.slug,
      kind: schema.groups.kind,
      subjectArchivedAt: schema.memberships.archivedAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.memberships.groupId))
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .innerJoin(
      viewerMs,
      and(
        eq(viewerMs.groupId, schema.memberships.groupId),
        eq(viewerMs.userId, input.viewerUserId),
        isNull(viewerMs.archivedAt),
      ),
    )
    .where(
      and(
        eq(schema.memberships.userId, input.subjectUserId),
        isNull(schema.users.sanitizedAt),
      ),
    )
    .orderBy(schema.groups.name);

  const cards: ProfileMemberNotes[] = [];
  for (const group of shared) {
    if (!memberRecordsAvailableForGroup(group.kind as GroupKind)) continue;
    const membership = await getMemberPermissions(
      group.id,
      input.viewerUserId,
    );
    const viewer: MemberNotesViewer = {
      userId: input.viewerUserId,
      membership,
      holdsCaptainRole: membership?.holdsCaptainRole === true,
    };
    if (
      !canReadMemberNotes(viewer, {
        userId: input.subjectUserId,
        inCamp: true,
      })
    ) {
      continue;
    }
    cards.push({
      camp: { id: group.id, name: group.name, slug: group.slug },
      subjectArchived: group.subjectArchivedAt !== null,
      canExport: canExportMemberNotes(viewer, {
        userId: input.subjectUserId,
        inCamp: true,
      }),
      notes: await loadNotes(group.id, input.subjectUserId, viewer),
    });
  }
  return cards;
}

// --- Reads: the roster ---------------------------------------------------------

/** What the roster adds to its rows for THIS viewer. Each part is null when
 * the viewer may not see it. */
export interface RosterMemberRecords {
  /** userId → how many notes the camp keeps about them. Note people only;
   * never the viewer's own row; a member with none is absent. */
  noteCounts: Record<string, number> | null;
  /** userId → the current member(s) they may duplicate. Roster viewers only. */
  duplicates: Record<string, DuplicateCandidate[]> | null;
  /** The flagged pairs, for the dismiss popover. Roster viewers only. */
  duplicatePairs: DuplicatePair[] | null;
}

/** How many notes the camp keeps about each person, never the viewer. */
async function loadNoteCounts(
  groupId: string,
  viewerUserId: string,
): Promise<Record<string, number>> {
  const rows = await db()
    .select({
      userId: schema.memberNotes.subjectUserId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.memberNotes)
    .where(
      and(
        eq(schema.memberNotes.groupId, groupId),
        ne(schema.memberNotes.subjectUserId, viewerUserId),
      ),
    )
    .groupBy(schema.memberNotes.subjectUserId);
  const out: Record<string, number> = {};
  for (const r of rows) {
    // Belt and braces with the WHERE: the viewer's own count never leaves.
    if (r.userId === viewerUserId) continue;
    const n = Number(r.count);
    if (n > 0) out[r.userId] = n;
  }
  return out;
}

/** The camp's current members as the duplicate check sees them: an id and
 * the roster's name. No other column is selected. */
async function loadDuplicateCandidates(
  handle: Handle,
  groupId: string,
): Promise<DuplicateCandidate[]> {
  const rows = await handle
    .select({
      userId: schema.memberships.userId,
      username: schema.users.username,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    );
  return rows.map((r) => ({
    userId: r.userId,
    name: publicMemberName(r.username),
  }));
}

/** The camp's dismissed pairs. */
async function loadDismissals(
  groupId: string,
): Promise<[string, string][]> {
  const rows = await db()
    .select({
      a: schema.memberDuplicateDismissals.userAId,
      b: schema.memberDuplicateDismissals.userBId,
    })
    .from(schema.memberDuplicateDismissals)
    .where(eq(schema.memberDuplicateDismissals.groupId, groupId));
  return rows.map((r) => [r.a, r.b]);
}

/**
 * The note counts and duplicate hints the roster (frame R2) shows THIS
 * viewer, or null when there is no such camp or the viewer is not a current
 * member. Each part is decided by @quagga/core before its rows are read: note
 * counts for note people, duplicate hints for roster viewers.
 */
export async function loadRosterMemberRecords(input: {
  slug: string;
  viewerUserId: string;
}): Promise<RosterMemberRecords | null> {
  if (!isDatabaseConfigured()) return null;
  const camp = await findCamp(input.slug);
  if (!camp) return null;
  const membership = await getMemberPermissions(camp.id, input.viewerUserId);
  if (!membership) return null;

  const noteCounts = canManageMemberNotes(membership)
    ? await loadNoteCounts(camp.id, input.viewerUserId)
    : null;

  if (!canSeeDuplicateHints(membership)) {
    return { noteCounts, duplicates: null, duplicatePairs: null };
  }
  const candidates = await loadDuplicateCandidates(db(), camp.id);
  const dismissed = await loadDismissals(camp.id);
  const pairs = findDuplicatePairs(candidates, dismissed);
  return {
    noteCounts,
    duplicates: Object.fromEntries(duplicatesByUser(pairs)),
    duplicatePairs: pairs,
  };
}

// --- Writes: notes ---------------------------------------------------------------

/** Add a note about a current or archived member of the camp. */
export async function addMemberNote(
  viewerUserId: string,
  raw: unknown,
): Promise<MemberRecordsResult<{ noteId: string }>> {
  const parsed = AddMemberNoteInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const input = parsed.data;
  // Postgres hands uuids back lowercase; compare like with like.
  const subjectUserId = input.subjectUserId.toLowerCase();
  return withRecordsWrite(
    input.slug,
    viewerUserId,
    [subjectUserId],
    async (tx, { camp, viewer, people, now }) => {
      const subject = {
        userId: subjectUserId,
        inCamp: people.has(subjectUserId),
      };
      const decision = decideAddMemberNote(viewer, subject);
      if (!decision.ok) return refused(decision);
      const body = encryptNoteBody(input.body);
      if (body === null) return { ok: false, error: NO_KEY };
      const [row] = await tx
        .insert(schema.memberNotes)
        .values({
          groupId: camp.id,
          subjectUserId,
          body,
          authorUserId: viewerUserId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: schema.memberNotes.id });
      if (!row) return { ok: false, error: INVALID };
      await audit(tx, viewerUserId, MEMBER_RECORDS_AUDIT.noteCreate, row.id, {
        groupId: camp.id,
        noteId: row.id,
        subjectUserId,
      });
      return { ok: true, noteId: row.id };
    },
  );
}

/** The note's subject, read unlocked, so the people can be locked first. */
async function noteSubject(
  groupId: string,
  noteId: string,
): Promise<string | null> {
  const [row] = await db()
    .select({ subjectUserId: schema.memberNotes.subjectUserId })
    .from(schema.memberNotes)
    .where(
      and(
        eq(schema.memberNotes.id, noteId),
        eq(schema.memberNotes.groupId, groupId),
      ),
    )
    .limit(1);
  return row?.subjectUserId ?? null;
}

/** A locked note: the facts the rules read, and its stored ciphertext. */
type LockedNote = MemberNoteFacts & { id: string; body: string };

/**
 * The note row `FOR UPDATE`, scoped to this camp, as the rules see it — or
 * null when it does not exist here, or its person is no longer in the camp
 * (left, or erased) — the same "not found".
 */
async function lockNote(
  tx: Tx,
  groupId: string,
  noteId: string,
  people: Map<string, LockedPerson>,
): Promise<LockedNote | null> {
  const [row] = await tx
    .select({
      id: schema.memberNotes.id,
      subjectUserId: schema.memberNotes.subjectUserId,
      authorUserId: schema.memberNotes.authorUserId,
      // The stored ciphertext: an edit must never overwrite text this
      // process cannot read (see editMemberNote).
      body: schema.memberNotes.body,
    })
    .from(schema.memberNotes)
    .where(
      and(
        eq(schema.memberNotes.id, noteId),
        eq(schema.memberNotes.groupId, groupId),
      ),
    )
    .limit(1)
    .for("update");
  if (!row || !people.has(row.subjectUserId.toLowerCase())) return null;
  return row;
}

/** A note write by id: find its person, lock both people, then the note. */
async function withNoteWrite<T>(
  slug: string,
  viewerUserId: string,
  noteId: string,
  fn: (
    tx: Tx,
    ctx: {
      camp: RecordsCamp;
      viewer: MemberNotesViewer;
      note: LockedNote | null;
      now: Date;
    },
  ) => Promise<MemberRecordsResult<T>>,
): Promise<MemberRecordsResult<T>> {
  if (!isDatabaseConfigured()) return { ok: false, error: NOT_FOUND };
  const camp = await findCamp(slug);
  if (!camp) return { ok: false, error: NOT_FOUND };
  const subjectUserId = await noteSubject(camp.id, noteId);
  return withTransaction(async (tx) => {
    const people = await lockPeople(
      tx,
      camp.id,
      subjectUserId ? [viewerUserId, subjectUserId] : [viewerUserId],
    );
    const viewer = await actorViewer(tx, camp.id, viewerUserId, people);
    // Not a note person: refused before the note is even looked at.
    if (!canManageMemberNotes(viewer.membership)) {
      return refused({ ok: false, reason: "not_found" });
    }
    const note = await lockNote(tx, camp.id, noteId, people);
    return fn(tx, { camp, viewer, note, now: new Date() });
  });
}

/** Rewrite one of your own notes. */
export async function editMemberNote(
  viewerUserId: string,
  raw: unknown,
): Promise<MemberRecordsResult> {
  const parsed = EditMemberNoteInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const input = parsed.data;
  return withNoteWrite(
    input.slug,
    viewerUserId,
    input.noteId,
    async (tx, { camp, viewer, note, now }) => {
      const decision = decideEditMemberNote(viewer, note);
      if (!decision.ok || !note) return refused(decision);
      if (!isCryptoConfigured()) return { ok: false, error: NO_KEY };
      if (decryptField(note.body).state !== "ok") {
        return { ok: false, error: UNREADABLE_NOTE };
      }
      const body = encryptNoteBody(input.body);
      if (body === null) return { ok: false, error: NO_KEY };
      await tx
        .update(schema.memberNotes)
        .set({ body, editedByUserId: viewerUserId, updatedAt: now })
        .where(
          and(
            eq(schema.memberNotes.id, note.id),
            eq(schema.memberNotes.groupId, camp.id),
          ),
        );
      await audit(tx, viewerUserId, MEMBER_RECORDS_AUDIT.noteUpdate, note.id, {
        groupId: camp.id,
        noteId: note.id,
        subjectUserId: note.subjectUserId,
      });
      return { ok: true };
    },
  );
}

/** Delete a note: your own, or any as a lead or co-lead. */
export async function deleteMemberNote(
  viewerUserId: string,
  raw: unknown,
): Promise<MemberRecordsResult> {
  const parsed = DeleteMemberNoteInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const input = parsed.data;
  return withNoteWrite(
    input.slug,
    viewerUserId,
    input.noteId,
    async (tx, { camp, viewer, note }) => {
      const decision = decideDeleteMemberNote(viewer, note);
      if (!decision.ok || !note) return refused(decision);
      await tx
        .delete(schema.memberNotes)
        .where(
          and(
            eq(schema.memberNotes.id, note.id),
            eq(schema.memberNotes.groupId, camp.id),
          ),
        );
      await audit(tx, viewerUserId, MEMBER_RECORDS_AUDIT.noteDelete, note.id, {
        groupId: camp.id,
        noteId: note.id,
        subjectUserId: note.subjectUserId,
        ...(note.authorUserId ? { authorUserId: note.authorUserId } : {}),
      });
      return { ok: true };
    },
  );
}

// --- Export: a member's POPIA s23 access request (#105) ------------------------------

/** Refused: the same "not found" every non-lead, stranger, erased account and
 * unknown camp gets, so the export is no oracle for who has notes. */
const EXPORT_NOT_FOUND = {
  ok: false,
  reason: "not_found",
  error: NOT_FOUND,
} as const;

// REFUSE, DON'T PARTIAL. With no key every note would read as "could not be
// read"; a file of placeholders is not an answer to an access request.
const NO_KEY_EXPORT =
  "Private notes can't be exported right now: this site's encryption key " +
  "isn't configured, so the notes can't be read. Nothing was exported. Tell " +
  "an organiser (PGCRYPTO_KEY is missing).";
const WRONG_KEY_EXPORT =
  "These notes can't be exported right now: none of them can be read with " +
  "this site's current encryption key. Nothing was exported. Tell an " +
  "organiser.";

/** The export's result: the file, or why not. `unavailable` is the one
 * refusal that is not "not found" — it is only reached by a lead. */
export type MemberNotesExportResult =
  | { ok: true; filename: string; text: string; noteCount: number }
  | { ok: false; reason: "not_found" | "unavailable"; error: string };

/**
 * The camp's notes about one member, as a plain-text file a lead sends the
 * member (POPIA s23; docs/member-records-spec.md §Export). Decided on EVERY
 * call from the database: the actor's and the person's memberships are locked
 * `FOR SHARE` (so a concurrent leave or erasure either waits or wins), the
 * actor's permissions are loaded live, and @quagga/core `canExportMemberNotes`
 * — a structural lead, co-lead or captain of THIS camp, about someone else
 * in it —
 * decides before a note is read. Every export writes ONE audit row in the
 * same transaction: ids and a count, never the text.
 */
export async function exportMemberNotes(
  viewerUserId: string,
  raw: unknown,
): Promise<MemberNotesExportResult> {
  const parsed = ExportMemberNotesInput.safeParse(raw);
  if (!parsed.success) return EXPORT_NOT_FOUND;
  if (!isDatabaseConfigured()) return EXPORT_NOT_FOUND;
  const camp = await findCamp(parsed.data.slug);
  if (!camp) return EXPORT_NOT_FOUND;
  // Postgres hands uuids back lowercase; compare like with like.
  const subjectUserId = parsed.data.subjectUserId.toLowerCase();
  return withTransaction(async (tx): Promise<MemberNotesExportResult> => {
    const people = await lockPeople(tx, camp.id, [viewerUserId, subjectUserId]);
    const viewer = await actorViewer(tx, camp.id, viewerUserId, people);
    const subject = people.get(subjectUserId);
    if (
      !subject ||
      !canExportMemberNotes(viewer, { userId: subjectUserId, inCamp: true })
    ) {
      return EXPORT_NOT_FOUND;
    }
    if (!isCryptoConfigured()) {
      return { ok: false, reason: "unavailable", error: NO_KEY_EXPORT };
    }
    // No author column is selected: the file never names who wrote a note.
    const rows = await tx
      .select({
        body: schema.memberNotes.body,
        editedByUserId: schema.memberNotes.editedByUserId,
        createdAt: schema.memberNotes.createdAt,
        updatedAt: schema.memberNotes.updatedAt,
      })
      .from(schema.memberNotes)
      .where(
        and(
          eq(schema.memberNotes.groupId, camp.id),
          eq(schema.memberNotes.subjectUserId, subjectUserId),
        ),
      )
      .orderBy(asc(schema.memberNotes.createdAt), asc(schema.memberNotes.id));
    const notes = rows.map((r) => {
      const body = decryptField(r.body);
      return {
        createdAt: r.createdAt,
        editedAt: r.editedByUserId !== null ? r.updatedAt : null,
        text: body.state === "ok" ? body.value : null,
      };
    });
    // A key is set but reads NONE of the notes (a wrong or rotated key): the
    // same as no key — a file of placeholders answers nothing. One unreadable
    // note among readable ones is listed as such (spec §Export).
    if (notes.length > 0 && notes.every((n) => n.text === null)) {
      return { ok: false, reason: "unavailable", error: WRONG_KEY_EXPORT };
    }
    const exportedAt = new Date();
    const text = buildMemberNotesExport({
      campName: camp.name,
      memberName: subject.name,
      exportedAt,
      notes,
    });
    await audit(tx, viewerUserId, MEMBER_RECORDS_AUDIT.noteExport, camp.id, {
      groupId: camp.id,
      subjectUserId,
      noteCount: String(rows.length),
    });
    return {
      ok: true,
      filename: memberNotesExportFilename({
        campSlug: camp.slug,
        memberName: subject.name,
        exportedAt,
      }),
      text,
      noteCount: rows.length,
    };
  });
}

// --- Writes: duplicate hints -------------------------------------------------------

/**
 * "Not the same person": hide one possible-duplicate pair for the whole camp.
 * Both people must be CURRENT members with similar names (decided by
 * @quagga/core on names read under the lock); repeating a dismissal is a
 * no-op that still succeeds.
 */
export async function dismissDuplicate(
  viewerUserId: string,
  raw: unknown,
): Promise<MemberRecordsResult> {
  const parsed = DismissDuplicateInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const [userA, userB] = orderedUserPair(...parsed.data.userIds);
  return withRecordsWrite(
    parsed.data.slug,
    viewerUserId,
    [userA, userB],
    async (tx, { camp, viewer, people }) => {
      const current = (id: string): DuplicateCandidate | null => {
        const p = people.get(id);
        return p && !p.archived ? { userId: id, name: p.name } : null;
      };
      const decision = decideDismissDuplicate({
        membership: viewer.membership,
        pair: [current(userA), current(userB)],
      });
      if (!decision.ok) return refused(decision);
      const inserted = await tx
        .insert(schema.memberDuplicateDismissals)
        .values({
          groupId: camp.id,
          userAId: userA,
          userBId: userB,
          dismissedByUserId: viewerUserId,
        })
        .onConflictDoNothing()
        .returning({ groupId: schema.memberDuplicateDismissals.groupId });
      // Already dismissed (a double click, two leads at once): a no-op, and
      // so no second audit row for a dismissal that did not happen.
      if (inserted.length === 0) return { ok: true };
      await audit(
        tx,
        viewerUserId,
        MEMBER_RECORDS_AUDIT.duplicateDismiss,
        camp.id,
        { groupId: camp.id, userIds: [userA, userB] },
      );
      return { ok: true };
    },
  );
}

// --- Cleanup (leaving a camp, erasure) ---------------------------------------------

/**
 * Leaving a camp: delete the camp's notes about the person and every
 * dismissal naming them, in the caller's transaction (`leaveCamp`, after the
 * membership row is gone). Notes they WROTE about others are the camp's and
 * stay. Archiving does NOT call this — notes stay while a member is archived.
 */
export async function removeMemberRecordsForCamp(
  tx: Tx,
  input: { userId: string; groupId: string },
): Promise<void> {
  await tx
    .delete(schema.memberNotes)
    .where(
      and(
        eq(schema.memberNotes.groupId, input.groupId),
        eq(schema.memberNotes.subjectUserId, input.userId),
      ),
    );
  await tx
    .delete(schema.memberDuplicateDismissals)
    .where(
      and(
        eq(schema.memberDuplicateDismissals.groupId, input.groupId),
        or(
          eq(schema.memberDuplicateDismissals.userAId, input.userId),
          eq(schema.memberDuplicateDismissals.userBId, input.userId),
        ),
      ),
    );
}

/**
 * Account erasure: delete every camp's notes about the person and every
 * dismissal naming them, in the sanitization transaction (after the users row
 * is locked `FOR UPDATE`). Notes they wrote about others stay, read as
 * "Departed Burner".
 */
export async function removeAllMemberRecords(
  tx: Tx,
  userId: string,
): Promise<void> {
  await tx
    .delete(schema.memberNotes)
    .where(eq(schema.memberNotes.subjectUserId, userId));
  await tx
    .delete(schema.memberDuplicateDismissals)
    .where(
      or(
        eq(schema.memberDuplicateDismissals.userAId, userId),
        eq(schema.memberDuplicateDismissals.userBId, userId),
      ),
    );
}
