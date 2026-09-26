import "server-only";

import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
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
  type DmRateLimitAction,
  type MessageTimer,
  type UserBlock,
} from "@quagga/core";

import { db, schema, withTransaction } from "./db";
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
    })
    .from(schema.conversationParticipants)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.conversationParticipants.userId),
    )
    .where(eq(schema.conversationParticipants.conversationId, conversationId));
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

export interface InboxEntry {
  conversationId: string;
  otherUserId: string;
  otherName: string;
  showAvatar: boolean;
  unread: number;
  lastMessageAt: Date | null;
}

/**
 * The viewer's inbox: one row per conversation they are in and have not
 * hidden, newest first. NO MESSAGE BODY is selected — the preview is the
 * sender and an unread count, never content.
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
      ),
    )
    .orderBy(
      desc(
        sql`coalesce(${schema.conversations.lastMessageAt}, ${schema.conversations.createdAt})`,
      ),
    )
    .limit(100);
  if (mine.length === 0) return [];
  const ids = mine.map((r) => r.conversationId);

  const others = await db()
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
        inArray(schema.conversationParticipants.conversationId, ids),
        ne(schema.conversationParticipants.userId, me),
      ),
    );
  const unreadRows = await unreadCounts(me, now, ids);

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
  for (const row of mine) {
    const other = others.find((o) => o.conversationId === row.conversationId);
    if (!other) continue;
    entries.push({
      conversationId: row.conversationId,
      otherUserId: other.userId,
      otherName: displayName(other),
      showAvatar: avatarOf.get(other.userId) ?? false,
      unread: unreadRows.get(row.conversationId) ?? 0,
      lastMessageAt: row.lastMessageAt,
    });
  }
  return entries;
}

/** Unread live text messages from others, per conversation. */
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
    .where(and(...conds))
    .groupBy(schema.messages.conversationId);
  return new Map(rows.map((r) => [r.conversationId, Number(r.count)]));
}

/** The header badge: unread messages across every visible conversation.
 * Env-less / failure ⇒ 0, so the chrome always renders. */
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
