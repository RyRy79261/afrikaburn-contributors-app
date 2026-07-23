"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { canTransitionSectionReview } from "@quagga/core";
import { SectionKey, SectionReviewStatus } from "@quagga/types";

import { getDb, schema } from "@/lib/db";
import { requireOrgSession } from "@/lib/session";
import { writeAuditEvent } from "@/lib/audit";
import { REVIEW_ACTIONS, resolveReviewAction } from "@/lib/org-logic";
import { runAction, type ActionResult } from "./result";

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
    const session = await requireOrgSession();
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
      .select({ status: schema.registrations.status })
      .from(schema.registrations)
      .where(eq(schema.registrations.id, input.registrationId))
      .limit(1);
    if (!registration) throw new Error("That registration no longer exists.");

    // Throws on an illegal transition for the current status.
    const nextStatus = resolveReviewAction(registration.status, input.action);
    const isDecision = nextStatus === "approved" || nextStatus === "rejected";

    await db
      .update(schema.registrations)
      .set({
        status: nextStatus,
        updatedAt: new Date(),
        ...(isDecision
          ? { decidedAt: new Date(), decidedByUserId: session.dbUserId }
          : {}),
      })
      .where(eq(schema.registrations.id, input.registrationId));

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: `registration.${input.action}`,
      subject: input.registrationId,
      meta: {
        from: registration.status,
        to: nextStatus,
        ...(reason ? { reason } : {}),
      },
    });

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
    const session = await requireOrgSession();
    const input = AddReviewInput.parse(raw);

    const db = getDb();
    await db.insert(schema.sectionReviews).values({
      registrationId: input.registrationId,
      sectionKey: input.sectionKey,
      status: "open",
      comment: input.comment,
      reviewerId: session.dbUserId,
    });

    await writeAuditEvent(db, {
      actorId: session.dbUserId,
      action: "review.comment",
      subject: input.registrationId,
      meta: { sectionKey: input.sectionKey },
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
    await requireOrgSession();
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
