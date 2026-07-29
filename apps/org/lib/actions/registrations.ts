"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import {
  canTransitionSectionReview,
  registrationDecisionNotification,
  shouldSendImmediateEmail,
  type RegistrationDecision,
} from "@quagga/core";
import { SectionKey, SectionReviewStatus } from "@quagga/types";

import { getDb, schema, withTransaction } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { insertNotifications } from "@/lib/notifications";
import { sendEmail } from "@/lib/email";
import { REVIEW_ACTIONS, resolveReviewAction } from "@/lib/org-logic";
import { runAction, type ActionResult } from "./result";

// Decision statuses that notify the camp's leads/admins (+ immediate email).
const DECISION_STATUSES = new Set<RegistrationDecision>([
  "approved",
  "changes_requested",
  "rejected",
]);

/**
 * Notify a camp's leads/admins of a registration decision (thin event hook —
 * no behaviour change to the decision itself). Builds the payload with the
 * @quagga/core builder (never leaks private fields) and best-effort inserts +
 * emails; a notification failure never rolls back the committed decision.
 */
async function notifyRegistrationDecision(
  db: ReturnType<typeof getDb>,
  registrationId: string,
  groupId: string,
  decision: RegistrationDecision,
  reason: string | null,
): Promise<void> {
  try {
    const [group] = await db
      .select({ name: schema.groups.name, slug: schema.groups.slug })
      .from(schema.groups)
      .where(eq(schema.groups.id, groupId))
      .limit(1);
    if (!group) return;

    const leads = await db
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.groupId, groupId),
          inArray(schema.memberships.role, ["lead", "admin"]),
        ),
      );
    const userIds = [...new Set(leads.map((l) => l.userId))];
    if (userIds.length === 0) return;

    const payload = registrationDecisionNotification({
      campName: group.name,
      decision,
      campSlug: group.slug,
      // The reviewer's own words, delivered to the camp. Writing it only to
      // `audit_events` meant nobody outside the console ever saw it.
      reason,
    });
    await insertNotifications(
      db,
      // Sent by the org, read by participants — /camps/<slug> is a web route.
      userIds.map((userId) => ({
        ...payload,
        userId,
        origin: "org" as const,
        linkApp: "web" as const,
      })),
    );

    // Immediate email for registration decisions (env-less no-op otherwise).
    if (shouldSendImmediateEmail("registration")) {
      const recipients = await db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(inArray(schema.users.id, userIds));
      const to = recipients
        .map((r) => r.email)
        .filter((e): e is string => Boolean(e));
      if (to.length > 0) {
        await sendEmail({
          to,
          subject: payload.title,
          text: `${payload.title}${payload.body ? `\n\n${payload.body}` : ""}\n\nOpen the Contributors app to see details.`,
        });
      }
    }
  } catch (err) {
    console.error("[notifications] registration decision hook failed", err);
  }
}

const DecideInput = z.object({
  registrationId: z.string().uuid(),
  action: z.enum(REVIEW_ACTIONS),
  reason: z.string().trim().max(2000).optional(),
});

/**
 * Apply a reviewer decision to a registration. The target status is validated
 * against the core state machine (illegal transitions throw). Approve/reject
 * stamp the decision; request-changes/reject require a reason. Approving is the
 * entitlement flip (an `approved` row makes the camp "registered"). Audited.
 */
export async function decideRegistration(
  raw: z.input<typeof DecideInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({
      capability: "update",
      domain: "registrations",
    });
    const input = DecideInput.parse(raw);

    const reason = input.reason?.trim() ?? "";
    if (
      (input.action === "request_changes" || input.action === "reject") &&
      reason.length === 0
    ) {
      throw new Error(
        input.action === "reject"
          ? "A rejection needs a reason for the camp."
          : "Tell the camp what to change — a reason is required.",
      );
    }

    const db = getDb();
    const [registration] = await db
      .select({
        status: schema.registrations.status,
        groupId: schema.registrations.groupId,
      })
      .from(schema.registrations)
      .where(eq(schema.registrations.id, input.registrationId))
      .limit(1);
    if (!registration) throw new Error("That registration no longer exists.");

    // Throws on an illegal transition for the current status.
    const nextStatus = resolveReviewAction(registration.status, input.action);
    const isDecision = nextStatus === "approved" || nextStatus === "rejected";

    // The status flip and its audit row are one atomic unit: a committed
    // decision must never exist without its audit trail, and vice versa.
    await withTransaction(async (tx) => {
      // TOCTOU guard: the status we validated the transition against must still
      // be the row's status when we write. Guarding the UPDATE's WHERE on that
      // exact status means a concurrent decision (another reviewer, a resubmit)
      // makes this update a no-op, and — because a no-op throws here and rolls
      // the transaction back — we never stamp a stale audit event.
      const updated = await tx
        .update(schema.registrations)
        .set({
          status: nextStatus,
          updatedAt: new Date(),
          // ON THE ROW THE CAMP READS, not only in the audit meta. `reason` is
          // mandatory for reject and request_changes, and it used to land in
          // `audit_events` and the notification alone — so a camp opening its
          // registration saw "See the reviewer's notes below" above an empty
          // thread (migration 0025).
          //
          // Written for every reason-bearing action, cleared when a later
          // transition carries none: an approval must not leave last round's
          // "your fire plan is missing" sitting under a green banner.
          decisionReason: reason ? reason : null,
          ...(isDecision
            ? { decidedAt: new Date(), decidedByUserId: session.dbUserId }
            : {}),
        })
        .where(
          and(
            eq(schema.registrations.id, input.registrationId),
            eq(schema.registrations.status, registration.status),
          ),
        )
        .returning({ id: schema.registrations.id });
      if (updated.length === 0) {
        throw new Error(
          "This registration changed since you opened it — reload and try again.",
        );
      }

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: `registration.${input.action}`,
        subject: input.registrationId,
        meta: {
          from: registration.status,
          to: nextStatus,
          ...(reason ? { reason } : {}),
        },
      });
    });

    // Event hook: notify the camp's leads/admins of the decision (thin — best-
    // effort, never alters the committed decision; runs AFTER commit so a
    // notification failure cannot roll the decision back).
    if (DECISION_STATUSES.has(nextStatus as RegistrationDecision)) {
      await notifyRegistrationDecision(
        db,
        input.registrationId,
        registration.groupId,
        nextStatus as RegistrationDecision,
        reason ?? null,
      );
    }

    revalidatePath(`/registrations/${input.registrationId}`);
    revalidatePath("/registrations");
    revalidatePath("/");
  });
}

const AddReviewInput = z.object({
  registrationId: z.string().uuid(),
  sectionKey: SectionKey,
  comment: z.string().trim().min(1, "Add a comment.").max(2000),
});

/** Open a per-section review comment thread on a registration. Audited. */
export async function addSectionReview(
  raw: z.input<typeof AddReviewInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireOrgSession({
      capability: "create",
      domain: "registrations",
    });
    const input = AddReviewInput.parse(raw);

    // Insert + audit are one atomic unit.
    await withTransaction(async (tx) => {
      await tx.insert(schema.sectionReviews).values({
        registrationId: input.registrationId,
        sectionKey: input.sectionKey,
        status: "open",
        comment: input.comment,
        reviewerId: session.dbUserId,
      });

      await writeAuditEvent(tx, {
        actorId: session.dbUserId,
        action: "review.comment",
        subject: input.registrationId,
        meta: { sectionKey: input.sectionKey },
      });
    });

    revalidatePath(`/registrations/${input.registrationId}`);
  });
}

const SetReviewStatusInput = z.object({
  reviewId: z.string().uuid(),
  registrationId: z.string().uuid(),
  status: SectionReviewStatus,
});

/** Resolve or re-open a section review thread. Transition validated. */
export async function setSectionReviewStatus(
  raw: z.input<typeof SetReviewStatusInput>,
): Promise<ActionResult> {
  return runAction(async () => {
    await requireOrgSession({
      capability: "update",
      domain: "registrations",
    });
    const input = SetReviewStatusInput.parse(raw);

    const db = getDb();
    const [review] = await db
      .select({ status: schema.sectionReviews.status })
      .from(schema.sectionReviews)
      .where(eq(schema.sectionReviews.id, input.reviewId))
      .limit(1);
    if (!review) throw new Error("That comment no longer exists.");

    if (
      review.status !== input.status &&
      !canTransitionSectionReview(review.status, input.status)
    ) {
      throw new Error(
        `Cannot move a review from ${review.status} to ${input.status}.`,
      );
    }

    await db
      .update(schema.sectionReviews)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(schema.sectionReviews.id, input.reviewId));

    revalidatePath(`/registrations/${input.registrationId}`);
  });
}
