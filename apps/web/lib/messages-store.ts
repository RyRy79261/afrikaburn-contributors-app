import "server-only";

import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import { activeMembership } from "@quagga/db";
import { consumeRateLimit } from "@quagga/db";
import {
  DM_RATE_LIMITS,
  MESSAGE_MAX_LENGTH,
  REPORT_REASON_MAX_LENGTH,
  canReadConversation,
  canReportMessages,
  canSendMessage,
  canStartConversation,
  directConversationKey,
  dmRateLimitKey,
  messageExpiresAt,
  messageLooksLikePhoneNumber,
  publicMemberName,
  readMessageTimer,
  reportCopyExpiresAt,
  timerChangeNotice,
  canReadTeamChat,
  canReportTeamMessages,
  canSendTeamMessage,
  canSetTeamChatTimer,
  reportedTeamSender,
  visibleTeamMessages,
  type DmRateLimitAction,
  type MessageTimer,
  type TeamChatAccess,
  type TeamSeat,
  type TeamViewer,
  type UserBlock,
} from "@quagga/core";
import type { MembershipRole } from "@quagga/types";

import { db, schema, withTransaction, type Tx } from "./db";
import { isDatabaseConfigured } from "./config";
import {
  loadCampmateMemberships,
  resolveAvatarForViewer,
} from "./campmates-store";

// Direct messaging (epic #69) — the store. EVERY decision is a @quagga/core
// predicate (`messaging.ts`); this module loads the facts from the database,
// never from the request, and applies what comes back.
//
// THE PRIVACY SHAPE OF THIS FILE:
//   · Every read of `messages` is preceded by `canReadConversation` over the
//     participant rows, and returns nothing when it says no. There is no
//     function here that takes an org actor, a role or a capability.
//   · Every read of `messages` filters `expires_at > now()` so an expired
//     message never shows between sweeps.
//   · The inbox and the unread count select NO message body — previews are
//     sender + count, never content.
//   · Nothing selects a bio column other than `contactable`/`completed_at`, and
//     nothing selects a phone number: people are users ids and handles.

/** A refused action's result. The copy is deliberately the same for "not
 * allowed" and "does not exist", so a refusal leaks nothing. */
export type DmResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string };

const NOT_AVAILABLE = "You can't message this person.";
const NOT_FOUND = "That conversation isn't available.";

async function rateLimited(
  action: DmRateLimitAction,
  userId: string,
): Promise<boolean> {
  const verdict = await consumeRateLimit({
    key: dmRateLimitKey(action, userId),
    ...DM_RATE_LIMITS[action],
  });
  return !verdict.allowed;
}

/** "Not expired at `now`" — the read-path filter that makes the sweep's
 * schedule irrelevant to what anyone sees. */
function liveAt(now: Date) {
  return or(
    isNull(schema.messages.expiresAt),
    gt(schema.messages.expiresAt, now),
  );
}

/** Every block between these two people, either direction. Returns the query
 * itself (not an async wrapper) so it settles in the order it is awaited. */
function loadBlocksBetween(a: string, b: string): PromiseLike<UserBlock[]> {
  return db()
    .select({
      blockerId: schema.userBlocks.blockerId,
      blockedId: schema.userBlocks.blockedId,
    })
    .from(schema.userBlocks)
    .where(
      or(
        and(
          eq(schema.userBlocks.blockerId, a),
          eq(schema.userBlocks.blockedId, b),
        ),
        and(
          eq(schema.userBlocks.blockerId, b),
          eq(schema.userBlocks.blockedId, a),
        ),
      ),
    );
}

interface ParticipantRow {
  userId: string;
  username: string | null;
  sanitizedAt: Date | null;
  lastReadAt: Date | null;
  hiddenAt: Date | null;
  /** The conversation's kind, on every row (camp teams). */
  conversationKind: "direct" | "team";
}

function loadParticipants(
  conversationId: string,
): PromiseLike<ParticipantRow[]> {
  return db()
    .select({
      userId: schema.conversationParticipants.userId,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
      lastReadAt: schema.conversationParticipants.lastReadAt,
      hiddenAt: schema.conversationParticipants.hiddenAt,
      conversationKind: schema.conversations.kind,
    })
    .from(schema.conversationParticipants)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.conversationParticipants.userId),
    )
    .innerJoin(
      schema.conversations,
      eq(
        schema.conversations.id,
        schema.conversationParticipants.conversationId,
      ),
    )
    .where(eq(schema.conversationParticipants.conversationId, conversationId));
}

/**
 * The 1:1 paths serve DIRECT conversations only. A team chat's id handed to
 * one of them answers exactly like an unknown id: the team chat has its own
 * gates (current team membership, the history cut, block hiding — below),
 * and the 1:1 code knows none of them. Fails closed on an unknown kind.
 */
function isDirect(participants: readonly ParticipantRow[]): boolean {
  return (
    participants.length > 0 &&
    participants.every((p) => p.conversationKind === "direct")
  );
}

function displayName(row: {
  username: string | null;
  sanitizedAt: Date | null;
}): string {
  return publicMemberName(row.username, { sanitizedAt: row.sanitizedAt });
}

// --- Starting a conversation ------------------------------------------------

/**
 * May `viewerUserId` start a conversation with `targetUserId` this edition?
 * The facts for @quagga/core `canStartConversation`: both people's
 * memberships (with group KIND), the target's contactable setting and
 * confirmation for this edition, both accounts' tombstones, and every block
 * between them.
 */
export async function viewerMayStartConversation(input: {
  viewerUserId: string;
  targetUserId: string;
  editionId: string;
}): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  if (input.viewerUserId === input.targetUserId) return false;
  const [people, bioRows, memberships, blocks] = await Promise.all([
    db()
      .select({ id: schema.users.id, sanitizedAt: schema.users.sanitizedAt })
      .from(schema.users)
      .where(
        inArray(schema.users.id, [input.viewerUserId, input.targetUserId]),
      ),
    db()
      .select({
        contactable: schema.burnerBios.contactable,
        completedAt: schema.burnerBios.completedAt,
      })
      .from(schema.burnerBios)
      .where(
        and(
          eq(schema.burnerBios.userId, input.targetUserId),
          eq(schema.burnerBios.editionId, input.editionId),
        ),
      )
      .limit(1),
    loadCampmateMemberships([input.viewerUserId, input.targetUserId]),
    loadBlocksBetween(input.viewerUserId, input.targetUserId),
  ]);
  const viewer = people.find((p) => p.id === input.viewerUserId);
  const target = people.find((p) => p.id === input.targetUserId);
  if (!viewer || !target) return false;
  const bio = bioRows[0];
  return canStartConversation({
    ctx: {
      viewerUserId: input.viewerUserId,
      subjectUserId: input.targetUserId,
      viewerMemberships: memberships.get(input.viewerUserId) ?? [],
      subjectMemberships: memberships.get(input.targetUserId) ?? [],
    },
    contactable: bio?.contactable,
    subjectConfirmed: bio?.completedAt != null,
    subjectSanitized: target.sanitizedAt != null,
    actorSanitized: viewer.sanitizedAt != null,
    blocks,
  });
}

/** The existing 1:1 conversation between the two, if any. */
export async function findDirectConversation(
  a: string,
  b: string,
): Promise<string | null> {
  if (!isDatabaseConfigured() || a === b) return null;
  const [row] = await db()
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(eq(schema.conversations.pairKey, directConversationKey(a, b)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Open (or create) the 1:1 conversation with `targetUserId`.
 *
 * An EXISTING conversation is reopened for a participant without re-asking
 * contactability — that rule governs who may START a chat — and un-hidden for
 * them. A NEW one requires `canStartConversation`, costs one unit of the start
 * rate limit, and takes the starter's personal default timer.
 */
export async function startConversation(input: {
  viewerUserId: string;
  targetUserId: string;
  editionId: string;
}): Promise<DmResult<{ conversationId: string }>> {
  if (!isDatabaseConfigured()) return { ok: false, error: NOT_AVAILABLE };
  if (input.viewerUserId === input.targetUserId) {
    return { ok: false, error: NOT_AVAILABLE };
  }

  const existing = await findDirectConversation(
    input.viewerUserId,
    input.targetUserId,
  );
  if (existing) {
    const participants = await loadParticipants(existing);
    if (
      !isDirect(participants) ||
      !canReadConversation({
        viewerUserId: input.viewerUserId,
        participantUserIds: participants.map((p) => p.userId),
      })
    ) {
      return { ok: false, error: NOT_AVAILABLE };
    }
    await db()
      .update(schema.conversationParticipants)
      .set({ hiddenAt: null })
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, existing),
          eq(schema.conversationParticipants.userId, input.viewerUserId),
        ),
      );
    return { ok: true, conversationId: existing };
  }

  if (!(await viewerMayStartConversation(input))) {
    return { ok: false, error: NOT_AVAILABLE };
  }
  if (await rateLimited("start", input.viewerUserId)) {
    return {
      ok: false,
      error: "You've started a lot of conversations recently. Try again later.",
    };
  }

  const [starter] = await db()
    .select({ defaultMessageTimer: schema.users.defaultMessageTimer })
    .from(schema.users)
    .where(eq(schema.users.id, input.viewerUserId))
    .limit(1);
  const timer = readMessageTimer(starter?.defaultMessageTimer);
  const pairKey = directConversationKey(input.viewerUserId, input.targetUserId);

  const conversationId = await withTransaction(async (tx) => {
    // Conflict-safe: two concurrent starts (from either side) converge on the
    // one row the unique pair key allows.
    const [created] = await tx
      .insert(schema.conversations)
      .values({ pairKey, timer, createdBy: input.viewerUserId })
      .onConflictDoNothing({ target: schema.conversations.pairKey })
      .returning({ id: schema.conversations.id });
    let id = created?.id;
    if (!id) {
      const [row] = await tx
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.pairKey, pairKey))
        .limit(1);
      id = row?.id;
    }
    if (!id) throw new Error("conversation could not be created");
    await tx
      .insert(schema.conversationParticipants)
      .values([
        { conversationId: id, userId: input.viewerUserId },
        { conversationId: id, userId: input.targetUserId },
      ])
      .onConflictDoNothing();
    return id;
  });
  return { ok: true, conversationId };
}

// --- Reading ------------------------------------------------------------------

export interface ConversationMessageView {
  id: string;
  kind: "text" | "system";
  body: string;
  senderId: string;
  senderName: string;
  mine: boolean;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface ConversationView {
  id: string;
  timer: MessageTimer;
  other: {
    userId: string;
    name: string;
    showAvatar: boolean;
    departed: boolean;
  };
  messages: ConversationMessageView[];
  /** The viewer may post (no block either way, nobody departed). */
  canSend: boolean;
  /** The viewer has blocked the other participant. */
  blockedByViewer: boolean;
}

/** How many of a conversation's most recent live messages one read serves. */
export const CONVERSATION_MESSAGE_LIMIT = 500;

/**
 * The conversation for a participant, or null — for a non-participant AND for
 * an id that does not exist, identically. Marks it read up to now.
 */
export async function getConversation(input: {
  viewerUserId: string;
  conversationId: string;
  editionId: string;
  now?: Date;
}): Promise<ConversationView | null> {
  if (!isDatabaseConfigured()) return null;
  const now = input.now ?? new Date();

  const participants = await loadParticipants(input.conversationId);
  // THE GATE. Refused before `messages` is touched at all.
  if (
    !isDirect(participants) ||
    !canReadConversation({
      viewerUserId: input.viewerUserId,
      participantUserIds: participants.map((p) => p.userId),
    })
  ) {
    return null;
  }
  const other = participants.find((p) => p.userId !== input.viewerUserId);
  if (!other) return null;

  const [[convo], rows, blocks, avatarKey] = await Promise.all([
    db()
      .select({ timer: schema.conversations.timer })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, input.conversationId))
      .limit(1),
    db()
      .select({
        id: schema.messages.id,
        kind: schema.messages.kind,
        body: schema.messages.body,
        senderId: schema.messages.senderId,
        createdAt: schema.messages.createdAt,
        expiresAt: schema.messages.expiresAt,
      })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, input.conversationId),
          liveAt(now),
        ),
      )
      // NEWEST first, then reversed below: an ascending limit would serve the
      // OLDEST window and silently drop every new message once a chat passes
      // the cap — while the mark-read below still clears the badge for them.
      .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
      .limit(CONVERSATION_MESSAGE_LIMIT),
    loadBlocksBetween(input.viewerUserId, other.userId),
    resolveAvatarForViewer({
      viewerUserId: input.viewerUserId,
      subjectUserId: other.userId,
      editionId: input.editionId,
    }),
  ]);

  await db()
    .update(schema.conversationParticipants)
    .set({ lastReadAt: now })
    .where(
      and(
        eq(
          schema.conversationParticipants.conversationId,
          input.conversationId,
        ),
        eq(schema.conversationParticipants.userId, input.viewerUserId),
      ),
    );

  const names = new Map(participants.map((p) => [p.userId, displayName(p)]));
  return {
    id: input.conversationId,
    timer: readMessageTimer(convo?.timer),
    other: {
      userId: other.userId,
      name: displayName(other),
      showAvatar: avatarKey !== null,
      departed: other.sanitizedAt != null,
    },
    messages: [...rows].reverse().map((m) => ({
      id: m.id,
      kind: m.kind,
      body: m.body,
      senderId: m.senderId,
      senderName: names.get(m.senderId) ?? publicMemberName(null),
      mine: m.senderId === input.viewerUserId,
      createdAt: m.createdAt,
      expiresAt: m.expiresAt,
    })),
    canSend: canSendMessage({
      senderUserId: input.viewerUserId,
      participants: participants.map((p) => ({
        userId: p.userId,
        sanitized: p.sanitizedAt != null,
      })),
      blocks,
    }),
    blockedByViewer: blocks.some(
      (b) => b.blockerId === input.viewerUserId && b.blockedId === other.userId,
    ),
  };
}

/** A 1:1 conversation in the inbox. */
export interface DirectInboxEntry {
  kind: "direct";
  conversationId: string;
  otherUserId: string;
  otherName: string;
  showAvatar: boolean;
  unread: number;
  lastMessageAt: Date | null;
}

/** A camp team's chat in the inbox (docs/camp-teams-spec.md). */
export interface TeamInboxEntry {
  kind: "team";
  conversationId: string;
  teamId: string;
  teamName: string;
  campSlug: string;
  campName: string;
  unread: number;
  /** Who sent the newest message the viewer can SEE — never what. */
  lastSenderName: string | null;
  lastMessageAt: Date | null;
}

/** One inbox row: a direct chat or a team chat (frame T4). */
export type InboxEntry = DirectInboxEntry | TeamInboxEntry;

/**
 * SQL: the viewer is still on this conversation's team — a `team_members`
 * row with an ACTIVE membership of the team's camp. Participant rows follow
 * team membership in the same transaction; this is the second lock on the
 * same door, so a stale participant row surfaces nothing.
 */
function stillOnTeam(me: string) {
  return sql`exists (
    select 1 from ${schema.teamMembers} tm
    join ${schema.shiftTeams} st on st.id = tm.team_id
    join ${schema.memberships} m on m.user_id = tm.user_id and m.group_id = st.group_id and m.archived_at is null
    where tm.team_id = ${schema.conversations.teamId} and tm.user_id = ${me}
  )`;
}

/**
 * SQL: a team-chat message this viewer may count — sent at or after they
 * joined (the history cut) and not from someone a block stands between them
 * and. Direct conversations are untouched by this (their rules are epic #69's).
 */
function teamMessageVisibleTo(me: string) {
  return and(
    gte(schema.messages.createdAt, schema.conversationParticipants.joinedAt),
    sql`not exists (
      select 1 from ${schema.userBlocks} b
      where (b.blocker_id = ${me} and b.blocked_id = ${schema.messages.senderId})
         or (b.blocker_id = ${schema.messages.senderId} and b.blocked_id = ${me})
    )`,
  );
}

/**
 * The viewer's inbox: one row per conversation they are in and have not
 * hidden, newest first — direct chats and the chats of the teams they are on.
 * NO MESSAGE BODY is selected — the preview is the sender and an unread
 * count, never content.
 */
export async function listInbox(input: {
  viewerUserId: string;
  editionId: string;
  now?: Date;
}): Promise<InboxEntry[]> {
  if (!isDatabaseConfigured()) return [];
  const now = input.now ?? new Date();
  const me = input.viewerUserId;
  const mine = await db()
    .select({
      conversationId: schema.conversationParticipants.conversationId,
      kind: schema.conversations.kind,
      teamId: schema.conversations.teamId,
      joinedAt: schema.conversationParticipants.joinedAt,
      lastReadAt: schema.conversationParticipants.lastReadAt,
      lastMessageAt: schema.conversations.lastMessageAt,
      createdAt: schema.conversations.createdAt,
    })
    .from(schema.conversationParticipants)
    .innerJoin(
      schema.conversations,
      eq(
        schema.conversations.id,
        schema.conversationParticipants.conversationId,
      ),
    )
    .where(
      and(
        eq(schema.conversationParticipants.userId, me),
        isNull(schema.conversationParticipants.hiddenAt),
        or(eq(schema.conversations.kind, "direct"), stillOnTeam(me)),
      ),
    )
    .orderBy(
      desc(
        sql`coalesce(${schema.conversations.lastMessageAt}, ${schema.conversations.createdAt})`,
      ),
    )
    .limit(100);
  if (mine.length === 0) return [];
  const directIds = mine
    .filter((r) => r.kind === "direct")
    .map((r) => r.conversationId);
  const teamRows = mine.filter((r) => r.kind === "team" && r.teamId);

  const others =
    directIds.length === 0
      ? []
      : await db()
          .select({
            conversationId: schema.conversationParticipants.conversationId,
            userId: schema.conversationParticipants.userId,
            username: schema.users.username,
            sanitizedAt: schema.users.sanitizedAt,
          })
          .from(schema.conversationParticipants)
          .innerJoin(
            schema.users,
            eq(schema.users.id, schema.conversationParticipants.userId),
          )
          .where(
            and(
              inArray(
                schema.conversationParticipants.conversationId,
                directIds,
              ),
              ne(schema.conversationParticipants.userId, me),
            ),
          );
  const unreadRows = await unreadCounts(
    me,
    now,
    mine.map((r) => r.conversationId),
  );
  const teams = await loadInboxTeams(
    me,
    now,
    teamRows.map((r) => ({
      conversationId: r.conversationId,
      teamId: r.teamId!,
      joinedAt: r.joinedAt,
    })),
  );

  const avatarOf = new Map<string, boolean>();
  await Promise.all(
    [...new Set(others.map((o) => o.userId))].map(async (userId) => {
      const key = await resolveAvatarForViewer({
        viewerUserId: me,
        subjectUserId: userId,
        editionId: input.editionId,
      });
      avatarOf.set(userId, key !== null);
    }),
  );

  const entries: InboxEntry[] = [];
  const sortKey = new Map<string, Date>();
  for (const row of mine) {
    if (row.kind === "team") {
      const team = teams.get(row.conversationId);
      if (!team) continue;
      entries.push({
        kind: "team",
        conversationId: row.conversationId,
        teamId: team.teamId,
        teamName: team.teamName,
        campSlug: team.campSlug,
        campName: team.campName,
        unread: unreadRows.get(row.conversationId) ?? 0,
        lastSenderName: team.lastSenderName,
        // The newest message the viewer can SEE, never the conversation's
        // `last_message_at`: that one is bumped by every send, including
        // a blocked person's and anything before the viewer joined, and
        // showing it would leak when they were active (camp-teams-spec).
        lastMessageAt: team.lastVisibleAt,
      });
      sortKey.set(row.conversationId, team.lastVisibleAt ?? row.joinedAt);
      continue;
    }
    const other = others.find((o) => o.conversationId === row.conversationId);
    if (!other) continue;
    entries.push({
      kind: "direct",
      conversationId: row.conversationId,
      otherUserId: other.userId,
      otherName: displayName(other),
      showAvatar: avatarOf.get(other.userId) ?? false,
      unread: unreadRows.get(row.conversationId) ?? 0,
      lastMessageAt: row.lastMessageAt,
    });
    sortKey.set(row.conversationId, row.lastMessageAt ?? row.createdAt);
  }
  // Re-sort: the query ordered by the conversation's own timestamp, which a
  // team row must not be placed by (see above).
  const keyOf = (e: InboxEntry) =>
    sortKey.get(e.conversationId)?.getTime() ?? 0;
  return entries.sort((a, b) => keyOf(b) - keyOf(a));
}

/**
 * The team half of the inbox: each team's name and camp, and who sent (and
 * when) the newest message the viewer can see (after they joined, live, not from
 * someone a block stands between them and). One small query per team chat —
 * a person is on a handful of teams.
 */
async function loadInboxTeams(
  me: string,
  now: Date,
  rows: readonly { conversationId: string; teamId: string; joinedAt: Date }[],
): Promise<
  Map<
    string,
    {
      teamId: string;
      teamName: string;
      campSlug: string;
      campName: string;
      lastSenderName: string | null;
      lastVisibleAt: Date | null;
    }
  >
> {
  const out = new Map<
    string,
    {
      teamId: string;
      teamName: string;
      campSlug: string;
      campName: string;
      lastSenderName: string | null;
      lastVisibleAt: Date | null;
    }
  >();
  if (rows.length === 0) return out;
  const teams = await db()
    .select({
      teamId: schema.shiftTeams.id,
      teamName: schema.shiftTeams.name,
      campSlug: schema.groups.slug,
      campName: schema.groups.name,
    })
    .from(schema.shiftTeams)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.shiftTeams.groupId))
    .where(
      inArray(
        schema.shiftTeams.id,
        rows.map((r) => r.teamId),
      ),
    );
  for (const row of rows) {
    const team = teams.find((t) => t.teamId === row.teamId);
    if (!team) continue;
    const [last] = await db()
      .select({
        username: schema.users.username,
        sanitizedAt: schema.users.sanitizedAt,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .innerJoin(schema.users, eq(schema.users.id, schema.messages.senderId))
      .where(
        and(
          eq(schema.messages.conversationId, row.conversationId),
          eq(schema.messages.kind, "text"),
          liveAt(now),
          gte(schema.messages.createdAt, row.joinedAt),
          sql`not exists (
            select 1 from ${schema.userBlocks} b
            where (b.blocker_id = ${me} and b.blocked_id = ${schema.messages.senderId})
               or (b.blocker_id = ${schema.messages.senderId} and b.blocked_id = ${me})
          )`,
        ),
      )
      .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
      .limit(1);
    out.set(row.conversationId, {
      ...team,
      lastSenderName: last ? displayName(last) : null,
      lastVisibleAt: last ? last.createdAt : null,
    });
  }
  return out;
}

/** Unread live text messages from others, per conversation. In a team chat,
 * only messages the viewer can see count (history cut, blocks), and only
 * while they are still on the team. */
async function unreadCounts(
  me: string,
  now: Date,
  conversationIds?: readonly string[],
): Promise<Map<string, number>> {
  const conds = [
    eq(schema.conversationParticipants.userId, me),
    isNull(schema.conversationParticipants.hiddenAt),
    ne(schema.messages.senderId, me),
    eq(schema.messages.kind, "text"),
    liveAt(now),
    or(
      isNull(schema.conversationParticipants.lastReadAt),
      gt(schema.messages.createdAt, schema.conversationParticipants.lastReadAt),
    ),
    or(
      eq(schema.conversations.kind, "direct"),
      and(stillOnTeam(me), teamMessageVisibleTo(me)),
    ),
  ];
  if (conversationIds) {
    conds.push(inArray(schema.messages.conversationId, [...conversationIds]));
  }
  const rows = await db()
    .select({
      conversationId: schema.messages.conversationId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.messages)
    .innerJoin(
      schema.conversationParticipants,
      eq(
        schema.conversationParticipants.conversationId,
        schema.messages.conversationId,
      ),
    )
    .innerJoin(
      schema.conversations,
      eq(schema.conversations.id, schema.messages.conversationId),
    )
    .where(and(...conds))
    .groupBy(schema.messages.conversationId);
  return new Map(rows.map((r) => [r.conversationId, Number(r.count)]));
}

/** The header badge: unread messages across every visible conversation,
 * direct and team. Env-less / failure ⇒ 0, so the chrome always renders. */
export async function getUnreadMessageCount(
  viewerUserId: string,
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  try {
    const counts = await unreadCounts(viewerUserId, new Date());
    let total = 0;
    for (const n of counts.values()) total += n;
    return total;
  } catch {
    return 0;
  }
}

// --- Writing --------------------------------------------------------------------

/**
 * Post a message. Returns `phoneHint: true` when the body looks like it holds
 * a phone number — a hint for the sender, never a refusal.
 */
export async function sendMessage(input: {
  viewerUserId: string;
  conversationId: string;
  body: string;
  now?: Date;
}): Promise<DmResult<{ phoneHint: boolean }>> {
  if (!isDatabaseConfigured()) return { ok: false, error: NOT_FOUND };
  const body = input.body.trim();
  if (body.length === 0 || body.length > MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Messages are 1–${MESSAGE_MAX_LENGTH} characters.`,
    };
  }
  const participants = await loadParticipants(input.conversationId);
  const ids = participants.map((p) => p.userId);
  if (
    !isDirect(participants) ||
    !canReadConversation({
      viewerUserId: input.viewerUserId,
      participantUserIds: ids,
    })
  ) {
    return { ok: false, error: NOT_FOUND };
  }
  const other = ids.find((id) => id !== input.viewerUserId);
  const blocks = other
    ? await loadBlocksBetween(input.viewerUserId, other)
    : [];
  if (
    !canSendMessage({
      senderUserId: input.viewerUserId,
      participants: participants.map((p) => ({
        userId: p.userId,
        sanitized: p.sanitizedAt != null,
      })),
      blocks,
    })
  ) {
    return { ok: false, error: "You can't reply in this conversation." };
  }
  if (await rateLimited("send", input.viewerUserId)) {
    return {
      ok: false,
      error:
        "You're sending messages very quickly. Wait a moment and try again.",
    };
  }

  const now = input.now ?? new Date();
  const [convo] = await db()
    .select({ timer: schema.conversations.timer })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, input.conversationId))
    .limit(1);
  const timer = readMessageTimer(convo?.timer);
  await withTransaction(async (tx) => {
    await tx.insert(schema.messages).values({
      conversationId: input.conversationId,
      senderId: input.viewerUserId,
      kind: "text",
      body,
      createdAt: now,
      expiresAt: messageExpiresAt(timer, now),
    });
    await tx
      .update(schema.conversations)
      .set({ lastMessageAt: now })
      .where(eq(schema.conversations.id, input.conversationId));
    // A new message surfaces the chat for EVERY participant. Safe because
    // canSendMessage above already refused if a block exists either way, and
    // blocking is the only thing that hides a chat — so a hidden row here is
    // a stale one (e.g. left by a block since lifted).
    await tx
      .update(schema.conversationParticipants)
      .set({ hiddenAt: null })
      .where(
        eq(
          schema.conversationParticipants.conversationId,
          input.conversationId,
        ),
      );
    // Sending is reading: the sender's own unread marker moves with them.
    await tx
      .update(schema.conversationParticipants)
      .set({ lastReadAt: now })
      .where(
        and(
          eq(
            schema.conversationParticipants.conversationId,
            input.conversationId,
          ),
          eq(schema.conversationParticipants.userId, input.viewerUserId),
        ),
      );
  });
  return { ok: true, phoneHint: messageLooksLikePhoneNumber(body) };
}

/**
 * Change the conversation's timer. Any participant who may post may change
 * it; the change is announced IN the chat as a system message, and applies to
 * messages sent after it (the notice included).
 */
export async function setConversationTimer(input: {
  viewerUserId: string;
  conversationId: string;
  timer: MessageTimer;
  now?: Date;
}): Promise<DmResult> {
  if (!isDatabaseConfigured()) return { ok: false, error: NOT_FOUND };
  const participants = await loadParticipants(input.conversationId);
  const ids = participants.map((p) => p.userId);
  if (
    !isDirect(participants) ||
    !canReadConversation({
      viewerUserId: input.viewerUserId,
      participantUserIds: ids,
    })
  ) {
    return { ok: false, error: NOT_FOUND };
  }
  const other = ids.find((id) => id !== input.viewerUserId);
  const blocks = other
    ? await loadBlocksBetween(input.viewerUserId, other)
    : [];
  if (
    !canSendMessage({
      senderUserId: input.viewerUserId,
      participants: participants.map((p) => ({
        userId: p.userId,
        sanitized: p.sanitizedAt != null,
      })),
      blocks,
    })
  ) {
    return { ok: false, error: "You can't change this conversation." };
  }
  if (await rateLimited("send", input.viewerUserId)) {
    return {
      ok: false,
      error: "Too many changes. Wait a moment and try again.",
    };
  }
  const now = input.now ?? new Date();
  const timer = readMessageTimer(input.timer);
  await withTransaction(async (tx) => {
    await tx
      .update(schema.conversations)
      .set({ timer, lastMessageAt: now })
      .where(eq(schema.conversations.id, input.conversationId));
    await tx.insert(schema.messages).values({
      conversationId: input.conversationId,
      senderId: input.viewerUserId,
      kind: "system",
      body: timerChangeNotice(timer),
      createdAt: now,
      expiresAt: messageExpiresAt(timer, now),
    });
  });
  return { ok: true };
}

/**
 * Block `targetUserId`. Immediate, and effective both ways: neither can start
 * a chat with the other or post into one they share. The shared conversation
 * is hidden from the BLOCKER's inbox.
 */
export async function blockUser(input: {
  viewerUserId: string;
  targetUserId: string;
}): Promise<DmResult> {
  if (!isDatabaseConfigured()) return { ok: false, error: NOT_AVAILABLE };
  if (input.viewerUserId === input.targetUserId) {
    return { ok: false, error: "You can't block yourself." };
  }
  const [target] = await db()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, input.targetUserId))
    .limit(1);
  if (!target) return { ok: false, error: NOT_AVAILABLE };
  const conversationId = await findDirectConversation(
    input.viewerUserId,
    input.targetUserId,
  );
  await withTransaction(async (tx) => {
    await tx
      .insert(schema.userBlocks)
      .values({ blockerId: input.viewerUserId, blockedId: input.targetUserId })
      .onConflictDoNothing();
    if (conversationId) {
      await tx
        .update(schema.conversationParticipants)
        .set({ hiddenAt: new Date() })
        .where(
          and(
            eq(schema.conversationParticipants.conversationId, conversationId),
            eq(schema.conversationParticipants.userId, input.viewerUserId),
          ),
        );
    }
  });
  return { ok: true };
}

/**
 * Lift the viewer's own block. Never lifts the other person's. The shared
 * conversation `blockUser` hid from the viewer's inbox comes back with it —
 * otherwise nothing the other person sends afterwards would ever surface
 * (inbox and unread badge both skip hidden rows).
 */
export async function unblockUser(input: {
  viewerUserId: string;
  targetUserId: string;
}): Promise<DmResult> {
  if (!isDatabaseConfigured()) return { ok: false, error: NOT_AVAILABLE };
  const conversationId = await findDirectConversation(
    input.viewerUserId,
    input.targetUserId,
  );
  await withTransaction(async (tx) => {
    await tx
      .delete(schema.userBlocks)
      .where(
        and(
          eq(schema.userBlocks.blockerId, input.viewerUserId),
          eq(schema.userBlocks.blockedId, input.targetUserId),
        ),
      );
    if (conversationId) {
      await tx
        .update(schema.conversationParticipants)
        .set({ hiddenAt: null })
        .where(
          and(
            eq(schema.conversationParticipants.conversationId, conversationId),
            eq(schema.conversationParticipants.userId, input.viewerUserId),
          ),
        );
    }
  });
  return { ok: true };
}

/** Has the viewer blocked this person? (For the profile's Block/Unblock.) */
export async function viewerHasBlocked(
  viewerUserId: string,
  targetUserId: string,
): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  const [row] = await db()
    .select({ blockerId: schema.userBlocks.blockerId })
    .from(schema.userBlocks)
    .where(
      and(
        eq(schema.userBlocks.blockerId, viewerUserId),
        eq(schema.userBlocks.blockedId, targetUserId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Report selected messages. COPIES exactly those messages — and only if every
 * one is a live message of a conversation the reporter is in — into a report
 * with its own fixed retention. An id that is expired, foreign or unknown
 * refuses the whole report.
 */
export async function reportMessages(input: {
  viewerUserId: string;
  conversationId: string;
  messageIds: readonly string[];
  reason: string | null;
  now?: Date;
}): Promise<DmResult<{ reportId: string }>> {
  if (!isDatabaseConfigured()) return { ok: false, error: NOT_FOUND };
  const now = input.now ?? new Date();
  const participants = await loadParticipants(input.conversationId);
  const participantIds = participants.map((p) => p.userId);
  // Refused before any message row is read.
  if (
    !isDirect(participants) ||
    !canReadConversation({
      viewerUserId: input.viewerUserId,
      participantUserIds: participantIds,
    })
  ) {
    return { ok: false, error: NOT_FOUND };
  }
  const uniqueIds = [...new Set(input.messageIds)];
  if (uniqueIds.length === 0) {
    return { ok: false, error: "Select at least one message to report." };
  }
  const selected = await db()
    .select({
      id: schema.messages.id,
      conversationId: schema.messages.conversationId,
      senderId: schema.messages.senderId,
      kind: schema.messages.kind,
      body: schema.messages.body,
      createdAt: schema.messages.createdAt,
    })
    .from(schema.messages)
    .where(and(inArray(schema.messages.id, uniqueIds), liveAt(now)));
  if (
    selected.length !== uniqueIds.length ||
    !canReportMessages({
      reporterUserId: input.viewerUserId,
      conversationId: input.conversationId,
      participantUserIds: participantIds,
      selected,
    })
  ) {
    return { ok: false, error: "Those messages can't be reported from here." };
  }
  if (await rateLimited("report", input.viewerUserId)) {
    return {
      ok: false,
      error: "You've sent several reports recently. Try again later.",
    };
  }
  const reason =
    input.reason?.trim().slice(0, REPORT_REASON_MAX_LENGTH) || null;
  const reportedUserId =
    participantIds.find((id) => id !== input.viewerUserId) ?? null;

  const reportId = await withTransaction(async (tx) => {
    const [report] = await tx
      .insert(schema.messageReports)
      .values({
        conversationId: input.conversationId,
        reporterId: input.viewerUserId,
        reportedUserId,
        reason,
        createdAt: now,
        expiresAt: reportCopyExpiresAt(now),
      })
      .returning({ id: schema.messageReports.id });
    if (!report) throw new Error("report could not be created");
    await tx.insert(schema.messageReportItems).values(
      selected.map((m) => ({
        reportId: report.id,
        originalMessageId: m.id,
        senderId: m.senderId,
        kind: m.kind,
        body: m.body,
        sentAt: m.createdAt,
      })),
    );
    return report.id;
  });
  return { ok: true, reportId };
}

/** Save the viewer's personal default timer for chats they start. */
export async function saveDefaultMessageTimer(
  userId: string,
  timer: MessageTimer,
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await db()
    .update(schema.users)
    .set({ defaultMessageTimer: readMessageTimer(timer) })
    .where(eq(schema.users.id, userId));
}

export async function getDefaultMessageTimer(
  userId: string,
): Promise<MessageTimer> {
  if (!isDatabaseConfigured()) return "off";
  const [row] = await db()
    .select({ timer: schema.users.defaultMessageTimer })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return readMessageTimer(row?.timer);
}

// --- Retention sweep ------------------------------------------------------------

export interface MessageSweepResult {
  messagesDeleted: number;
  reportsDeleted: number;
}

/**
 * HARD-delete every expired message, and every report whose own retention has
 * elapsed (its copies cascade). Idempotent; the read path already hides
 * expired rows, so the schedule only bounds how long they sit on disk.
 */
export async function sweepExpiredMessages(
  now: Date = new Date(),
): Promise<MessageSweepResult> {
  if (!isDatabaseConfigured()) return { messagesDeleted: 0, reportsDeleted: 0 };
  const deletedMessages = await db()
    .delete(schema.messages)
    .where(lte(schema.messages.expiresAt, now))
    .returning({ id: schema.messages.id });
  const deletedReports = await db()
    .delete(schema.messageReports)
    .where(lte(schema.messageReports.expiresAt, now))
    .returning({ id: schema.messageReports.id });
  return {
    messagesDeleted: deletedMessages.length,
    reportsDeleted: deletedReports.length,
  };
}

// --- Team chats (docs/camp-teams-spec.md) ------------------------------------
//
// A camp team's chat is a `conversations` row of kind `team`, one per team,
// whose participant rows follow `team_members` in the same transaction
// (apps/web/lib/camp-teams-store.ts). The direct-message law stands, extended
// by @quagga/core camp-teams.ts:
//   · ONLY CURRENT TEAM MEMBERS READ IT — a participant row AND a team row with
//     an active camp membership, both. No function here takes a role for
//     reading; a camp lead who is not on the team is refused like a stranger.
//   · The history cut: a member sees messages sent at or after they joined.
//   · Blocks hide each one's messages from the other; nobody is removed.
//   · The org sees only what a member reports (copies, as for direct chats).
// Every function is addressed by (camp, team) — the camp resolved from the
// session's own membership by the caller — never by a bare conversation id.

/** Find or create the team's chat. Conflict-safe: the unique `team_id` makes
 * two concurrent callers converge on one row. */
export async function ensureTeamConversation(
  tx: Tx,
  teamId: string,
  createdBy: string | null,
): Promise<string> {
  const [created] = await tx
    .insert(schema.conversations)
    .values({ kind: "team", teamId, timer: "off", createdBy })
    .onConflictDoNothing({ target: schema.conversations.teamId })
    .returning({ id: schema.conversations.id });
  if (created) return created.id;
  const [row] = await tx
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(eq(schema.conversations.teamId, teamId))
    .limit(1);
  if (!row) throw new Error("team conversation could not be created");
  return row.id;
}

/**
 * Put people into a team's chat, starting their history cut NOW. A leftover
 * row (there should be none: leaving deletes it) is reset rather than kept,
 * so re-joining never reopens what was said while they were away.
 */
export async function addTeamChatParticipants(
  tx: Tx,
  conversationId: string,
  userIds: readonly string[],
  now: Date,
): Promise<void> {
  if (userIds.length === 0) return;
  await tx
    .insert(schema.conversationParticipants)
    .values(
      userIds.map((userId) => ({
        conversationId,
        userId,
        joinedAt: now,
        lastReadAt: null,
        hiddenAt: null,
      })),
    )
    .onConflictDoUpdate({
      target: [
        schema.conversationParticipants.conversationId,
        schema.conversationParticipants.userId,
      ],
      set: { joinedAt: now, lastReadAt: null, hiddenAt: null },
    });
}

/**
 * Take one person out of these teams' chats (a list of team ids, or a
 * subquery selecting them). They keep nothing of them: the participant row
 * goes, and with it the history cut — joining again starts a new one.
 */
export async function removeTeamChatParticipants(
  tx: Tx,
  teamIds: readonly string[] | SQLWrapper,
  userId: string,
): Promise<void> {
  if (Array.isArray(teamIds) && teamIds.length === 0) return;
  const teams = Array.isArray(teamIds)
    ? inArray(schema.conversations.teamId, [...(teamIds as readonly string[])])
    : inArray(schema.conversations.teamId, teamIds as SQLWrapper);
  await tx.delete(schema.conversationParticipants).where(
    and(
      eq(schema.conversationParticipants.userId, userId),
      inArray(
        schema.conversationParticipants.conversationId,
        tx
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(and(eq(schema.conversations.kind, "team"), teams)),
      ),
    ),
  );
}

type Handle = Tx | ReturnType<typeof db>;

interface TeamChatFacts {
  teamId: string;
  teamName: string;
  campName: string;
  archived: boolean;
  conversationId: string | null;
  timer: MessageTimer;
  viewer: TeamViewer;
  seat: TeamSeat | null;
  /** The viewer's participant row's `joined_at` (the history cut). */
  joinedAt: Date | null;
  participantUserIds: string[];
  access: TeamChatAccess;
}

/**
 * Every fact the team chat's gates read, from the database: the team (inside
 * THIS camp), its chat, the viewer's active camp role and team seat (an
 * erased account has neither), and the chat's participants. Null when the
 * team is not this camp's. Inside a transaction (`lock`), the viewer's
 * membership, account and team row are held `FOR SHARE`, so a removal, an
 * archive or an erasure either waits for the write or is seen by it.
 */
async function loadTeamChatFacts(
  handle: Handle,
  input: { groupId: string; teamId: string; viewerUserId: string },
  lock = false,
): Promise<TeamChatFacts | null> {
  const [team] = await handle
    .select({
      teamId: schema.shiftTeams.id,
      teamName: schema.shiftTeams.name,
      archivedAt: schema.shiftTeams.archivedAt,
      campName: schema.groups.name,
    })
    .from(schema.shiftTeams)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.shiftTeams.groupId))
    .where(
      and(
        eq(schema.shiftTeams.id, input.teamId),
        eq(schema.shiftTeams.groupId, input.groupId),
      ),
    )
    .limit(1);
  if (!team) return null;

  const viewerQuery = handle
    .select({
      role: schema.memberships.role,
      isLead: schema.teamMembers.isLead,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .innerJoin(
      schema.teamMembers,
      and(
        eq(schema.teamMembers.userId, schema.memberships.userId),
        eq(schema.teamMembers.teamId, input.teamId),
      ),
    )
    .where(
      and(
        eq(schema.memberships.groupId, input.groupId),
        eq(schema.memberships.userId, input.viewerUserId),
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    )
    .limit(1);
  // former members: none — this only names the tables `viewerQuery` (above,
  // filtered by `activeMembership()`) locks.
  const [seated] = lock
    ? await viewerQuery.for("share", {
        of: [schema.memberships, schema.users, schema.teamMembers],
      })
    : await viewerQuery;

  // Not on the team: the camp role still decides nothing about READING, but
  // the caller may want it for a refusal's wording. Read it without a lock.
  let campRole: MembershipRole | null = seated?.role ?? null;
  if (!seated) {
    const [m] = await handle
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(
        and(
          eq(schema.memberships.groupId, input.groupId),
          eq(schema.memberships.userId, input.viewerUserId),
          activeMembership(),
          isNull(schema.users.sanitizedAt),
        ),
      )
      .limit(1);
    campRole = m?.role ?? null;
  }

  const [convo] = await handle
    .select({ id: schema.conversations.id, timer: schema.conversations.timer })
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.teamId, input.teamId),
        eq(schema.conversations.kind, "team"),
      ),
    )
    .limit(1);
  const participants = convo
    ? await handle
        .select({
          userId: schema.conversationParticipants.userId,
          joinedAt: schema.conversationParticipants.joinedAt,
        })
        .from(schema.conversationParticipants)
        .where(eq(schema.conversationParticipants.conversationId, convo.id))
    : [];
  const participantUserIds = participants.map((p) => p.userId);
  const seat = seated ? { isLead: seated.isLead } : null;
  return {
    teamId: team.teamId,
    teamName: team.teamName,
    campName: team.campName,
    archived: team.archivedAt !== null,
    conversationId: convo?.id ?? null,
    timer: readMessageTimer(convo?.timer),
    viewer: { userId: input.viewerUserId, campRole },
    seat,
    joinedAt:
      participants.find((p) => p.userId === input.viewerUserId)?.joinedAt ??
      null,
    participantUserIds,
    access: {
      viewerUserId: input.viewerUserId,
      participantUserIds,
      viewerOnTeam: seat !== null,
    },
  };
}

/** Every block that involves the viewer, either direction. */
function loadBlocksOf(userId: string): PromiseLike<UserBlock[]> {
  return db()
    .select({
      blockerId: schema.userBlocks.blockerId,
      blockedId: schema.userBlocks.blockedId,
    })
    .from(schema.userBlocks)
    .where(
      or(
        eq(schema.userBlocks.blockerId, userId),
        eq(schema.userBlocks.blockedId, userId),
      ),
    );
}

/** The ids a block stands between the viewer and. */
function blockedOthers(userId: string, blocks: readonly UserBlock[]): string[] {
  return [
    ...new Set(
      blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)),
    ),
  ].filter((id) => id !== userId);
}

/** A team chat as one current member of the team sees it (frame T3). */
export interface TeamChatView {
  teamId: string;
  conversationId: string;
  teamName: string;
  campName: string;
  memberCount: number;
  timer: MessageTimer;
  /** The viewer's history cut: they see messages from here on. */
  joinedAt: Date;
  messages: ConversationMessageView[];
  /** The viewer may post (on the team, team not archived). */
  canSend: boolean;
  /** The viewer may change the timer (team lead or camp lead, on the team). */
  canSetTimer: boolean;
  archived: boolean;
}

/**
 * The team's chat for a current member of the team, or null — for everyone
 * else (a camp lead not on the team included) and for a team that is not
 * this camp's, identically. Serves only messages sent after the viewer
 * joined, live, and not from someone a block stands between them and. Marks
 * it read up to now.
 */
export async function getTeamChat(input: {
  groupId: string;
  teamId: string;
  viewerUserId: string;
  now?: Date;
}): Promise<TeamChatView | null> {
  if (!isDatabaseConfigured()) return null;
  const now = input.now ?? new Date();
  const facts = await loadTeamChatFacts(db(), input);
  // THE GATE. Refused before `messages` is touched at all.
  if (
    !facts ||
    !facts.conversationId ||
    !facts.joinedAt ||
    !canReadTeamChat(facts.access)
  ) {
    return null;
  }
  const conversationId = facts.conversationId;
  const joinedAt = facts.joinedAt;
  const blocks = await loadBlocksOf(input.viewerUserId);
  const hidden = blockedOthers(input.viewerUserId, blocks);

  const rows = await db()
    .select({
      id: schema.messages.id,
      kind: schema.messages.kind,
      body: schema.messages.body,
      senderId: schema.messages.senderId,
      createdAt: schema.messages.createdAt,
      expiresAt: schema.messages.expiresAt,
    })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        liveAt(now),
        // The history cut and block hiding, in SQL so the window below is a
        // window of messages the viewer may see …
        gte(schema.messages.createdAt, joinedAt),
        hidden.length > 0
          ? notInArray(schema.messages.senderId, hidden)
          : undefined,
      ),
    )
    .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
    .limit(CONVERSATION_MESSAGE_LIMIT);
  // … and again over what came back, by the core rule itself.
  const visible = visibleTeamMessages(
    [...rows].reverse(),
    { userId: input.viewerUserId, joinedAt },
    blocks,
  );

  const senderIds = [...new Set(visible.map((m) => m.senderId))];
  const people =
    senderIds.length === 0
      ? []
      : await db()
          .select({
            id: schema.users.id,
            username: schema.users.username,
            sanitizedAt: schema.users.sanitizedAt,
          })
          .from(schema.users)
          .where(inArray(schema.users.id, senderIds));
  const names = new Map(people.map((p) => [p.id, displayName(p)]));

  await db()
    .update(schema.conversationParticipants)
    .set({ lastReadAt: now })
    .where(
      and(
        eq(schema.conversationParticipants.conversationId, conversationId),
        eq(schema.conversationParticipants.userId, input.viewerUserId),
      ),
    );

  const team = { archived: facts.archived };
  return {
    teamId: facts.teamId,
    conversationId,
    teamName: facts.teamName,
    campName: facts.campName,
    memberCount: facts.participantUserIds.length,
    timer: facts.timer,
    joinedAt,
    messages: visible.map((m) => ({
      id: m.id,
      kind: m.kind,
      body: m.body,
      senderId: m.senderId,
      senderName: names.get(m.senderId) ?? publicMemberName(null),
      mine: m.senderId === input.viewerUserId,
      createdAt: m.createdAt,
      expiresAt: m.expiresAt,
    })),
    canSend: canSendTeamMessage(facts.access, team),
    canSetTimer: canSetTeamChatTimer(
      facts.access,
      facts.viewer,
      team,
      facts.seat,
    ),
    archived: facts.archived,
  };
}

const TEAM_CHAT_NOT_FOUND = "That team chat isn't available.";

/**
 * Post into a team chat. Re-decided inside the write's transaction with the
 * viewer's membership, account and team row held `FOR SHARE`, so a removal
 * that commits first refuses this post. Returns `phoneHint` like a DM.
 */
export async function sendTeamMessage(input: {
  groupId: string;
  teamId: string;
  viewerUserId: string;
  body: string;
  now?: Date;
}): Promise<DmResult<{ phoneHint: boolean }>> {
  if (!isDatabaseConfigured()) return { ok: false, error: TEAM_CHAT_NOT_FOUND };
  const body = input.body.trim();
  if (body.length === 0 || body.length > MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Messages are 1–${MESSAGE_MAX_LENGTH} characters.`,
    };
  }
  const pre = await loadTeamChatFacts(db(), input);
  if (!pre || !canReadTeamChat(pre.access)) {
    return { ok: false, error: TEAM_CHAT_NOT_FOUND };
  }
  if (await rateLimited("send", input.viewerUserId)) {
    return {
      ok: false,
      error:
        "You're sending messages very quickly. Wait a moment and try again.",
    };
  }
  const now = input.now ?? new Date();
  const result = await withTransaction(async (tx): Promise<DmResult> => {
    const facts = await loadTeamChatFacts(tx, input, true);
    if (!facts || !facts.conversationId || !canReadTeamChat(facts.access)) {
      return { ok: false, error: TEAM_CHAT_NOT_FOUND };
    }
    if (!canSendTeamMessage(facts.access, { archived: facts.archived })) {
      return {
        ok: false,
        error: "This team is archived — its chat is read-only.",
      };
    }
    await tx.insert(schema.messages).values({
      conversationId: facts.conversationId,
      senderId: input.viewerUserId,
      kind: "text",
      body,
      createdAt: now,
      expiresAt: messageExpiresAt(facts.timer, now),
    });
    await tx
      .update(schema.conversations)
      .set({ lastMessageAt: now })
      .where(eq(schema.conversations.id, facts.conversationId));
    // Sending is reading: the sender's own unread marker moves with them.
    await tx
      .update(schema.conversationParticipants)
      .set({ lastReadAt: now })
      .where(
        and(
          eq(
            schema.conversationParticipants.conversationId,
            facts.conversationId,
          ),
          eq(schema.conversationParticipants.userId, input.viewerUserId),
        ),
      );
    return { ok: true };
  });
  if (!result.ok) return result;
  return { ok: true, phoneHint: messageLooksLikePhoneNumber(body) };
}

/**
 * Change the team chat's timer — team leads and camp leads who are on the
 * team. Announced in the chat as a system line; applies to messages sent
 * after it, exactly as in a direct chat.
 */
export async function setTeamChatTimer(input: {
  groupId: string;
  teamId: string;
  viewerUserId: string;
  timer: MessageTimer;
  now?: Date;
}): Promise<DmResult> {
  if (!isDatabaseConfigured()) return { ok: false, error: TEAM_CHAT_NOT_FOUND };
  if (await rateLimited("send", input.viewerUserId)) {
    return {
      ok: false,
      error: "Too many changes. Wait a moment and try again.",
    };
  }
  const now = input.now ?? new Date();
  const timer = readMessageTimer(input.timer);
  return withTransaction(async (tx): Promise<DmResult> => {
    const facts = await loadTeamChatFacts(tx, input, true);
    if (!facts || !facts.conversationId || !canReadTeamChat(facts.access)) {
      return { ok: false, error: TEAM_CHAT_NOT_FOUND };
    }
    if (
      !canSetTeamChatTimer(
        facts.access,
        facts.viewer,
        { archived: facts.archived },
        facts.seat,
      )
    ) {
      return {
        ok: false,
        error: "Only the team's leads and the camp's leads change the timer.",
      };
    }
    await tx
      .update(schema.conversations)
      .set({ timer, lastMessageAt: now })
      .where(eq(schema.conversations.id, facts.conversationId));
    await tx.insert(schema.messages).values({
      conversationId: facts.conversationId,
      senderId: input.viewerUserId,
      kind: "system",
      body: timerChangeNotice(timer),
      createdAt: now,
      expiresAt: messageExpiresAt(timer, now),
    });
    return { ok: true };
  });
}

/**
 * Report selected team-chat messages. Copies exactly those messages — only
 * if every one is live, of this team's chat, and one the reporter can SEE
 * (after they joined, not hidden by a block) — into a report, as for direct
 * chats. Anything else refuses the whole report.
 */
export async function reportTeamMessages(input: {
  groupId: string;
  teamId: string;
  viewerUserId: string;
  messageIds: readonly string[];
  reason: string | null;
  now?: Date;
}): Promise<DmResult<{ reportId: string }>> {
  if (!isDatabaseConfigured()) return { ok: false, error: TEAM_CHAT_NOT_FOUND };
  const now = input.now ?? new Date();
  const facts = await loadTeamChatFacts(db(), input);
  // Refused before any message row is read.
  if (
    !facts ||
    !facts.conversationId ||
    !facts.joinedAt ||
    !canReadTeamChat(facts.access)
  ) {
    return { ok: false, error: TEAM_CHAT_NOT_FOUND };
  }
  const uniqueIds = [...new Set(input.messageIds)];
  if (uniqueIds.length === 0) {
    return { ok: false, error: "Select at least one message to report." };
  }
  const [selected, blocks] = await Promise.all([
    db()
      .select({
        id: schema.messages.id,
        conversationId: schema.messages.conversationId,
        senderId: schema.messages.senderId,
        kind: schema.messages.kind,
        body: schema.messages.body,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(and(inArray(schema.messages.id, uniqueIds), liveAt(now))),
    loadBlocksOf(input.viewerUserId),
  ]);
  if (
    selected.length !== uniqueIds.length ||
    !canReportTeamMessages({
      access: facts.access,
      conversationId: facts.conversationId,
      joinedAt: facts.joinedAt,
      blocks,
      selected,
    })
  ) {
    return { ok: false, error: "Those messages can't be reported from here." };
  }
  if (await rateLimited("report", input.viewerUserId)) {
    return {
      ok: false,
      error: "You've sent several reports recently. Try again later.",
    };
  }
  const reason =
    input.reason?.trim().slice(0, REPORT_REASON_MAX_LENGTH) || null;
  const conversationId = facts.conversationId;
  const reportId = await withTransaction(async (tx) => {
    const [report] = await tx
      .insert(schema.messageReports)
      .values({
        conversationId,
        reporterId: input.viewerUserId,
        reportedUserId: reportedTeamSender(input.viewerUserId, selected),
        reason,
        // Where it came from, as named NOW: a snapshot that survives a
        // rename, an archive or the team's deletion. Only the two names.
        sourceCampName: facts.campName,
        sourceTeamName: facts.teamName,
        createdAt: now,
        expiresAt: reportCopyExpiresAt(now),
      })
      .returning({ id: schema.messageReports.id });
    if (!report) throw new Error("report could not be created");
    await tx.insert(schema.messageReportItems).values(
      selected.map((m) => ({
        reportId: report.id,
        originalMessageId: m.id,
        senderId: m.senderId,
        kind: m.kind,
        body: m.body,
        sentAt: m.createdAt,
      })),
    );
    return report.id;
  });
  return { ok: true, reportId };
}
