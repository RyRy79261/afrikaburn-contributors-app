import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import {
  ANNOUNCEMENT_MESSAGES,
  campAnnouncementEmail,
  campAnnouncementNotification,
  canPinCampAnnouncement,
  canSendCampAnnouncement,
  decideDispatch,
  enforceKindPermissions,
  explainDraftRefusal,
  explainPinRefusal,
  isAnnouncementSchedulingEnabled,
  resolveCampAnnouncementRecipients,
  shouldSendImmediateEmail,
  validateSendAt,
  type PermissionMembership,
} from "@quagga/core";
import type {
  AnnouncementPresentation,
  AudienceSpec,
  OfficerKey,
  ProjectAudience,
  ProjectPermissions,
} from "@quagga/types";

import { activeMembership } from "@quagga/db";
import { db, schema, withTransaction, type Tx } from "./db";
import { sendEmail } from "./email";
import {
  getBaselineRoleId,
  getMemberPermissions,
  listRoles,
} from "./roles-store";

// Camp announcements (epic #56) — the store. Every write here is a claim: a
// compare-and-set UPDATE whose WHERE names the state it expects to change, run
// in a transaction that has first re-read — and LOCKED — the rows the sender's
// permission rests on. The model is Camp 404's `broadcasts.ts`; the rules are
// the pure predicates in @quagga/core `announcements`.
//
//   · Drafts are the AUTHOR's. Every draft read and write is keyed on
//     (id, camp, author, unpublished); anyone else's draft answers exactly as a
//     missing one does.
//   · Publishing re-checks `canSendCampAnnouncement` INSIDE the transaction
//     over rows held `FOR SHARE`, so a sender demoted between drafting and
//     publishing is refused, and a demotion that arrives mid-publish waits.
//   · Fan-out is in the same transaction as the claim: an announcement is
//     never published without its deliveries, nor delivered without being
//     published. Fan-out runs only after a claim succeeds (publish's CAS on
//     the unpublished draft, dispatch's CAS on `dispatched_at IS NULL`), so
//     a retry or an overlapping run claims nothing and delivers nothing.
//   · Published announcements are immutable. There is no edit or delete path
//     for one here, by design.
//   · The recipient's delivery row IS the read permission (lib/bulletins.ts).

// --- Sender context -----------------------------------------------------

/** What `canSendCampAnnouncement` needs about the sender and the camp. */
export interface SenderContext {
  perms: PermissionMembership;
  baselineRoleId: string | null;
  campRoleIds: Set<string>;
}

/**
 * The sender context for a page or an action's early answer. A SNAPSHOT: the
 * write paths below never trust it, they call `lockSenderContext` again inside
 * their own transaction. Null when the viewer is not a member of the camp.
 */
export async function getSenderContext(
  groupId: string,
  userId: string,
): Promise<SenderContext | null> {
  const perms = await getMemberPermissions(groupId, userId);
  if (!perms) return null;
  const [baselineRoleId, roles] = await Promise.all([
    getBaselineRoleId(groupId),
    listRoles(groupId),
  ]);
  return {
    perms,
    baselineRoleId,
    campRoleIds: new Set(roles.map((r) => r.id)),
  };
}

/**
 * The sender context, read INSIDE a write's transaction and HELD there until
 * it commits (`FOR SHARE`): the membership row (structural role), the camp's
 * project roles (their permission objects) and the sender's accepted role
 * assignments. A demotion, a role edit or an unassignment that committed first
 * is what this sees; one that comes later waits for this transaction. The check
 * and the write cannot fall out of step (Camp 404's `lockSenderReach`).
 *
 * Lock order is memberships → project_roles → member_role_assignments,
 * everywhere in this file.
 */
async function lockSenderContext(
  tx: Tx,
  groupId: string,
  userId: string,
): Promise<SenderContext | null> {
  const [membership] = await tx
    .select({ id: schema.memberships.id, role: schema.memberships.role })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.groupId, groupId),
        activeMembership(),
      ),
    )
    .limit(1)
    .for("share");
  if (!membership) return null;

  const roles = await tx
    .select({
      id: schema.projectRoles.id,
      kind: schema.projectRoles.kind,
      permissions: schema.projectRoles.permissions,
    })
    .from(schema.projectRoles)
    .where(eq(schema.projectRoles.groupId, groupId))
    .for("share");

  const held = await tx
    .select({ projectRoleId: schema.memberRoleAssignments.projectRoleId })
    .from(schema.memberRoleAssignments)
    .where(
      and(
        eq(schema.memberRoleAssignments.membershipId, membership.id),
        eq(schema.memberRoleAssignments.consentStatus, "accepted"),
      ),
    )
    .for("share");
  const heldIds = new Set(held.map((h) => h.projectRoleId));

  const rolePermissions: ProjectPermissions[] = [];
  let baselineRoleId: string | null = null;
  for (const r of roles) {
    if (r.kind === "baseline") {
      baselineRoleId = r.id;
      rolePermissions.push(r.permissions);
      continue;
    }
    if (heldIds.has(r.id)) {
      rolePermissions.push(enforceKindPermissions(r.kind, r.permissions));
    }
  }
  return {
    perms: { structuralRole: membership.role, rolePermissions },
    baselineRoleId,
    campRoleIds: new Set(roles.map((r) => r.id)),
  };
}

function sendAllowed(
  sender: SenderContext | null,
  groupId: string,
  audience: AudienceSpec,
  presentation: AnnouncementPresentation,
): boolean {
  if (!sender || audience.kind !== "project") return false;
  return canSendCampAnnouncement(sender.perms, {
    groupId,
    audience,
    presentation,
    baselineRoleId: sender.baselineRoleId,
    campRoleIds: sender.campRoleIds,
  });
}

function pinAllowed(
  sender: SenderContext | null,
  groupId: string,
  audience: AudienceSpec,
): boolean {
  if (!sender || audience.kind !== "project") return false;
  return canPinCampAnnouncement(sender.perms, {
    groupId,
    audience,
    baselineRoleId: sender.baselineRoleId,
    campRoleIds: sender.campRoleIds,
  });
}

/** The one predicate every draft write claims with: this id, this camp, this
 * author, still unpublished. */
function isOwnedDraft(id: string, groupId: string, authorId: string) {
  return and(
    eq(schema.bulletins.id, id),
    eq(schema.bulletins.groupId, groupId),
    eq(schema.bulletins.createdByUserId, authorId),
    isNull(schema.bulletins.publishedAt),
  );
}

async function explainDraft(
  id: string,
  groupId: string,
  actorId: string,
  allowed: boolean,
): Promise<string> {
  const [row] = await db()
    .select({
      groupId: schema.bulletins.groupId,
      createdByUserId: schema.bulletins.createdByUserId,
      publishedAt: schema.bulletins.publishedAt,
    })
    .from(schema.bulletins)
    .where(eq(schema.bulletins.id, id))
    .limit(1);
  return explainDraftRefusal(row ?? null, { actorId, groupId, allowed });
}

async function audit(
  tx: Tx,
  actorId: string | null,
  action: string,
  subject: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await tx.insert(schema.auditEvents).values({
    actorId,
    action,
    subject,
    meta: meta ?? null,
  });
}

// --- Author-side reads -------------------------------------------------

export interface AnnouncementTally {
  sent: number;
  read: number;
  acknowledged: number;
}

export interface AuthorAnnouncement {
  id: string;
  title: string;
  bodyMd: string;
  audience: ProjectAudience;
  presentation: AnnouncementPresentation;
  meetingUrl: string | null;
  pinOnPublish: boolean;
  pinnedAt: Date | null;
  sendAt: Date | null;
  publishedAt: Date | null;
  dispatchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  isMine: boolean;
  /** Whether the viewer may pin/unpin it (posting authority over its audience). */
  canPin: boolean;
  tally: AnnouncementTally;
}

const NO_TALLY: AnnouncementTally = { sent: 0, read: 0, acknowledged: 0 };

const announcementColumns = {
  id: schema.bulletins.id,
  title: schema.bulletins.title,
  bodyMd: schema.bulletins.bodyMd,
  audience: schema.bulletins.audience,
  presentation: schema.bulletins.presentation,
  meetingUrl: schema.bulletins.meetingUrl,
  pinOnPublish: schema.bulletins.pinOnPublish,
  pinnedAt: schema.bulletins.pinnedAt,
  sendAt: schema.bulletins.sendAt,
  publishedAt: schema.bulletins.publishedAt,
  dispatchedAt: schema.bulletins.dispatchedAt,
  createdAt: schema.bulletins.createdAt,
  updatedAt: schema.bulletins.updatedAt,
  createdByUserId: schema.bulletins.createdByUserId,
};

interface AnnouncementRow {
  id: string;
  title: string;
  bodyMd: string;
  audience: AudienceSpec;
  presentation: AnnouncementPresentation;
  meetingUrl: string | null;
  pinOnPublish: boolean;
  pinnedAt: Date | null;
  sendAt: Date | null;
  publishedAt: Date | null;
  dispatchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

async function tallies(
  ids: readonly string[],
): Promise<Map<string, AnnouncementTally>> {
  if (ids.length === 0) return new Map();
  const rows = await db()
    .select({
      bulletinId: schema.notifications.bulletinId,
      sent: sql<number>`count(*)::int`,
      read: sql<number>`count(*) filter (where ${schema.notifications.readAt} is not null)::int`,
      acknowledged: sql<number>`count(*) filter (where ${schema.notifications.acknowledgedAt} is not null)::int`,
    })
    .from(schema.notifications)
    .where(inArray(schema.notifications.bulletinId, [...ids]))
    .groupBy(schema.notifications.bulletinId);
  return new Map(
    rows.flatMap((r) =>
      r.bulletinId
        ? [
            [
              r.bulletinId,
              { sent: r.sent, read: r.read, acknowledged: r.acknowledged },
            ],
          ]
        : [],
    ),
  );
}

function toAuthorView(
  row: AnnouncementRow,
  viewerId: string,
  groupId: string,
  sender: SenderContext,
  tally: AnnouncementTally,
): AuthorAnnouncement | null {
  if (row.audience.kind !== "project") return null;
  return {
    id: row.id,
    title: row.title,
    bodyMd: row.bodyMd,
    audience: row.audience,
    presentation: row.presentation,
    meetingUrl: row.meetingUrl,
    pinOnPublish: row.pinOnPublish,
    pinnedAt: row.pinnedAt,
    sendAt: row.sendAt,
    publishedAt: row.publishedAt,
    dispatchedAt: row.dispatchedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isMine: row.createdByUserId === viewerId,
    canPin: pinAllowed(sender, groupId, row.audience),
    tally,
  };
}

/**
 * What the announcements page shows a sender: their OWN drafts (nobody
 * else's — drafts are author-private), and the camp's published announcements
 * this edition that they wrote or have posting authority over (the ones they
 * could have sent, and so may pin), with read/acknowledge tallies.
 */
export async function listCampAnnouncementsForSender(input: {
  groupId: string;
  editionId: string;
  viewerId: string;
  sender: SenderContext;
}): Promise<{ drafts: AuthorAnnouncement[]; published: AuthorAnnouncement[] }> {
  const [drafts, published] = await Promise.all([
    db()
      .select(announcementColumns)
      .from(schema.bulletins)
      .where(
        and(
          eq(schema.bulletins.groupId, input.groupId),
          eq(schema.bulletins.editionId, input.editionId),
          eq(schema.bulletins.createdByUserId, input.viewerId),
          isNull(schema.bulletins.publishedAt),
        ),
      )
      .orderBy(desc(schema.bulletins.updatedAt)),
    db()
      .select(announcementColumns)
      .from(schema.bulletins)
      .where(
        and(
          eq(schema.bulletins.groupId, input.groupId),
          eq(schema.bulletins.editionId, input.editionId),
          isNotNull(schema.bulletins.publishedAt),
        ),
      )
      .orderBy(desc(schema.bulletins.publishedAt)),
  ]);

  const visiblePublished = published.filter(
    (r) =>
      r.createdByUserId === input.viewerId ||
      pinAllowed(input.sender, input.groupId, r.audience),
  );
  const counts = await tallies(visiblePublished.map((r) => r.id));

  const view = (r: AnnouncementRow, t: AnnouncementTally) =>
    toAuthorView(r, input.viewerId, input.groupId, input.sender, t);
  return {
    drafts: drafts.flatMap((r) => view(r, NO_TALLY) ?? []),
    published: visiblePublished.flatMap(
      (r) => view(r, counts.get(r.id) ?? NO_TALLY) ?? [],
    ),
  };
}

/**
 * One announcement for the sender's detail/edit page: their own draft, or a
 * published one they wrote or hold posting authority over. Anything else —
 * another member's draft, another camp's row, an org bulletin — is null, the
 * same answer a non-existent id gets.
 */
export async function getCampAnnouncementForSender(input: {
  groupId: string;
  id: string;
  viewerId: string;
  sender: SenderContext;
}): Promise<AuthorAnnouncement | null> {
  const [row] = await db()
    .select(announcementColumns)
    .from(schema.bulletins)
    .where(
      and(
        eq(schema.bulletins.id, input.id),
        eq(schema.bulletins.groupId, input.groupId),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.publishedAt === null) {
    if (row.createdByUserId !== input.viewerId) return null;
    return toAuthorView(
      row,
      input.viewerId,
      input.groupId,
      input.sender,
      NO_TALLY,
    );
  }
  if (
    row.createdByUserId !== input.viewerId &&
    !pinAllowed(input.sender, input.groupId, row.audience)
  ) {
    return null;
  }
  const counts = await tallies([row.id]);
  return toAuthorView(
    row,
    input.viewerId,
    input.groupId,
    input.sender,
    counts.get(row.id) ?? NO_TALLY,
  );
}

// --- Drafts -------------------------------------------------------------

export interface DraftFields {
  title: string;
  bodyMd: string;
  audience: ProjectAudience;
  presentation: AnnouncementPresentation;
  pinOnPublish: boolean;
  meetingUrl: string | null;
  sendAt: Date | null;
}

export type StoreResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string };

/**
 * Create a draft, or edit the author's own draft. A draft reaches nobody, so
 * this needs no transaction; the claim predicate is what keeps it the author's.
 */
export async function saveCampAnnouncementDraft(input: {
  groupId: string;
  editionId: string;
  actorId: string;
  id?: string;
  fields: DraftFields;
}): Promise<StoreResult<{ id: string }>> {
  const now = new Date();
  const values = {
    title: input.fields.title,
    bodyMd: input.fields.bodyMd,
    audience: input.fields.audience,
    presentation: input.fields.presentation,
    pinOnPublish: input.fields.pinOnPublish,
    meetingUrl: input.fields.meetingUrl,
    sendAt: input.fields.sendAt,
    updatedAt: now,
  };

  if (!input.id) {
    const [created] = await db()
      .insert(schema.bulletins)
      .values({
        ...values,
        groupId: input.groupId,
        editionId: input.editionId,
        createdByUserId: input.actorId,
      })
      .returning({ id: schema.bulletins.id });
    if (!created) return { ok: false, error: "Could not save the draft." };
    return { ok: true, id: created.id };
  }

  const updated = await db()
    .update(schema.bulletins)
    .set(values)
    .where(isOwnedDraft(input.id, input.groupId, input.actorId))
    .returning({ id: schema.bulletins.id });
  if (updated[0]) return { ok: true, id: updated[0].id };
  return {
    ok: false,
    error: await explainDraft(input.id, input.groupId, input.actorId, true),
  };
}

/** Delete the author's own draft. A published announcement is never deleted. */
export async function deleteCampAnnouncementDraft(input: {
  groupId: string;
  id: string;
  actorId: string;
}): Promise<StoreResult> {
  const deleted = await db()
    .delete(schema.bulletins)
    .where(isOwnedDraft(input.id, input.groupId, input.actorId))
    .returning({ id: schema.bulletins.id });
  if (deleted[0]) return { ok: true };
  return {
    ok: false,
    error: await explainDraft(input.id, input.groupId, input.actorId, true),
  };
}

// --- Fan-out ------------------------------------------------------------

interface FanOutRow {
  id: string;
  groupId: string;
  title: string;
  audience: ProjectAudience;
  presentation: AnnouncementPresentation;
  createdByUserId: string | null;
  pinOnPublish: boolean;
}

interface FanOutResult {
  recipientIds: string[];
  campName: string;
}

/** Rows per notification INSERT — well inside Postgres' parameter ceiling. */
const DELIVERY_CHUNK = 1000;

/**
 * Deliver a CLAIMED announcement, inside the claim's own transaction: resolve
 * the camp's current audience, spend the pin-on-publish intent (audited, as
 * every path to a pin is), and write one delivery per recipient. Idempotency
 * comes from the claim, not from this insert: the caller only reaches here
 * after its compare-and-set (publish on the unpublished draft, dispatch on
 * `dispatched_at IS NULL`) updated the row, and a retry or overlapping run
 * finds nothing to claim and never calls this. There is no unique index on
 * (bulletin, user) to fall back on.
 */
async function fanOut(
  tx: Tx,
  row: FanOutRow,
  now: Date,
): Promise<FanOutResult> {
  const [group] = await tx
    .select({ name: schema.groups.name })
    .from(schema.groups)
    .where(eq(schema.groups.id, row.groupId))
    .limit(1);
  const campName = group?.name ?? "Your camp";

  const [memberships, roleAssignments, projectRoles] = await Promise.all([
    tx
      .select({
        membershipId: schema.memberships.id,
        userId: schema.memberships.userId,
        groupId: schema.memberships.groupId,
        role: schema.memberships.role,
        sanitizedAt: schema.users.sanitizedAt,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(
        and(eq(schema.memberships.groupId, row.groupId), activeMembership()),
      ),
    tx
      .select({
        membershipId: schema.memberRoleAssignments.membershipId,
        projectRoleId: schema.memberRoleAssignments.projectRoleId,
        consent: schema.memberRoleAssignments.consentStatus,
      })
      .from(schema.memberRoleAssignments)
      .innerJoin(
        schema.memberships,
        eq(schema.memberships.id, schema.memberRoleAssignments.membershipId),
      )
      .where(
        and(eq(schema.memberships.groupId, row.groupId), activeMembership()),
      ),
    tx
      .select({
        id: schema.projectRoles.id,
        groupId: schema.projectRoles.groupId,
        kind: schema.projectRoles.kind,
        officerKey: schema.projectRoles.officerKey,
      })
      .from(schema.projectRoles)
      .where(eq(schema.projectRoles.groupId, row.groupId)),
  ]);

  const recipientIds = resolveCampAnnouncementRecipients(
    row.audience,
    {
      groupId: row.groupId,
      memberships,
      roleAssignments,
      projectRoles: projectRoles.map((r) => ({
        ...r,
        officerKey: (r.officerKey as OfficerKey | null) ?? null,
      })),
      excludedUserIds: new Set(
        memberships.filter((m) => m.sanitizedAt !== null).map((m) => m.userId),
      ),
    },
    row.createdByUserId,
  );

  if (row.pinOnPublish) {
    await tx
      .update(schema.bulletins)
      .set({
        pinned: true,
        pinnedAt: now,
        pinnedByUserId: row.createdByUserId,
        pinOnPublish: false,
      })
      .where(eq(schema.bulletins.id, row.id));
    await audit(tx, row.createdByUserId, "announcement.pin", row.id, {
      groupId: row.groupId,
      via: "publish",
    });
  }

  const payload = campAnnouncementNotification({
    campName,
    title: row.title,
    announcementId: row.id,
    presentation: row.presentation,
  });
  for (let i = 0; i < recipientIds.length; i += DELIVERY_CHUNK) {
    const chunk = recipientIds.slice(i, i + DELIVERY_CHUNK);
    await tx.insert(schema.notifications).values(
      chunk.map((userId) => ({
        userId,
        kind: payload.kind,
        title: payload.title,
        body: payload.body,
        link: payload.link,
        origin: "camp",
        linkApp: "web",
        bulletinId: row.id,
      })),
    );
  }

  return { recipientIds, campName };
}

/**
 * The immediate email for a must-acknowledge announcement, AFTER the
 * deliveries have committed. Best-effort: in-app is the source of truth, and a
 * mail failure never un-publishes anything. One message per recipient
 * (`sendEmail` never puts two members in one header).
 */
async function emailMustAcknowledge(
  row: { id: string; title: string; presentation: AnnouncementPresentation },
  fan: FanOutResult,
): Promise<void> {
  if (
    fan.recipientIds.length === 0 ||
    !shouldSendImmediateEmail("bulletin", {
      mustAcknowledge: row.presentation === "acknowledge",
    })
  ) {
    return;
  }
  try {
    const users = await db()
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(inArray(schema.users.id, fan.recipientIds));
    const emails = users
      .map((u) => u.email)
      .filter((e): e is string => Boolean(e));
    if (emails.length === 0) return;
    const message = campAnnouncementEmail({
      campName: fan.campName,
      title: row.title,
      announcementId: row.id,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
    });
    await sendEmail({ to: emails, ...message });
  } catch (err) {
    console.error("[announcements] must-acknowledge email failed", err);
  }
}

/**
 * Scheduled sending is on only when the deployment has wired a scheduler to
 * `/api/announcements/dispatch` and says so with
 * `ANNOUNCEMENT_DISPATCH_ENABLED=true`. Off by default: nothing else would
 * ever deliver a scheduled row, and a published one cannot be edited.
 */
export function announcementSchedulingEnabled(): boolean {
  return isAnnouncementSchedulingEnabled(
    process.env.ANNOUNCEMENT_DISPATCH_ENABLED,
  );
}

// --- Publish ------------------------------------------------------------

export type PublishOutcome =
  | { ok: true; recipients: number; scheduledFor: Date | null }
  | { ok: false; error: string };

/**
 * Publish the author's own draft: now, or — when it carries a `send_at` — as a
 * scheduled send the dispatch job delivers. One transaction: lock the sender's
 * permission rows, lock the draft, re-check the audience against what the lock
 * saw, claim the draft (compare-and-set on "still an unpublished draft of
 * mine"), and for an immediate send fan out before commit.
 */
export async function publishCampAnnouncement(input: {
  groupId: string;
  id: string;
  actorId: string;
  activeEditionId: string;
  now?: Date;
  /** Defaults to the deployment flag; tests pass it explicitly. */
  schedulingEnabled?: boolean;
}): Promise<PublishOutcome> {
  const now = input.now ?? new Date();
  let emailAfter: { row: FanOutRow; fan: FanOutResult } | null = null;

  const outcome = await withTransaction(
    async (tx): Promise<PublishOutcome | "explain"> => {
      const sender = await lockSenderContext(tx, input.groupId, input.actorId);
      const [row] = await tx
        .select({
          ...announcementColumns,
          editionId: schema.bulletins.editionId,
        })
        .from(schema.bulletins)
        .where(isOwnedDraft(input.id, input.groupId, input.actorId))
        .limit(1)
        .for("update");
      if (!row || row.audience.kind !== "project") return "explain";

      if (!sendAllowed(sender, input.groupId, row.audience, row.presentation)) {
        return { ok: false, error: ANNOUNCEMENT_MESSAGES.notAllowed };
      }
      if (row.editionId !== input.activeEditionId) {
        return {
          ok: false,
          error:
            "This draft was written for an earlier edition. Start a new announcement for this one.",
        };
      }
      const schedule = validateSendAt(row.sendAt, now, {
        schedulingEnabled:
          input.schedulingEnabled ?? announcementSchedulingEnabled(),
      });
      if (!schedule.ok) return { ok: false, error: schedule.error };
      const scheduled = schedule.sendAt !== null;

      const claimed = await tx
        .update(schema.bulletins)
        .set({
          publishedAt: now,
          dispatchedAt: scheduled ? null : now,
          updatedAt: now,
        })
        .where(isOwnedDraft(input.id, input.groupId, input.actorId))
        .returning({ id: schema.bulletins.id });
      if (!claimed[0]) return "explain";

      await audit(tx, input.actorId, "announcement.publish", row.id, {
        groupId: input.groupId,
        presentation: row.presentation,
        scheduledFor: schedule.sendAt?.toISOString() ?? null,
      });

      if (scheduled) {
        return { ok: true, recipients: 0, scheduledFor: schedule.sendAt };
      }

      const fanRow: FanOutRow = {
        id: row.id,
        groupId: input.groupId,
        title: row.title,
        audience: row.audience,
        presentation: row.presentation,
        createdByUserId: row.createdByUserId,
        pinOnPublish: row.pinOnPublish,
      };
      const fan = await fanOut(tx, fanRow, now);
      emailAfter = { row: fanRow, fan };
      return {
        ok: true,
        recipients: fan.recipientIds.length,
        scheduledFor: null,
      };
    },
  );

  if (outcome === "explain") {
    return {
      ok: false,
      error: await explainDraft(input.id, input.groupId, input.actorId, true),
    };
  }
  const pending = emailAfter as { row: FanOutRow; fan: FanOutResult } | null;
  if (outcome.ok && pending)
    await emailMustAcknowledge(pending.row, pending.fan);
  return outcome;
}

// --- Pinning ------------------------------------------------------------

/**
 * Pin or unpin a delivered announcement, and record it. A compare-and-set:
 * the WHERE names the state it expects to change, so two authors racing
 * cannot silently overwrite each other — the loser is told. Authority is
 * re-read and held inside the transaction, exactly as for publish. The audit
 * row commits with the change: a pin puts a message on every recipient's
 * camp dashboard and leaves it there.
 */
export async function setCampAnnouncementPinned(input: {
  groupId: string;
  id: string;
  actorId: string;
  pinned: boolean;
}): Promise<StoreResult> {
  const now = new Date();
  const outcome = await withTransaction(async (tx): Promise<StoreResult> => {
    const sender = await lockSenderContext(tx, input.groupId, input.actorId);
    const [row] = await tx
      .select({
        groupId: schema.bulletins.groupId,
        audience: schema.bulletins.audience,
        dispatchedAt: schema.bulletins.dispatchedAt,
        pinnedAt: schema.bulletins.pinnedAt,
      })
      .from(schema.bulletins)
      .where(
        and(
          eq(schema.bulletins.id, input.id),
          eq(schema.bulletins.groupId, input.groupId),
        ),
      )
      .limit(1)
      .for("update");
    const allowed = row
      ? pinAllowed(sender, input.groupId, row.audience)
      : false;
    if (!row || !allowed) {
      return {
        ok: false,
        error: explainPinRefusal(row ?? null, {
          groupId: input.groupId,
          allowed,
          pinned: input.pinned,
        }),
      };
    }

    const claimed = await tx
      .update(schema.bulletins)
      .set(
        input.pinned
          ? {
              pinned: true,
              pinnedAt: now,
              pinnedByUserId: input.actorId,
              updatedAt: now,
            }
          : {
              pinned: false,
              pinnedAt: null,
              pinnedByUserId: null,
              updatedAt: now,
            },
      )
      .where(
        and(
          eq(schema.bulletins.id, input.id),
          eq(schema.bulletins.groupId, input.groupId),
          // A pin only exists on something people have received.
          isNotNull(schema.bulletins.dispatchedAt),
          input.pinned
            ? isNull(schema.bulletins.pinnedAt)
            : isNotNull(schema.bulletins.pinnedAt),
        ),
      )
      .returning({ id: schema.bulletins.id });
    if (!claimed[0]) {
      return {
        ok: false,
        error: explainPinRefusal(row, {
          groupId: input.groupId,
          allowed,
          pinned: input.pinned,
        }),
      };
    }
    await audit(
      tx,
      input.actorId,
      input.pinned ? "announcement.pin" : "announcement.unpin",
      input.id,
      { groupId: input.groupId },
    );
    return { ok: true };
  });
  return outcome;
}

// --- Scheduled dispatch -------------------------------------------------

export interface DispatchSummary {
  due: number;
  dispatched: number;
  skipped: number;
  deliveries: number;
  failures: { bulletinId: string; error: string }[];
}

/** The database's own words for a failure, never the query text (which would
 * carry announcement text and member ids into a log). */
function failureMessage(err: unknown): string {
  if (!(err instanceof Error)) return "unknown error";
  return err.cause instanceof Error ? err.cause.message : err.message;
}

/**
 * The scheduled-send worker behind `/api/announcements/dispatch`. Claims each
 * due camp announcement by stamping `dispatched_at` (compare-and-set on
 * `dispatched_at IS NULL`, so overlapping runs cannot both deliver), re-asks
 * the sender's permission under lock and the edition, then fans out — all in
 * one transaction per announcement. One that throws rolls back its own claim,
 * stays due, and does not stop the others.
 */
export async function dispatchDueCampAnnouncements(
  now: Date = new Date(),
): Promise<DispatchSummary> {
  const due = await db()
    .select({ id: schema.bulletins.id })
    .from(schema.bulletins)
    .where(
      and(
        isNotNull(schema.bulletins.groupId),
        isNotNull(schema.bulletins.publishedAt),
        isNull(schema.bulletins.dispatchedAt),
        isNotNull(schema.bulletins.sendAt),
        lte(schema.bulletins.sendAt, now),
      ),
    )
    .orderBy(asc(schema.bulletins.sendAt));

  const summary: DispatchSummary = {
    due: due.length,
    dispatched: 0,
    skipped: 0,
    deliveries: 0,
    failures: [],
  };
  if (due.length === 0) return summary;

  const [active] = await db()
    .select({ id: schema.editions.id })
    .from(schema.editions)
    .where(eq(schema.editions.isActive, true))
    .limit(1);

  for (const { id } of due) {
    try {
      let emailAfter: { row: FanOutRow; fan: FanOutResult } | null = null;
      const result = await withTransaction(async (tx) => {
        const [claimed] = await tx
          .update(schema.bulletins)
          .set({ dispatchedAt: now, updatedAt: now })
          .where(
            and(
              eq(schema.bulletins.id, id),
              isNotNull(schema.bulletins.groupId),
              isNotNull(schema.bulletins.publishedAt),
              isNull(schema.bulletins.dispatchedAt),
              lte(schema.bulletins.sendAt, now),
            ),
          )
          .returning({
            ...announcementColumns,
            groupId: schema.bulletins.groupId,
            editionId: schema.bulletins.editionId,
          });
        // Another run got there first — nothing to do, and nothing done.
        if (!claimed || !claimed.groupId) return "lost" as const;
        if (claimed.audience.kind !== "project") return "skipped" as const;

        const groupId = claimed.groupId;
        // A sanitized (or vanished) author is GONE, whatever membership rows
        // survive them: their scheduled send is skipped as author_gone, never
        // delivered in the name of an account that no longer speaks. Read
        // inside the claim's transaction, FOR SHARE, so a sanitization that
        // lands mid-dispatch waits rather than racing the fan-out.
        const [author] = claimed.createdByUserId
          ? await tx
              .select({ sanitizedAt: schema.users.sanitizedAt })
              .from(schema.users)
              .where(eq(schema.users.id, claimed.createdByUserId))
              .limit(1)
              .for("share")
          : [];
        const sender =
          claimed.createdByUserId && author && author.sanitizedAt === null
            ? await lockSenderContext(tx, groupId, claimed.createdByUserId)
            : null;
        const decision = decideDispatch({
          senderAllowed: sender
            ? sendAllowed(
                sender,
                groupId,
                claimed.audience,
                claimed.presentation,
              )
            : null,
          editionIsActive: active?.id === claimed.editionId,
        });
        if (!decision.deliver) {
          // Claimed and NOT delivered: stamped so it is never retried, and
          // the reason is on the record.
          await audit(
            tx,
            claimed.createdByUserId,
            "announcement.dispatch_skipped",
            id,
            {
              groupId,
              reason: decision.reason,
            },
          );
          return "skipped" as const;
        }
        const fanRow: FanOutRow = {
          id,
          groupId,
          title: claimed.title,
          audience: claimed.audience,
          presentation: claimed.presentation,
          createdByUserId: claimed.createdByUserId,
          pinOnPublish: claimed.pinOnPublish,
        };
        const fan = await fanOut(tx, fanRow, now);
        await audit(tx, claimed.createdByUserId, "announcement.dispatch", id, {
          groupId,
          recipients: fan.recipientIds.length,
        });
        emailAfter = { row: fanRow, fan };
        return fan.recipientIds.length;
      });
      if (result === "skipped") summary.skipped += 1;
      else if (typeof result === "number") {
        summary.dispatched += 1;
        summary.deliveries += result;
        const pending = emailAfter as {
          row: FanOutRow;
          fan: FanOutResult;
        } | null;
        if (pending) await emailMustAcknowledge(pending.row, pending.fan);
      }
    } catch (err) {
      summary.failures.push({ bulletinId: id, error: failureMessage(err) });
    }
  }
  return summary;
}
