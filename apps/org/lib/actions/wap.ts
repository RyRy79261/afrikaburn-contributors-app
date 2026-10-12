"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { z } from "zod";

import {
  decideWapApprove,
  decideWapDecline,
  decideWapGrant,
  decideWapReturn,
  WAP_AUDIT,
  WAP_PROJECT_KINDS,
  WAP_REQUESTABLE_REGISTRATION_STATUSES,
  wapApprovedPass,
  wapListApprovedNotification,
  wapListReturnedNotification,
  wapPassApprovedNotification,
  wapRefusalMessage,
  wapRequestDeclinedNotification,
  wapRequestGrantedNotification,
  wapRequestsOpenNotification,
  wapRequestWindowState,
  wapWindowPatch,
  type NotificationRow,
  type WapNoticeContext,
} from "@quagga/core";
import {
  PROJECT_ADMIN_ROLES,
  WapDeclineInput,
  WapGrantInput,
  WapListApproveInput,
  WapListReturnInput,
  WapWindowInput,
  type NotificationPayload,
} from "@quagga/types";
import { activeMembership } from "@quagga/db";

import {
  getDb,
  schema,
  withTransaction,
  type DbHandle,
  type OrgTx,
} from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { insertNotifications } from "@/lib/notifications";
import { readWapPasses, wapCurrentPasses } from "@/lib/wap";
import { runAction, type ActionResult } from "./result";

// Work Access Passes, the org's decisions (epic #53, docs/wap-spec.md, frames
// W2 and W3). Every action:
//
//   · names `update` on `registrations` (`requireOrgSession`) BEFORE it reads
//     anything — the same capability as deciding a registration;
//   · validates its input with the @quagga/types Zod schema;
//   · re-takes the decision with the pure @quagga/core rule INSIDE a
//     transaction that holds the registration row `FOR UPDATE` (the lead's
//     writes in apps/web take the same lock, so a grant cannot race an
//     allocation and an approval cannot race an edit);
//   · writes its audit row in that same transaction;
//   · notifies AFTER commit, best-effort — a failed notification never rolls
//     a decision back (the registration decision's pattern).
//
// Notifications are kind `wap`, in-app only, minted by the core builders, and
// link to the participant app (`linkApp: "web"`).

function parse<S extends z.ZodTypeAny>(schemaIn: S, raw: unknown): z.output<S> {
  const parsed = schemaIn.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Check the form.");
  }
  return parsed.data;
}

function refuse(reason: Parameters<typeof wapRefusalMessage>[0]): never {
  throw new Error(wapRefusalMessage(reason));
}

const GONE = "That registration no longer exists.";

interface LockedRegistration {
  id: string;
  editionId: string;
  listStatus: (typeof schema.registrations.$inferSelect)["wapListStatus"];
  groupId: string;
}

/** The registration row `FOR UPDATE`, plus the project facts notices need. */
async function lockRegistration(
  tx: OrgTx,
  registrationId: string,
): Promise<LockedRegistration & { notice: WapNoticeContext }> {
  const [row] = await tx
    .select({
      id: schema.registrations.id,
      editionId: schema.registrations.editionId,
      listStatus: schema.registrations.wapListStatus,
      groupId: schema.registrations.groupId,
    })
    .from(schema.registrations)
    .where(eq(schema.registrations.id, registrationId))
    .limit(1)
    .for("update");
  if (!row) throw new Error(GONE);
  const [group] = await tx
    .select({
      name: schema.groups.name,
      kind: schema.groups.kind,
      slug: schema.groups.slug,
    })
    .from(schema.groups)
    .where(eq(schema.groups.id, row.groupId))
    .limit(1);
  if (!group) throw new Error(GONE);
  return {
    ...row,
    notice: {
      projectName: group.name,
      projectKind: group.kind,
      projectSlug: group.slug,
    },
  };
}

/** The current leads and co-leads of these projects (live accounts only). */
async function leadsOf(
  handle: DbHandle,
  groupIds: readonly string[],
): Promise<{ userId: string; groupId: string }[]> {
  if (groupIds.length === 0) return [];
  return handle
    .select({
      userId: schema.memberships.userId,
      groupId: schema.memberships.groupId,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        inArray(schema.memberships.groupId, [...groupIds]),
        inArray(schema.memberships.role, [...PROJECT_ADMIN_ROLES]),
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    );
}

/** Sent by the org, read by participants — every WAP link is a web route. */
function rowsFor(
  userIds: readonly string[],
  payload: NotificationPayload,
): NotificationRow[] {
  return [...new Set(userIds)].map((userId) => ({
    ...payload,
    userId,
    origin: "org" as const,
    linkApp: "web" as const,
  }));
}

/** Notify a project's leads and co-leads, after commit, best-effort. */
async function notifyLeads(
  groupId: string,
  payload: NotificationPayload,
  extra: NotificationRow[] = [],
): Promise<void> {
  try {
    const db = getDb();
    const leads = await leadsOf(db, [groupId]);
    await insertNotifications(db, [
      ...rowsFor(
        leads.map((l) => l.userId),
        payload,
      ),
      ...extra,
    ]);
  } catch (err) {
    console.error("[notifications] work access pass hook failed", err);
  }
}

function revalidate(registrationId?: string): void {
  if (registrationId) revalidatePath(`/registrations/${registrationId}/passes`);
  revalidatePath("/registrations/passes");
}

// --- The request window ------------------------------------------------------

/**
 * Open or close WAP requests for an edition (W3's edition bar). Opening
 * notifies every lead and co-lead of a project with a submitted registration
 * in that edition. Opening an open window, or closing one that is not open,
 * is refused — so a double click cannot notify everyone twice.
 */
export async function setWapRequestWindow(
  raw: WapWindowInput,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({
      capability: "update",
      domain: "registrations",
    });
    const input = parse(WapWindowInput, raw);
    const now = new Date();

    const edition = await withTransaction(async (tx) => {
      const [row] = await tx
        .select({
          id: schema.editions.id,
          name: schema.editions.name,
          wapRequestsOpenAt: schema.editions.wapRequestsOpenAt,
          wapRequestsCloseAt: schema.editions.wapRequestsCloseAt,
        })
        .from(schema.editions)
        .where(eq(schema.editions.id, input.editionId))
        .limit(1)
        .for("update");
      if (!row) throw new Error("That edition no longer exists.");

      const state = wapRequestWindowState(row, now);
      if (input.action === "open" && state === "open") {
        throw new Error("Work Access Pass requests are already open.");
      }
      if (input.action === "close" && state !== "open") {
        throw new Error("Work Access Pass requests aren't open.");
      }

      await tx
        .update(schema.editions)
        .set(wapWindowPatch(input.action, now))
        .where(eq(schema.editions.id, input.editionId));
      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action:
          input.action === "open"
            ? WAP_AUDIT.windowOpen
            : WAP_AUDIT.windowClose,
        subject: input.editionId,
        meta: { from: state },
      });
      return row;
    });

    if (input.action === "open") {
      await notifyRequestsOpen(edition.id, edition.name);
    }
    revalidate();
  });
}

/** Every lead and co-lead of a project whose registration has been submitted
 * (and is still alive) in this edition. Best-effort, after commit. */
async function notifyRequestsOpen(
  editionId: string,
  editionName: string,
): Promise<void> {
  try {
    const db = getDb();
    const projects = await db
      .select({
        groupId: schema.groups.id,
        name: schema.groups.name,
        kind: schema.groups.kind,
        slug: schema.groups.slug,
      })
      .from(schema.registrations)
      .innerJoin(
        schema.groups,
        eq(schema.groups.id, schema.registrations.groupId),
      )
      .where(
        and(
          eq(schema.registrations.editionId, editionId),
          inArray(schema.registrations.status, [
            ...WAP_REQUESTABLE_REGISTRATION_STATUSES,
          ]),
          inArray(schema.groups.kind, [...WAP_PROJECT_KINDS]),
        ),
      );
    const leads = await leadsOf(
      db,
      projects.map((p) => p.groupId),
    );
    const rows: NotificationRow[] = [];
    for (const p of projects) {
      const payload = wapRequestsOpenNotification(
        { projectName: p.name, projectKind: p.kind, projectSlug: p.slug },
        editionName,
      );
      rows.push(
        ...rowsFor(
          leads.filter((l) => l.groupId === p.groupId).map((l) => l.userId),
          payload,
        ),
      );
    }
    await insertNotifications(db, rows);
  } catch (err) {
    console.error("[notifications] work access pass open hook failed", err);
  }
}

// --- Requests ------------------------------------------------------------------

/** The request row, read inside the transaction once its registration is locked. */
async function lockedRequest(tx: OrgTx, requestId: string) {
  const [first] = await tx
    .select({ registrationId: schema.wapRequests.registrationId })
    .from(schema.wapRequests)
    .where(eq(schema.wapRequests.id, requestId))
    .limit(1);
  if (!first) throw new Error("That request no longer exists.");
  // Lock order: the registration, then the request — the same order as the
  // lead's request write, so the two cannot deadlock.
  const registration = await lockRegistration(tx, first.registrationId);
  const [request] = await tx
    .select({
      id: schema.wapRequests.id,
      registrationId: schema.wapRequests.registrationId,
      requested: schema.wapRequests.requested,
      status: schema.wapRequests.status,
    })
    .from(schema.wapRequests)
    .where(eq(schema.wapRequests.id, requestId))
    .limit(1)
    .for("update");
  if (!request || request.registrationId !== registration.id) {
    throw new Error("That request no longer exists.");
  }
  return { registration, request };
}

/** Grant a pending request: between 1 and the number asked. */
export async function grantWapRequest(
  raw: WapGrantInput,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({
      capability: "update",
      domain: "registrations",
    });
    const input = parse(WapGrantInput, raw);

    const done = await withTransaction(async (tx) => {
      const { registration, request } = await lockedRequest(
        tx,
        input.requestId,
      );
      const decision = decideWapGrant(request, input.granted);
      if (!decision.ok) refuse(decision.reason);

      const updated = await tx
        .update(schema.wapRequests)
        .set({
          status: "granted",
          granted: input.granted,
          decidedByUserId: session.dbUserId,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(schema.wapRequests.id, request.id),
            eq(schema.wapRequests.status, "pending"),
          ),
        )
        .returning({ id: schema.wapRequests.id });
      if (updated.length === 0) refuse("not_pending");

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: WAP_AUDIT.grant,
        subject: registration.id,
        meta: {
          requestId: request.id,
          requested: request.requested,
          granted: input.granted,
        },
      });
      return { registration, requested: request.requested };
    });

    await notifyLeads(
      done.registration.groupId,
      wapRequestGrantedNotification(
        done.registration.notice,
        input.granted,
        done.requested,
      ),
    );
    revalidate(done.registration.id);
  });
}

/** Decline a pending request. */
export async function declineWapRequest(
  raw: WapDeclineInput,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({
      capability: "update",
      domain: "registrations",
    });
    const input = parse(WapDeclineInput, raw);

    const done = await withTransaction(async (tx) => {
      const { registration, request } = await lockedRequest(
        tx,
        input.requestId,
      );
      const decision = decideWapDecline(request);
      if (!decision.ok) refuse(decision.reason);

      const updated = await tx
        .update(schema.wapRequests)
        .set({
          status: "declined",
          decidedByUserId: session.dbUserId,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(schema.wapRequests.id, request.id),
            eq(schema.wapRequests.status, "pending"),
          ),
        )
        .returning({ id: schema.wapRequests.id });
      if (updated.length === 0) refuse("not_pending");

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: WAP_AUDIT.decline,
        subject: registration.id,
        meta: { requestId: request.id, requested: request.requested },
      });
      return { registration, requested: request.requested };
    });

    await notifyLeads(
      done.registration.groupId,
      wapRequestDeclinedNotification(done.registration.notice, done.requested),
    );
    revalidate(done.registration.id);
  });
}

// --- The list --------------------------------------------------------------------

/**
 * Approve the whole list. Stores the approval snapshot — the passes' effective
 * values right now, ids only — which is what "Changed since approval" and
 * "N removed since approval" are measured against. Notifies the leads and
 * every pass holder.
 */
export async function approveWapList(
  raw: WapListApproveInput,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({
      capability: "update",
      domain: "registrations",
    });
    const input = parse(WapListApproveInput, raw);

    const done = await withTransaction(async (tx) => {
      const registration = await lockRegistration(tx, input.registrationId);
      const decision = decideWapApprove(registration.listStatus);
      if (!decision.ok) refuse(decision.reason);

      // Read under the registration lock: the lead's edits take the same lock
      // and are refused while the list is submitted, so this is the list the
      // reviewer is approving.
      const passes = await readWapPasses(tx, registration.editionId, {
        registrationId: registration.id,
        flags: false,
      });
      const snapshot = wapCurrentPasses(passes).map(wapApprovedPass);
      const now = new Date();

      const updated = await tx
        .update(schema.registrations)
        .set({
          wapListStatus: "approved",
          wapListReviewedAt: now,
          wapListReviewedByUserId: session.dbUserId,
          wapListApprovedAt: now,
          wapListApprovedSnapshot: snapshot,
          wapListReturnNote: null,
        })
        .where(
          and(
            eq(schema.registrations.id, registration.id),
            eq(schema.registrations.wapListStatus, "submitted"),
          ),
        )
        .returning({ id: schema.registrations.id });
      if (updated.length === 0) refuse("not_submitted_list");

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: WAP_AUDIT.approve,
        subject: registration.id,
        meta: { passes: snapshot.length },
      });
      return { registration, holderIds: passes.map((p) => p.userId) };
    });

    await notifyLeads(
      done.registration.groupId,
      wapListApprovedNotification(done.registration.notice),
      rowsFor(
        done.holderIds,
        wapPassApprovedNotification(done.registration.notice),
      ),
    );
    revalidate(done.registration.id);
  });
}

/** Return the list with a note the project's leads read. The note is required. */
export async function returnWapList(
  raw: WapListReturnInput,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({
      capability: "update",
      domain: "registrations",
    });
    const input = parse(WapListReturnInput, raw);

    const done = await withTransaction(async (tx) => {
      const registration = await lockRegistration(tx, input.registrationId);
      const decision = decideWapReturn(registration.listStatus, input.note);
      if (!decision.ok) refuse(decision.reason);

      const updated = await tx
        .update(schema.registrations)
        .set({
          wapListStatus: "returned",
          wapListReviewedAt: new Date(),
          wapListReviewedByUserId: session.dbUserId,
          wapListReturnNote: input.note,
        })
        .where(
          and(
            eq(schema.registrations.id, registration.id),
            eq(schema.registrations.wapListStatus, "submitted"),
          ),
        )
        .returning({ id: schema.registrations.id });
      if (updated.length === 0) refuse("not_submitted_list");

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: WAP_AUDIT.return,
        subject: registration.id,
        meta: { note: input.note },
      });
      return { registration };
    });

    await notifyLeads(
      done.registration.groupId,
      wapListReturnedNotification(done.registration.notice, input.note),
    );
    revalidate(done.registration.id);
  });
}
