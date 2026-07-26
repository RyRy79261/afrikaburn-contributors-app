"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { canReplyToSectionReview } from "@quagga/core";
import {
  OperatingHours,
  PROJECT_ADMIN_ROLES,
  type MembershipRole,
} from "@quagga/types";
import { requireCampUser, getOrgGroup } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import { db, schema } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import {
  applyCampAction,
  getRegistration,
  saveRegistrationDraft,
  type RegistrationValues,
  type SaveDraftResult,
  type TransitionResult,
} from "@/lib/registration-store";

// Server actions for the six-section registration wizard (build-spec §apps/web
// `/camps/[slug]/registration`). Every write is gated on a lead/admin
// membership; Zod validates the value payload at the boundary. Transitions run
// through @quagga/core's state machine + submit gate via the store.

/** Nullable trimmed string that treats "" as null (empty ⇒ not answered). */
const nullableText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => {
      const t = s.trim();
      return t.length === 0 ? null : t;
    })
    .nullish()
    .transform((v) => v ?? null);

const nullableInt = (max: number) =>
  z
    .number()
    .int()
    .min(0)
    .max(max)
    .nullish()
    .transform((v) => v ?? null);

const RegistrationValuesSchema = z.object({
  campDescription: nullableText(4000),
  s1ContactEmail: nullableText(200),
  s1AltContactName: nullableText(200),
  s1AltContactPhone: nullableText(60),
  s1AltContactEmail: nullableText(200),
  s2LntPlan: nullableText(8000),
  s2LntLeadName: nullableText(200),
  s2LntLeadPhone: nullableText(60),
  s2LntLeadEmail: nullableText(200),
  s3ParticipationPlan: nullableText(8000),
  s3OperatingHours: z.array(OperatingHours).max(4).default([]),
  s3ScheduleDetail: nullableText(8000),
  s3GiftingFood: z.boolean().nullish().transform((v) => v ?? null),
  s4ExpectedPopulation: nullableInt(1_000_000),
  s4FirstArrivalDate: nullableText(40),
  s4WorkAccessPasses: nullableInt(100_000),
  s4AreaDimensions: nullableText(200),
  s4LayoutUploadUrls: z.array(z.string().url().max(2000)).max(4).default([]),
  s5AmplifiedMusic: nullableText(200),
  s5SoundPlan: nullableText(8000),
  s5PlacementFirstChoice: nullableText(200),
  s5PlacementSecondChoice: nullableText(200),
  s5NeighbourRequest: nullableText(500),
  s5FamilyFriendly: nullableText(500),
  s6SuppliersNote: nullableText(4000),
  s6PaidPerformers: z.boolean().nullish().transform((v) => v ?? null),
  s6FeeStructure: nullableText(8000),
  s6ExpectedBudgetZar: nullableInt(1_000_000_000),
  s6PlugAndPlayAck: z.boolean().nullish().transform((v) => v ?? null),
  supplierIds: z.array(z.string().uuid()).max(100).default([]),
});

async function requireCampAdmin(slug: string): Promise<
  | {
      ok: true;
      userId: string;
      group: { id: string; name: string };
      editionId: string;
      editionYear: number;
    }
  | { ok: false; error: string }
> {
  const user = await requireCampUser();
  const edition = await getActiveEdition();
  if (!edition) return { ok: false, error: "No active edition is configured." };

  const [group] = await db()
    .select({ id: schema.groups.id, name: schema.groups.name })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  if (!group) return { ok: false, error: "Camp not found." };

  const [membership] = await db()
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, user.id),
        eq(schema.memberships.groupId, group.id),
      ),
    )
    .limit(1);
  if (!membership || !PROJECT_ADMIN_ROLES.includes(membership.role)) {
    return { ok: false, error: "Only a camp lead can edit the registration." };
  }

  return {
    ok: true,
    userId: user.id,
    group,
    editionId: edition.id,
    editionYear: edition.year,
  };
}

/** Autosave the wizard's current values to the draft. */
export async function saveRegistrationDraftAction(
  slug: string,
  rawValues: unknown,
): Promise<SaveDraftResult> {
  const gate = await requireCampAdmin(slug);
  if (!gate.ok) return { ok: false, error: gate.error };

  const parsed = RegistrationValuesSchema.safeParse(rawValues);
  if (!parsed.success) {
    return { ok: false, error: "Some answers weren't in the expected format." };
  }

  const result = await saveRegistrationDraft({
    group: gate.group,
    editionId: gate.editionId,
    values: parsed.data as RegistrationValues,
  });

  if (result.ok) revalidatePath(`/camps/${slug}/registration`);
  return result;
}

/** Submit (or resubmit) the registration: gate check → status → email. */
export async function submitRegistrationAction(
  slug: string,
): Promise<TransitionResult> {
  const gate = await requireCampAdmin(slug);
  if (!gate.ok) return { ok: false, error: gate.error };

  const current = await getRegistration(gate.group.id, gate.editionId);
  if (!current) return { ok: false, error: "Nothing to submit yet." };

  const action = current.status === "changes_requested" ? "resubmit" : "submit";
  const result = await applyCampAction({
    groupId: gate.group.id,
    editionId: gate.editionId,
    action,
  });
  if (!result.ok) return result;

  await notifySubmitted({
    campName: gate.group.name,
    contactEmail: current.s1ContactEmail,
    editionYear: gate.editionYear,
    resubmit: action === "resubmit",
  });

  revalidatePath(`/camps/${slug}/registration`);
  revalidatePath(`/camps/${slug}`);
  return result;
}

/** Withdraw the registration (voluntary). */
export async function withdrawRegistrationAction(
  slug: string,
): Promise<TransitionResult> {
  const gate = await requireCampAdmin(slug);
  if (!gate.ok) return { ok: false, error: gate.error };

  const result = await applyCampAction({
    groupId: gate.group.id,
    editionId: gate.editionId,
    action: "withdraw",
  });

  if (result.ok) {
    revalidatePath(`/camps/${slug}/registration`);
    revalidatePath(`/camps/${slug}`);
  }
  return result;
}

const ReplyToReviewInput = z.object({
  reviewId: z.string().uuid(),
  body: z.string().trim().min(1, "Write a reply.").max(2000),
});

export type ReplyResult = { ok: true } | { ok: false; error: string };

/**
 * Post a camp-side (or org-side) reply under a section review (design frames: a
 * camp answering the placement team). `section_reviews` is org-authored only, so
 * replies live in `section_review_replies`.
 *
 * AUTHZ (server-side, the boundary — never the UI): the target group is resolved
 * from the review itself (review → registration → group), then the caller's camp
 * role and org-staff status are established and handed to @quagga/core
 * `canReplyToSectionReview`. Only a MEMBER of the camp under review may reply, and
 * org staff (god / org_staff) may reply too. `slug` is used only to revalidate the
 * page — it is never trusted for authz.
 *
 * The reply UI itself is built by a later agent; this is the write path it calls.
 */
export async function replyToSectionReviewAction(
  slug: string,
  raw: z.input<typeof ReplyToReviewInput>,
): Promise<ReplyResult> {
  const parsed = ReplyToReviewInput.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Invalid reply.";
    return { ok: false, error: first };
  }

  const user = await requireCampUser();

  // Resolve the group under review from the review row — the source of truth for
  // authz, so a caller cannot smuggle in an unrelated slug.
  const [target] = await db()
    .select({ groupId: schema.registrations.groupId })
    .from(schema.sectionReviews)
    .innerJoin(
      schema.registrations,
      eq(schema.sectionReviews.registrationId, schema.registrations.id),
    )
    .where(eq(schema.sectionReviews.id, parsed.data.reviewId))
    .limit(1);
  if (!target) return { ok: false, error: "That review no longer exists." };

  // The caller's membership role on the camp under review (any role may reply).
  const [membership] = await db()
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, user.id),
        eq(schema.memberships.groupId, target.groupId),
      ),
    )
    .limit(1);
  const campRole: MembershipRole | null = membership?.role ?? null;

  // Org staff (god / org_staff on the org group) may reply too.
  let isOrgStaff = false;
  const org = await getOrgGroup();
  if (org) {
    const [orgMembership] = await db()
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, user.id),
          eq(schema.memberships.groupId, org.id),
          inArray(schema.memberships.role, ["god", "org_staff"]),
        ),
      )
      .limit(1);
    isOrgStaff = Boolean(orgMembership);
  }

  if (!canReplyToSectionReview({ campRole, isOrgStaff })) {
    return {
      ok: false,
      error: "Only members of this camp (or AfrikaBurn staff) can reply.",
    };
  }

  await db().insert(schema.sectionReviewReplies).values({
    reviewId: parsed.data.reviewId,
    authorUserId: user.id,
    body: parsed.data.body,
  });

  revalidatePath(`/camps/${slug}/registration`);
  return { ok: true };
}

/** Fire the submission notification (Resend when configured; console otherwise). */
async function notifySubmitted(input: {
  campName: string;
  contactEmail: string | null;
  editionYear: number;
  resubmit: boolean;
}): Promise<void> {
  if (!input.contactEmail) return;
  const verb = input.resubmit ? "resubmitted" : "submitted";
  await sendEmail({
    to: input.contactEmail,
    subject: `${input.campName} — registration ${verb} for AfrikaBurn ${input.editionYear}`,
    text:
      `Thanks — we've ${verb} ${input.campName}'s theme camp registration for ` +
      `AfrikaBurn ${input.editionYear}.\n\n` +
      `AfrikaBurn's team will review it section by section. You'll get an email ` +
      `if they request changes, and you can track the status any time from your ` +
      `camp dashboard.\n\n` +
      `No further action is needed right now.\n\n— The AfrikaBurn Contributors app`,
  });
}
