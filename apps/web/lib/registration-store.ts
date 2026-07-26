import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import {
  completedSectionsFor,
  deriveOnboardingProgress,
  filterPickerEligible,
  isSubmittable,
  resolveCampAction,
  type CampAction,
  type RegistrationSectionData,
} from "@quagga/core";
import type {
  MembershipRole,
  RegistrationStatus,
  SectionReviewStatus,
  SupplierStanding,
} from "@quagga/types";
import { db, schema, withTransaction, type Tx } from "./db";

// Camp-side data access + mutations for the registration wizard. Server-only;
// the state machine + completeness predicates live in @quagga/core so this
// layer only persists and reads. Statuses that permit editing are `draft` and
// `changes_requested` (the resubmit loop); everything else is read-only.

/** The registration statuses in which the wizard is editable. */
export const EDITABLE_STATUSES: readonly RegistrationStatus[] = [
  "draft",
  "changes_requested",
];

export function isEditableStatus(status: RegistrationStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

export interface RegistrationCampContext {
  group: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
  };
  editionId: string;
  editionYear: number;
  editionName: string;
  role: MembershipRole | null;
}

/** Load the camp + active-edition context the wizard needs, from the viewer's
 * perspective. Null when the camp doesn't exist. */
export async function getRegistrationCampContext(
  slug: string,
  viewerId: string | null,
  edition: { id: string; year: number; name: string },
): Promise<RegistrationCampContext | null> {
  const [group] = await db()
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      slug: schema.groups.slug,
      description: schema.groups.description,
      kind: schema.groups.kind,
    })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  if (!group || group.kind === "org") return null;

  let role: MembershipRole | null = null;
  if (viewerId) {
    const [membership] = await db()
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, viewerId),
          eq(schema.memberships.groupId, group.id),
        ),
      )
      .limit(1);
    role = membership?.role ?? null;
  }

  return {
    group: {
      id: group.id,
      name: group.name,
      slug: group.slug,
      description: group.description,
    },
    editionId: edition.id,
    editionYear: edition.year,
    editionName: edition.name,
    role,
  };
}

export type RegistrationRow = typeof schema.registrations.$inferSelect;

/** The registration row for this camp × edition, or null if not started. */
export async function getRegistration(
  groupId: string,
  editionId: string,
): Promise<RegistrationRow | null> {
  const [row] = await db()
    .select()
    .from(schema.registrations)
    .where(
      and(
        eq(schema.registrations.groupId, groupId),
        eq(schema.registrations.editionId, editionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** One camp-or-org reply threaded under a section review (design frame P0Tcl). */
export interface CampReviewReply {
  id: string;
  authorUserId: string | null;
  /** Display label for the author: their Burner Bio display name, "AfrikaBurn"
   * for org staff (the review team speaks as one), or "A camp member" fallback. */
  authorName: string;
  /** True when the author is org staff (god / org_staff) — renders as AfrikaBurn. */
  isOrg: boolean;
  body: string;
  createdAt: Date;
}

export interface CampSectionReview {
  id: string;
  sectionKey: string;
  status: SectionReviewStatus;
  comment: string;
  createdAt: Date;
  /** The camp/AB reply conversation under this review, oldest first. */
  replies: CampReviewReply[];
}

/**
 * The camp-visible section-review threads (AB feedback + the two-way reply
 * conversation) for a registration. Replies live in `section_review_replies`
 * (org-authored `section_reviews` carry only the AB comment). Author labels are
 * resolved for the registration's edition so a reply reads with a name, and org
 * staff authors collapse to "AfrikaBurn" to match how review comments present.
 */
export async function getSectionReviews(
  registrationId: string,
  editionId: string,
): Promise<CampSectionReview[]> {
  const reviews = await db()
    .select({
      id: schema.sectionReviews.id,
      sectionKey: schema.sectionReviews.sectionKey,
      status: schema.sectionReviews.status,
      comment: schema.sectionReviews.comment,
      createdAt: schema.sectionReviews.createdAt,
    })
    .from(schema.sectionReviews)
    .where(eq(schema.sectionReviews.registrationId, registrationId))
    .orderBy(asc(schema.sectionReviews.createdAt));
  if (reviews.length === 0) return [];

  const reviewIds = reviews.map((r) => r.id);
  const replyRows = await db()
    .select({
      id: schema.sectionReviewReplies.id,
      reviewId: schema.sectionReviewReplies.reviewId,
      authorUserId: schema.sectionReviewReplies.authorUserId,
      body: schema.sectionReviewReplies.body,
      createdAt: schema.sectionReviewReplies.createdAt,
    })
    .from(schema.sectionReviewReplies)
    .where(inArray(schema.sectionReviewReplies.reviewId, reviewIds))
    .orderBy(asc(schema.sectionReviewReplies.createdAt));

  const authorIds = [
    ...new Set(replyRows.map((r) => r.authorUserId).filter((id): id is string => Boolean(id))),
  ];
  const { names, orgStaff } = await resolveReplyAuthors(authorIds, editionId);

  const repliesByReview = new Map<string, CampReviewReply[]>();
  for (const r of replyRows) {
    const isOrg = r.authorUserId ? orgStaff.has(r.authorUserId) : false;
    const authorName = isOrg
      ? "AfrikaBurn"
      : (r.authorUserId ? names.get(r.authorUserId) : null) ?? "A camp member";
    const list = repliesByReview.get(r.reviewId) ?? [];
    list.push({
      id: r.id,
      authorUserId: r.authorUserId,
      authorName,
      isOrg,
      body: r.body,
      createdAt: r.createdAt,
    });
    repliesByReview.set(r.reviewId, list);
  }

  return reviews.map((r) => ({
    ...r,
    replies: repliesByReview.get(r.id) ?? [],
  }));
}

/** Resolve reply-author display names (for the edition) + which are org staff. */
async function resolveReplyAuthors(
  authorIds: string[],
  editionId: string,
): Promise<{ names: Map<string, string>; orgStaff: Set<string> }> {
  const names = new Map<string, string>();
  const orgStaff = new Set<string>();
  if (authorIds.length === 0) return { names, orgStaff };

  const bios = await db()
    .select({
      userId: schema.burnerBios.userId,
      displayName: schema.burnerBios.displayName,
    })
    .from(schema.burnerBios)
    .where(
      and(
        inArray(schema.burnerBios.userId, authorIds),
        eq(schema.burnerBios.editionId, editionId),
      ),
    );
  for (const b of bios) if (b.displayName) names.set(b.userId, b.displayName);

  const [org] = await db()
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.kind, "org"))
    .limit(1);
  if (org) {
    const orgMembers = await db()
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.groupId, org.id),
          inArray(schema.memberships.userId, authorIds),
          inArray(schema.memberships.role, ["god", "org_staff"]),
        ),
      );
    for (const m of orgMembers) orgStaff.add(m.userId);
  }

  return { names, orgStaff };
}

export interface SupplierOption {
  id: string;
  name: string;
  services: string | null;
  standing: SupplierStanding;
  /** `watch` standing — render a subtle caution. */
  caution: boolean;
  /** Onboarded properly for this edition (drives the "incomplete" tag). */
  onboardingComplete: boolean;
}

/**
 * The suppliers repository for the Section 6 multi-select picker, keyed off the
 * supplier model v2: standing drives visibility (`suspended` excluded here via
 * @quagga/core `filterPickerEligible`), and onboarding completeness for the
 * given edition is surfaced as a tag. The old vetting labels are gone.
 */
export async function listSuppliersForPicker(
  editionId: string,
): Promise<SupplierOption[]> {
  const rows = await db()
    .select({
      id: schema.suppliers.id,
      name: schema.suppliers.name,
      services: schema.suppliers.services,
      standing: schema.suppliers.standing,
      steps: schema.supplierOnboarding.steps,
    })
    .from(schema.suppliers)
    .leftJoin(
      schema.supplierOnboarding,
      and(
        eq(schema.supplierOnboarding.supplierId, schema.suppliers.id),
        eq(schema.supplierOnboarding.editionId, editionId),
      ),
    )
    .orderBy(asc(schema.suppliers.name));

  const withOnboarding = rows.map((r) => ({
    id: r.id,
    name: r.name,
    services: r.services,
    standing: r.standing,
    isOnboarded: deriveOnboardingProgress(r.steps ?? {}).isOnboarded,
  }));

  return filterPickerEligible(withOnboarding).map((r) => ({
    id: r.id,
    name: r.name,
    services: r.services,
    standing: r.standing,
    caution: r.eligibility.caution,
    onboardingComplete: r.eligibility.onboardingComplete,
  }));
}

/** The supplier ids declared on a registration. */
export async function getDeclaredSupplierIds(
  registrationId: string,
): Promise<string[]> {
  const rows = await db()
    .select({ supplierId: schema.supplierDeclarations.supplierId })
    .from(schema.supplierDeclarations)
    .where(eq(schema.supplierDeclarations.registrationId, registrationId));
  return rows.map((r) => r.supplierId);
}

/** The persisted registration field values (excluding server-managed columns). */
export interface RegistrationValues {
  campDescription: string | null;
  s1ContactEmail: string | null;
  s1AltContactName: string | null;
  s1AltContactPhone: string | null;
  s1AltContactEmail: string | null;
  s2LntPlan: string | null;
  s2LntLeadName: string | null;
  s2LntLeadPhone: string | null;
  s2LntLeadEmail: string | null;
  s3ParticipationPlan: string | null;
  s3OperatingHours: string[];
  s3ScheduleDetail: string | null;
  s3GiftingFood: boolean | null;
  s4ExpectedPopulation: number | null;
  s4FirstArrivalDate: string | null;
  s4WorkAccessPasses: number | null;
  s4AreaDimensions: string | null;
  s4LayoutUploadUrls: string[];
  s5AmplifiedMusic: string | null;
  s5SoundPlan: string | null;
  s5PlacementFirstChoice: string | null;
  s5PlacementSecondChoice: string | null;
  s5NeighbourRequest: string | null;
  s5FamilyFriendly: string | null;
  s6SuppliersNote: string | null;
  s6PaidPerformers: boolean | null;
  s6FeeStructure: string | null;
  s6ExpectedBudgetZar: number | null;
  s6PlugAndPlayAck: boolean | null;
  supplierIds: string[];
}

/** Build the completeness input from a group name + current values. */
function toSectionData(
  campName: string,
  v: RegistrationValues,
): RegistrationSectionData {
  return {
    campName,
    campDescription: v.campDescription,
    s1ContactEmail: v.s1ContactEmail,
    s2LntPlan: v.s2LntPlan,
    s2LntLeadName: v.s2LntLeadName,
    s2LntLeadPhone: v.s2LntLeadPhone,
    s2LntLeadEmail: v.s2LntLeadEmail,
    s3ParticipationPlan: v.s3ParticipationPlan,
    s3OperatingHours: v.s3OperatingHours,
    s3GiftingFood: v.s3GiftingFood,
    s4ExpectedPopulation: v.s4ExpectedPopulation,
    s4FirstArrivalDate: v.s4FirstArrivalDate,
    s4AreaDimensions: v.s4AreaDimensions,
    s5AmplifiedMusic: v.s5AmplifiedMusic,
    s5SoundPlan: v.s5SoundPlan,
    s5PlacementFirstChoice: v.s5PlacementFirstChoice,
    s5FamilyFriendly: v.s5FamilyFriendly,
    s6PaidPerformers: v.s6PaidPerformers,
    s6FeeStructure: v.s6FeeStructure,
    s6PlugAndPlayAck: v.s6PlugAndPlayAck,
  };
}

export type SaveDraftResult =
  | { ok: true; completedSections: string[]; created: boolean }
  | { ok: false; error: string };

/**
 * Persist the wizard's current values to the draft (autosave). Creates the
 * registration row on first save. Camp description is written to `groups`; the
 * 60-word cap is enforced only as a completeness signal here (autosave never
 * discards in-progress text). Recomputes `completed_sections` from the core
 * predicates — the client is never trusted for completeness.
 */
export async function saveRegistrationDraft(input: {
  group: { id: string; name: string };
  editionId: string;
  values: RegistrationValues;
}): Promise<SaveDraftResult> {
  const existing = await getRegistration(input.group.id, input.editionId);
  if (existing && !isEditableStatus(existing.status)) {
    return {
      ok: false,
      error: "This registration is locked while AfrikaBurn reviews it.",
    };
  }

  const v = input.values;
  const completed = completedSectionsFor(toSectionData(input.group.name, v));

  const columns = {
    s1ContactEmail: v.s1ContactEmail,
    s1AltContactName: v.s1AltContactName,
    s1AltContactPhone: v.s1AltContactPhone,
    s1AltContactEmail: v.s1AltContactEmail,
    s2LntPlan: v.s2LntPlan,
    s2LntLeadName: v.s2LntLeadName,
    s2LntLeadPhone: v.s2LntLeadPhone,
    s2LntLeadEmail: v.s2LntLeadEmail,
    s3ParticipationPlan: v.s3ParticipationPlan,
    s3OperatingHours: v.s3OperatingHours,
    s3ScheduleDetail: v.s3ScheduleDetail,
    s3GiftingFood: v.s3GiftingFood,
    s4ExpectedPopulation: v.s4ExpectedPopulation,
    s4FirstArrivalDate: v.s4FirstArrivalDate,
    s4WorkAccessPasses: v.s4WorkAccessPasses,
    s4AreaDimensions: v.s4AreaDimensions,
    s4LayoutUploadUrls: v.s4LayoutUploadUrls,
    s5AmplifiedMusic: v.s5AmplifiedMusic,
    s5SoundPlan: v.s5SoundPlan,
    s5PlacementFirstChoice: v.s5PlacementFirstChoice,
    s5PlacementSecondChoice: v.s5PlacementSecondChoice,
    s5NeighbourRequest: v.s5NeighbourRequest,
    s5FamilyFriendly: v.s5FamilyFriendly,
    s6SuppliersNote: v.s6SuppliersNote,
    s6PaidPerformers: v.s6PaidPerformers,
    s6FeeStructure: v.s6FeeStructure,
    s6ExpectedBudgetZar: v.s6ExpectedBudgetZar,
    s6PlugAndPlayAck: v.s6PlugAndPlayAck,
    completedSections: completed,
    updatedAt: new Date(),
  };

  // The camp-description write (on `groups`), the registration upsert, and the
  // supplier-declaration replace (delete-then-insert) are ONE transaction. The
  // delete-then-insert is the sharpest hazard: without a transaction, a failure
  // between the two leaves the registration with NO supplier declarations at all
  // (silent data loss). Committing them together means an autosave either lands
  // whole or not at all.
  const result = await withTransaction(
    async (tx): Promise<{ registrationId: string; created: boolean }> => {
      // Camp description lives on the group row.
      await tx
        .update(schema.groups)
        .set({ description: v.campDescription, updatedAt: new Date() })
        .where(eq(schema.groups.id, input.group.id));

      let registrationId: string;
      let created = false;
      if (existing) {
        await tx
          .update(schema.registrations)
          .set(columns)
          .where(eq(schema.registrations.id, existing.id));
        registrationId = existing.id;
      } else {
        const [row] = await tx
          .insert(schema.registrations)
          .values({
            groupId: input.group.id,
            editionId: input.editionId,
            status: "draft",
            ...columns,
          })
          .returning({ id: schema.registrations.id });
        if (!row) throw new Error("Could not start the registration.");
        registrationId = row.id;
        created = true;
      }

      await replaceSupplierDeclarations(tx, registrationId, v.supplierIds);
      return { registrationId, created };
    },
  );

  return { ok: true, completedSections: completed, created: result.created };
}

/**
 * Replace the supplier declarations for a registration with the given ids.
 *
 * Defense-in-depth: the picker hides suspended suppliers via `filterPickerEligible`
 * at display time, but the client is never trusted — a camp admin could POST a
 * suspended supplier's id directly. So we re-check standing at this write boundary
 * through the same core predicate and drop any ineligible (suspended) ids before
 * persisting, rather than inserting whatever ids arrived.
 */
async function replaceSupplierDeclarations(
  tx: Tx,
  registrationId: string,
  supplierIds: string[],
): Promise<void> {
  await tx
    .delete(schema.supplierDeclarations)
    .where(eq(schema.supplierDeclarations.registrationId, registrationId));
  const unique = [...new Set(supplierIds)];
  if (unique.length === 0) return;

  // Re-filter against standing (suspended excluded) at the write boundary. Only
  // standing gates eligibility here; onboarding completeness merely tags a row,
  // so pass `isOnboarded: true` (it never changes the eligible verdict). The
  // standing read may use the HTTP client — it reads committed supplier rows,
  // which are unrelated to the declarations being rewritten in this transaction.
  const rows = await db()
    .select({ id: schema.suppliers.id, standing: schema.suppliers.standing })
    .from(schema.suppliers)
    .where(inArray(schema.suppliers.id, unique));
  const eligible = filterPickerEligible(
    rows.map((r) => ({ id: r.id, standing: r.standing, isOnboarded: true })),
  ).map((r) => r.id);
  if (eligible.length === 0) return;

  await tx
    .insert(schema.supplierDeclarations)
    .values(eligible.map((supplierId) => ({ registrationId, supplierId })))
    .onConflictDoNothing();
}

export type TransitionResult =
  | { ok: true; status: RegistrationStatus; registrationId: string }
  | { ok: false; error: string };

/**
 * Apply a camp action (submit / resubmit / withdraw) through the core state
 * machine. Submit/resubmit also enforce the all-six-complete gate. Stamps
 * `submitted_at` on a (re)submit. Does NOT send email — the server action does
 * that so this stays pure persistence.
 */
export async function applyCampAction(input: {
  groupId: string;
  editionId: string;
  action: CampAction;
}): Promise<TransitionResult> {
  const existing = await getRegistration(input.groupId, input.editionId);
  if (!existing) {
    return { ok: false, error: "There's no registration to update yet." };
  }

  let target: RegistrationStatus;
  try {
    target = resolveCampAction(existing.status, input.action);
  } catch {
    return {
      ok: false,
      error: `You can't ${input.action} a registration that's ${existing.status.replace("_", " ")}.`,
    };
  }

  if (input.action === "submit" || input.action === "resubmit") {
    if (!isSubmittable(existing.completedSections)) {
      return {
        ok: false,
        error: "Complete all six sections before submitting.",
      };
    }
  }

  await db()
    .update(schema.registrations)
    .set({
      status: target,
      updatedAt: new Date(),
      ...(target === "submitted" ? { submittedAt: new Date() } : {}),
    })
    .where(eq(schema.registrations.id, existing.id));

  return { ok: true, status: target, registrationId: existing.id };
}
