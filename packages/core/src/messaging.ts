// Direct messaging (epic #69). PURE predicates and policy only — no DB, no I/O.
// The apps load participants, blocks, bios and memberships from the database,
// pass them here, and act ONLY on what comes back.
//
// ── WHO MAY START A CHAT ────────────────────────────────────────────────────
//
// Anyone may message anyone who has opted in to being contactable (epic #68's
// `burner_bios.contactable`, read through `canContact`): `anyone` means any
// signed-in burner, `camp_mates` means a genuinely shared THEME CAMP (never an
// org or artwork group, never a lead of another camp), `nobody` — the default —
// means nobody. A block refuses, in EITHER direction, whatever the setting says.
//
// ── WHO MAY READ A CHAT ─────────────────────────────────────────────────────
//
// Its participants. Nobody else, and that is the whole rule: there is NO role
// bypass. Not the System manager (`god`), not a camp lead, not org safety staff.
// `canReadConversation` takes no role, rank or capability on purpose — there is
// no parameter through which one could ever be passed in and widen it.
//
// ── WHAT THE ORG MAY SEE ────────────────────────────────────────────────────
//
// Only what a participant REPORTS. A report copies the specific messages the
// reporter selected (from a conversation they are in) into the report, and
// org safety staff see those copies and nothing else — never the conversation,
// never the messages around them. Reading one writes an audit row. The copy has
// its own FIXED retention (`REPORT_COPY_RETENTION_DAYS`), because a report must
// stay actionable after the originals disappear on the chat's timer.
//
// ── RETENTION IS THE USER'S CHOICE ──────────────────────────────────────────
//
// There is no platform-wide retention period. Each conversation has a timer
// (off / 24h / 7d / 90d) that any participant may change; each message stores
// its OWN `expires_at`, fixed at send time from the timer then in force, so a
// change applies to messages sent after it and never rewrites history. Expired
// messages are hard-deleted by a sweep, and every read filters them out so
// nothing shows between sweeps. Disappearing is not a promise against
// screenshots, and the copy says so.
//
// ── PHONE NUMBERS ARE NEVER AN IDENTIFIER ───────────────────────────────────
//
// People are addressed by user id and shown by handle (`publicMemberName`).
// Phone numbers are hard-locked (./privacy) and nothing here reads one. A
// message that LOOKS like it carries a phone number gets a non-blocking hint —
// sharing your own number is the sender's call, but it should be a conscious
// one on a platform whose whole point is that you do not have to.

import { canContact, type CampmateContext } from "./campmates";
import {
  canReadPersonalInformationIn,
  orgCanInDomain,
  type OrgActor,
} from "./org-permissions";
import { sanitizeReportText } from "./report-sanitize";

// --- Limits ---------------------------------------------------------------

/** Longest message body, in characters. */
export const MESSAGE_MAX_LENGTH = 2_000;

/** Most messages one report may attach. A report is about specific messages;
 * a selection this large is a conversation dump, which the org may not hold. */
export const REPORT_MAX_MESSAGES = 20;

/** Longest free-text reason on a report. Optional — the messages speak. */
export const REPORT_REASON_MAX_LENGTH = 1_000;

/**
 * Rate limits (fed to @quagga/db `consumeRateLimit`). Generous for a person,
 * tight for a script: starting chats with strangers is the abuse vector, so it
 * is the tightest.
 */
export const DM_RATE_LIMITS = {
  start: { max: 10, windowSeconds: 60 * 60 },
  send: { max: 60, windowSeconds: 10 * 60 },
  report: { max: 10, windowSeconds: 60 * 60 },
} as const;

export type DmRateLimitAction = keyof typeof DM_RATE_LIMITS;

/** The limiter key for one account and one action. Per ACCOUNT, not per IP:
 * the actions are signed-in, and on site a whole camp shares one uplink. */
export function dmRateLimitKey(action: DmRateLimitAction, userId: string): string {
  return `dm_${action}:${userId}`;
}

// --- Disappearing messages ------------------------------------------------

export const MESSAGE_TIMERS = ["off", "24h", "7d", "90d"] as const;
export type MessageTimer = (typeof MESSAGE_TIMERS)[number];

/** Off: messages stay until someone deletes their account. */
export const DEFAULT_MESSAGE_TIMER: MessageTimer = "off";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const TIMER_MS: Record<MessageTimer, number | null> = {
  off: null,
  "24h": 24 * HOUR_MS,
  "7d": 7 * DAY_MS,
  "90d": 90 * DAY_MS,
};

export const MESSAGE_TIMER_LABELS: Record<MessageTimer, string> = {
  off: "Off",
  "24h": "24 hours",
  "7d": "7 days",
  "90d": "90 days",
};

/** Decode a stored or submitted timer, failing closed to `off`. `off` is the
 * safe decode because it deletes nothing the sender did not ask to delete —
 * an unknown value must never shorten someone's history on a guess. */
export function readMessageTimer(value: unknown): MessageTimer {
  return (MESSAGE_TIMERS as readonly unknown[]).includes(value)
    ? (value as MessageTimer)
    : DEFAULT_MESSAGE_TIMER;
}

/**
 * When a message sent at `sentAt` under `timer` expires, or null for never.
 * Computed ONCE, at send time, and stored on the message — a later timer
 * change applies to later messages only.
 */
export function messageExpiresAt(
  timer: MessageTimer,
  sentAt: Date,
): Date | null {
  const ms = TIMER_MS[timer];
  return ms == null ? null : new Date(sentAt.getTime() + ms);
}

/** Is this message still visible at `now`? The boundary is exclusive: at
 * exactly `expiresAt` it is gone, same as the SQL filter (`expires_at > now`). */
export function isMessageLive(
  message: { expiresAt: Date | null },
  now: Date,
): boolean {
  return message.expiresAt == null || message.expiresAt.getTime() > now.getTime();
}

/** The system line posted into the chat when a participant changes the timer.
 * Names no one — the read path prefixes the actor's handle. */
export function timerChangeNotice(timer: MessageTimer): string {
  return timer === "off"
    ? "turned off disappearing messages."
    : `set disappearing messages to ${MESSAGE_TIMER_LABELS[timer]}. New messages will be deleted ${MESSAGE_TIMER_LABELS[timer]} after they are sent.`;
}

/** The honest copy wherever the timer is offered. */
export const DISAPPEARING_MESSAGES_NOTE =
  "Disappearing messages are deleted from AfrikaBurn's servers when their timer runs out. It is not a promise against screenshots or copies — anyone in the chat can still keep what they see.";

// --- Reports ---------------------------------------------------------------

/**
 * How long a REPORT'S COPY of the reported messages is kept: 180 days from the
 * report. Long enough for a safety process that spans one event's build, burn
 * and follow-up; bounded, because the copy exists for one purpose. After it,
 * the sweep hard-deletes the report and its copies.
 */
export const REPORT_COPY_RETENTION_DAYS = 180;

export function reportCopyExpiresAt(reportedAt: Date): Date {
  return new Date(reportedAt.getTime() + REPORT_COPY_RETENTION_DAYS * DAY_MS);
}

/** What the reporter is told before they submit. */
export const REPORT_COPY_NOTE = `Reporting copies only the messages you select into the report, so AfrikaBurn's safety team can act on them even after this chat's timer deletes the originals. The copy is kept for ${REPORT_COPY_RETENTION_DAYS} days and then deleted. The safety team sees those messages and nothing else from this conversation.`;

/** The audit action written when safety staff open a report's messages. */
export const MESSAGE_REPORT_VIEW_AUDIT_ACTION = "dm.report.view";

/** The audit action written when a report is resolved. */
export const MESSAGE_REPORT_RESOLVE_AUDIT_ACTION = "dm.report.resolve";

export const MESSAGE_REPORT_STATUSES = ["open", "resolved"] as const;
export type MessageReportStatus = (typeof MESSAGE_REPORT_STATUSES)[number];

// --- Blocks ----------------------------------------------------------------

export interface UserBlock {
  blockerId: string;
  blockedId: string;
}

/** Does a block exist between these two people, in EITHER direction? */
export function isBlockedEitherWay(
  blocks: readonly UserBlock[],
  a: string,
  b: string,
): boolean {
  return blocks.some(
    (x) =>
      (x.blockerId === a && x.blockedId === b) ||
      (x.blockerId === b && x.blockedId === a),
  );
}

// --- Conversations ---------------------------------------------------------

/**
 * The key that makes a 1:1 conversation unique per PAIR, whoever started it:
 * the two user ids, sorted, joined. Stored with a unique index so two
 * concurrent "Message" clicks cannot create two chats.
 */
export function directConversationKey(a: string, b: string): string {
  if (a === b) throw new Error("A conversation needs two different people.");
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * May `viewerUserId` read this conversation? ONLY if they are a participant.
 *
 * There is deliberately no role, rank or capability parameter: org staff, the
 * System manager and camp leads are refused exactly like a stranger, because
 * nothing here can tell them apart from one. What the org may see is a
 * REPORT (`canReviewMessageReports`), never a conversation.
 */
export function canReadConversation(input: {
  viewerUserId: string;
  participantUserIds: readonly string[];
}): boolean {
  if (!input.viewerUserId) return false;
  return input.participantUserIds.includes(input.viewerUserId);
}

/** The facts `canStartConversation` needs, all resolved server-side. */
export interface StartConversationInput {
  /** Memberships of both people, with group kind (camp-mate check). */
  ctx: CampmateContext;
  /** The target's `contactable` setting for the current edition. */
  contactable: unknown;
  /** The target's bio for the current edition is confirmed. */
  subjectConfirmed: boolean;
  subjectSanitized: boolean;
  /** The actor's own account is sanitized (defence in depth: the session
   * resolvers already refuse one). */
  actorSanitized?: boolean;
  /** Every block between the two people, either direction. */
  blocks: readonly UserBlock[];
}

/**
 * May the actor START a conversation with the target? The target's own
 * contactability decides (`canContact`: `anyone`, or `camp_mates` with a
 * genuinely shared theme camp), and a block in either direction always wins.
 */
export function canStartConversation(input: StartConversationInput): boolean {
  if (input.actorSanitized) return false;
  if (
    isBlockedEitherWay(
      input.blocks,
      input.ctx.viewerUserId,
      input.ctx.subjectUserId,
    )
  ) {
    return false;
  }
  return canContact({
    ctx: input.ctx,
    contactable: input.contactable,
    subjectSanitized: input.subjectSanitized,
    subjectConfirmed: input.subjectConfirmed,
  });
}

/**
 * May the sender post into an EXISTING conversation? A participant, while no
 * block stands between them and the others and nobody in it has been deleted.
 * Contactability is not re-asked: it governs who may START a chat, and a
 * participant who no longer wants to hear from someone blocks them.
 */
export function canSendMessage(input: {
  senderUserId: string;
  participants: readonly { userId: string; sanitized: boolean }[];
  blocks: readonly UserBlock[];
}): boolean {
  const ids = input.participants.map((p) => p.userId);
  if (!canReadConversation({ viewerUserId: input.senderUserId, participantUserIds: ids })) {
    return false;
  }
  for (const p of input.participants) {
    if (p.sanitized) return false;
    if (p.userId === input.senderUserId) continue;
    if (isBlockedEitherWay(input.blocks, input.senderUserId, p.userId)) {
      return false;
    }
  }
  return true;
}

/**
 * May the reporter attach these messages to a report? Only when they are a
 * participant of the conversation, the selection is non-empty and bounded,
 * and EVERY selected message belongs to that same conversation. A single
 * foreign id refuses the whole report — a report is never a way to read or
 * copy someone else's chat.
 */
export function canReportMessages(input: {
  reporterUserId: string;
  conversationId: string;
  participantUserIds: readonly string[];
  selected: readonly { id: string; conversationId: string }[];
}): boolean {
  if (
    !canReadConversation({
      viewerUserId: input.reporterUserId,
      participantUserIds: input.participantUserIds,
    })
  ) {
    return false;
  }
  if (input.selected.length === 0) return false;
  if (input.selected.length > REPORT_MAX_MESSAGES) return false;
  return input.selected.every((m) => m.conversationId === input.conversationId);
}

/**
 * May this org actor open the safety queue and read REPORTED messages? The
 * same authority that reads a burner's medical notes: personal information in
 * the registrations domain (./medical-access — "AfrikaBurn's safety team").
 * No new capability, and no god-only shortcut: a System manager passes because
 * `god` resolves every capability, exactly as it does for medical notes.
 */
export function canReviewMessageReports(
  actor: OrgActor | null | undefined,
): boolean {
  return canReadPersonalInformationIn(actor, "registrations");
}

/** May they also RESOLVE a report? Reading it, plus ordinary update rights
 * in the same domain. */
export function canResolveMessageReports(
  actor: OrgActor | null | undefined,
): boolean {
  return (
    canReviewMessageReports(actor) &&
    orgCanInDomain(actor, "update", "registrations")
  );
}

// --- Hints and previews ------------------------------------------------------

/**
 * Does this message look like it contains a phone number? Reuses the in-app
 * reporter's South-African-aware patterns (./report-sanitize) so there is one
 * definition of "looks like a phone number" in the codebase. A HINT, never a
 * block — pattern-matching fails open and closed both, and it is the sender's
 * own number to share.
 */
export function messageLooksLikePhoneNumber(body: string): boolean {
  return sanitizeReportText(body, MESSAGE_MAX_LENGTH).redacted.includes("phone");
}

export const PHONE_NUMBER_HINT =
  "That looks like it might contain a phone number. You can share it if you want to — just know you don't have to: messages here work without anyone's number.";

/**
 * The only preview of unread messages anywhere: WHO, and HOW MANY — never
 * what. Used by the inbox list and by the (future) email digest line.
 */
export function unreadMessagesLine(count: number, senderName: string): string {
  if (count <= 0) return "";
  return count === 1
    ? `1 new message from ${senderName}`
    : `${count} new messages from ${senderName}`;
}
