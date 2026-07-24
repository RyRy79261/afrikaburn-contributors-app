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
import { db, schema } from "./db";

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

export interface CampSectionReview {
  id: string;
  sectionKey: string;
  status: SectionReviewStatus;
  comment: string;
  createdAt: Date;
}

/** The camp-visible section-review threads (AB feedback) for a registration. */
export async function getSectionReviews(
  registrationId: string,
): Promise<CampSectionReview[]> {
  return db()
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

  // Camp description lives on the group row.
  await db()
    .update(schema.groups)
    .set({ description: v.campDescription, updatedAt: new Date() })
    .where(eq(schema.groups.id, input.group.id));

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

  let registrationId: string;
  let created = false;
  if (existing) {
    await db()
      .update(schema.registrations)
      .set(columns)
      .where(eq(schema.registrations.id, existing.id));
    registrationId = existing.id;
  } else {
    const [row] = await db()
      .insert(schema.registrations)
      .values({
        groupId: input.group.id,
        editionId: input.editionId,
        status: "draft",
        ...columns,
      })
      .returning({ id: schema.registrations.id });
    if (!row) return { ok: false, error: "Could not start the registration." };
    registrationId = row.id;
    created = true;
  }

  await replaceSupplierDeclarations(registrationId, v.supplierIds);

  return { ok: true, completedSections: completed, created };
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
  registrationId: string,
  supplierIds: string[],
): Promise<void> {
  await db()
    .delete(schema.supplierDeclarations)
    .where(eq(schema.supplierDeclarations.registrationId, registrationId));
  const unique = [...new Set(supplierIds)];
  if (unique.length === 0) return;

  // Re-filter against standing (suspended excluded) at the write boundary. Only
  // standing gates eligibility here; onboarding completeness merely tags a row,
  // so pass `isOnboarded: true` (it never changes the eligible verdict).
  const rows = await db()
    .select({ id: schema.suppliers.id, standing: schema.suppliers.standing })
    .from(schema.suppliers)
    .where(inArray(schema.suppliers.id, unique));
  const eligible = filterPickerEligible(
    rows.map((r) => ({ id: r.id, standing: r.standing, isOnboarded: true })),
  ).map((r) => r.id);
  if (eligible.length === 0) return;

  await db()
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
