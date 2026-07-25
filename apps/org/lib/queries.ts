import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type {
  OfficerKey,
  RegistrationStatus,
  SupplierNoteKind,
  SupplierOnboardingSteps,
  SupplierReturning,
  SupplierStanding,
} from "@quagga/types";
import {
  countCategoryUsage,
  deriveOfficerCoverage,
  deriveQuestionnaireCompletion,
  deriveRegistrationFunnel,
  deriveStatusBoardKpis,
  deriveSupplierOnboardingRollup,
  deriveSupplierStandingRollup,
  soundLevelFromValue,
  type OfficerCoverage,
  type ProjectStatInput,
  type QuestionnaireCompletionRollup,
  type RegistrationFunnel,
  type StatusBoardKpis,
  type SupplierOnboardingRollup,
} from "@quagga/core";

import { getDb, schema } from "@/lib/db";
import { deriveCohort, type Cohort } from "@/lib/org-logic";

// Data access for the console. Every function is read-only and self-contained;
// mutations live in lib/actions/*. All assume the caller already cleared the
// gate (resolveOrgSession) — these do not re-check auth.

export interface ActiveEdition {
  id: string;
  name: string;
  year: number;
  startDate: string;
  endDate: string;
}

/** The active edition (seed: AfrikaBurn 2027), or null if none is seeded. */
export async function getActiveEdition(): Promise<ActiveEdition | null> {
  const db = getDb();
  const [edition] = await db
    .select({
      id: schema.editions.id,
      name: schema.editions.name,
      year: schema.editions.year,
      startDate: schema.editions.startDate,
      endDate: schema.editions.endDate,
    })
    .from(schema.editions)
    .where(eq(schema.editions.isActive, true))
    .orderBy(desc(schema.editions.year))
    .limit(1);
  return edition ?? null;
}

export interface OverviewCounts {
  edition: ActiveEdition | null;
  registrationsByStatus: Record<RegistrationStatus, number>;
  registrationsTotal: number;
  camps: number;
  suppliers: number;
}

const EMPTY_STATUS_COUNTS: Record<RegistrationStatus, number> = {
  draft: 0,
  submitted: 0,
  under_review: 0,
  changes_requested: 0,
  approved: 0,
  rejected: 0,
  withdrawn: 0,
};

/** Overview tiles: registrations by status, camps, suppliers. */
export async function getOverviewCounts(): Promise<OverviewCounts> {
  const db = getDb();
  const edition = await getActiveEdition();

  const byStatus: Record<RegistrationStatus, number> = { ...EMPTY_STATUS_COUNTS };
  let registrationsTotal = 0;

  if (edition) {
    const rows = await db
      .select({ status: schema.registrations.status })
      .from(schema.registrations)
      .where(eq(schema.registrations.editionId, edition.id));
    for (const row of rows) {
      byStatus[row.status] += 1;
      registrationsTotal += 1;
    }
  }

  // A "camp" here is any project group (non-org). Persistent, not per-edition.
  const [camps, suppliers] = await Promise.all([
    db.$count(
      schema.groups,
      inArray(schema.groups.kind, ["theme_camp", "artwork", "mutant_vehicle"]),
    ),
    db.$count(schema.suppliers),
  ]);

  return {
    edition,
    registrationsByStatus: byStatus,
    registrationsTotal,
    camps,
    suppliers,
  };
}

export interface AccountRow {
  userId: string;
  email: string | null;
  /** Latest Burner Bio display name, when the account has one. */
  burnerName: string | null;
  role: "god" | "org_staff" | null;
  createdAt: Date;
}

/**
 * Search users by email OR Burner Bio display name (case-insensitive
 * substring), annotated with their org role and most-recent display name.
 * Empty query returns the most recent accounts. One row per user.
 */
export async function searchAccounts(
  orgGroupId: string,
  query: string,
): Promise<AccountRow[]> {
  const db = getDb();
  const q = query.trim();
  const like = `%${q}%`;

  const rows = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      role: schema.memberships.role,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .leftJoin(
      schema.memberships,
      and(
        eq(schema.memberships.userId, schema.users.id),
        eq(schema.memberships.groupId, orgGroupId),
      ),
    )
    .where(
      q
        ? or(
            ilike(schema.users.email, like),
            exists(
              db
                .select({ one: sql`1` })
                .from(schema.burnerBios)
                .where(
                  and(
                    eq(schema.burnerBios.userId, schema.users.id),
                    ilike(schema.burnerBios.displayName, like),
                  ),
                ),
            ),
          )
        : undefined,
    )
    .orderBy(desc(schema.users.createdAt))
    .limit(50);

  // Latest display name per returned user (bios are per-edition; newest wins).
  const userIds = rows.map((r) => r.userId);
  const nameByUser = new Map<string, string>();
  if (userIds.length > 0) {
    const bios = await db
      .select({
        userId: schema.burnerBios.userId,
        displayName: schema.burnerBios.displayName,
        updatedAt: schema.burnerBios.updatedAt,
      })
      .from(schema.burnerBios)
      .where(inArray(schema.burnerBios.userId, userIds))
      .orderBy(desc(schema.burnerBios.updatedAt));
    for (const b of bios) {
      if (b.displayName && !nameByUser.has(b.userId)) {
        nameByUser.set(b.userId, b.displayName);
      }
    }
  }

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    burnerName: nameByUser.get(r.userId) ?? null,
    role: r.role === "god" || r.role === "org_staff" ? r.role : null,
    createdAt: r.createdAt,
  }));
}

export interface RegistrationRow {
  id: string;
  status: RegistrationStatus;
  groupName: string;
  groupKind: string;
  groupSlug: string;
  soundRaw: string | null;
  cohort: Cohort;
  expectedPopulation: number | null;
  submittedAt: Date | null;
  updatedAt: Date;
}

/** All registrations for the active edition, annotated with cohort + sound. */
export async function getRegistrationRows(
  edition: ActiveEdition,
): Promise<RegistrationRow[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: schema.registrations.id,
      status: schema.registrations.status,
      groupId: schema.registrations.groupId,
      groupName: schema.groups.name,
      groupKind: schema.groups.kind,
      groupSlug: schema.groups.slug,
      soundRaw: schema.registrations.s5AmplifiedMusic,
      expectedPopulation: schema.registrations.s4ExpectedPopulation,
      submittedAt: schema.registrations.submittedAt,
      updatedAt: schema.registrations.updatedAt,
    })
    .from(schema.registrations)
    .innerJoin(
      schema.groups,
      eq(schema.groups.id, schema.registrations.groupId),
    )
    .where(eq(schema.registrations.editionId, edition.id))
    .orderBy(desc(schema.registrations.updatedAt));

  const priorGroupIds = await getGroupsWithPriorRegistrations(edition.year);

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    groupName: r.groupName,
    groupKind: r.groupKind,
    groupSlug: r.groupSlug,
    soundRaw: r.soundRaw,
    cohort: deriveCohort(priorGroupIds.has(r.groupId)),
    expectedPopulation: r.expectedPopulation,
    submittedAt: r.submittedAt,
    updatedAt: r.updatedAt,
  }));
}

/** Group ids that registered in an edition PRIOR to `year` (cohort source). */
async function getGroupsWithPriorRegistrations(
  year: number,
): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({ groupId: schema.registrations.groupId })
    .from(schema.registrations)
    .innerJoin(
      schema.editions,
      eq(schema.editions.id, schema.registrations.editionId),
    )
    .where(lt(schema.editions.year, year));
  return new Set(rows.map((r) => r.groupId));
}

export interface SectionReviewRow {
  id: string;
  sectionKey: string;
  status: "open" | "resolved";
  comment: string;
  reviewerEmail: string | null;
  createdAt: Date;
}

export interface SupplierDeclarationRow {
  supplierId: string;
  name: string;
  services: string | null;
  standing: SupplierStanding;
  note: string | null;
}

export interface RegistrationDetail {
  registration: typeof schema.registrations.$inferSelect;
  group: {
    id: string;
    name: string;
    kind: string;
    slug: string;
    description: string | null;
    joinability: string;
  };
  edition: { id: string; name: string; year: number };
  reviews: SectionReviewRow[];
  supplierDeclarations: SupplierDeclarationRow[];
  decidedByEmail: string | null;
  cohort: Cohort;
}

/** Full read model for one registration detail page. Null if not found. */
export async function getRegistrationDetail(
  id: string,
): Promise<RegistrationDetail | null> {
  const db = getDb();

  const [registration] = await db
    .select()
    .from(schema.registrations)
    .where(eq(schema.registrations.id, id))
    .limit(1);
  if (!registration) return null;

  const [group] = await db
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      kind: schema.groups.kind,
      slug: schema.groups.slug,
      description: schema.groups.description,
      joinability: schema.groups.joinability,
    })
    .from(schema.groups)
    .where(eq(schema.groups.id, registration.groupId))
    .limit(1);

  const [edition] = await db
    .select({
      id: schema.editions.id,
      name: schema.editions.name,
      year: schema.editions.year,
    })
    .from(schema.editions)
    .where(eq(schema.editions.id, registration.editionId))
    .limit(1);

  const reviewer = schema.users;
  const reviews = await db
    .select({
      id: schema.sectionReviews.id,
      sectionKey: schema.sectionReviews.sectionKey,
      status: schema.sectionReviews.status,
      comment: schema.sectionReviews.comment,
      reviewerEmail: reviewer.email,
      createdAt: schema.sectionReviews.createdAt,
    })
    .from(schema.sectionReviews)
    .leftJoin(reviewer, eq(reviewer.id, schema.sectionReviews.reviewerId))
    .where(eq(schema.sectionReviews.registrationId, id))
    .orderBy(asc(schema.sectionReviews.createdAt));

  const supplierDeclarations = await db
    .select({
      supplierId: schema.suppliers.id,
      name: schema.suppliers.name,
      services: schema.suppliers.services,
      standing: schema.suppliers.standing,
      note: schema.supplierDeclarations.note,
    })
    .from(schema.supplierDeclarations)
    .innerJoin(
      schema.suppliers,
      eq(schema.suppliers.id, schema.supplierDeclarations.supplierId),
    )
    .where(eq(schema.supplierDeclarations.registrationId, id))
    .orderBy(asc(schema.suppliers.name));

  let decidedByEmail: string | null = null;
  if (registration.decidedByUserId) {
    const [decider] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, registration.decidedByUserId))
      .limit(1);
    decidedByEmail = decider?.email ?? null;
  }

  const prior = group
    ? await getGroupsWithPriorRegistrations(edition?.year ?? 0)
    : new Set<string>();

  return {
    registration,
    group: group ?? {
      id: registration.groupId,
      name: "Unknown group",
      kind: "theme_camp",
      slug: "",
      description: null,
      joinability: "invite_only",
    },
    edition: edition ?? {
      id: registration.editionId,
      name: "Unknown edition",
      year: 0,
    },
    reviews: reviews.map((r) => ({
      id: r.id,
      sectionKey: r.sectionKey,
      status: r.status,
      comment: r.comment,
      reviewerEmail: r.reviewerEmail,
      createdAt: r.createdAt,
    })),
    supplierDeclarations,
    decidedByEmail,
    cohort: deriveCohort(group ? prior.has(group.id) : false),
  };
}

export interface OfficerContactRow {
  officerKey: string;
  officerName: string;
  emoji: string | null;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  consent: string;
}

/**
 * Accepted officers for a camp, with their org-shared contact details
 * (questionnaire-spec §"Officers are ALSO registrations"). Assigning an officer
 * is an officer registration; ACCEPTANCE is the SINGLE path that shares an
 * officer's name/email/phone with AfrikaBurn — so this query filters to
 * `consent = accepted`. Pending/declined officers never surface contact here,
 * and the bio phone hard-lock is untouched for everyone else.
 */
export async function getRegistrationOfficers(
  groupId: string,
  editionId: string,
): Promise<OfficerContactRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      officerKey: schema.projectRoles.officerKey,
      officerName: schema.projectRoles.name,
      emoji: schema.projectRoles.emoji,
      consent: schema.memberRoleAssignments.consentStatus,
      displayName: schema.burnerBios.displayName,
      bioEmail: schema.burnerBios.contactEmail,
      phone: schema.burnerBios.phone,
      userEmail: schema.users.email,
    })
    .from(schema.memberRoleAssignments)
    .innerJoin(
      schema.projectRoles,
      eq(schema.projectRoles.id, schema.memberRoleAssignments.projectRoleId),
    )
    .innerJoin(
      schema.memberships,
      eq(schema.memberships.id, schema.memberRoleAssignments.membershipId),
    )
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .leftJoin(
      schema.burnerBios,
      and(
        eq(schema.burnerBios.userId, schema.memberships.userId),
        eq(schema.burnerBios.editionId, editionId),
      ),
    )
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        eq(schema.projectRoles.kind, "officer"),
        eq(schema.memberRoleAssignments.consentStatus, "accepted"),
        eq(schema.memberRoleAssignments.orgVisible, true),
      ),
    )
    .orderBy(asc(schema.projectRoles.sort));

  return rows.map((r) => ({
    officerKey: r.officerKey ?? "",
    officerName: r.officerName,
    emoji: r.emoji,
    displayName: r.displayName,
    email: r.bioEmail ?? r.userEmail ?? null,
    phone: r.phone,
    consent: r.consent,
  }));
}

export interface DecisionLogRow {
  id: string;
  action: string;
  actorEmail: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
}

/** Decision history for a registration (audit_events on this subject). */
export async function getRegistrationDecisionLog(
  registrationId: string,
): Promise<DecisionLogRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.auditEvents.id,
      action: schema.auditEvents.action,
      actorEmail: schema.users.email,
      meta: schema.auditEvents.meta,
      createdAt: schema.auditEvents.createdAt,
    })
    .from(schema.auditEvents)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditEvents.actorId))
    .where(eq(schema.auditEvents.subject, registrationId))
    .orderBy(desc(schema.auditEvents.createdAt));
  return rows;
}

export interface SupplierOverviewRow {
  id: string;
  name: string;
  services: string | null;
  contact: string | null;
  website: string | null;
  /** Normalised category chip (from the imported sheet), null when unset. */
  category: string | null;
  /** Returning vs newbie (from the imported sheet), null when unset. */
  returning: SupplierReturning | null;
  standing: SupplierStanding;
  /** Onboarding step-state map for the active edition ({} when none yet). */
  steps: SupplierOnboardingSteps;
  notesCount: number;
}

/**
 * Supplier repository rows for the console table: standing, the onboarding
 * step-state map for `editionId` (empty when there's no onboarding row yet),
 * and a notes count. Progress (n/7) is derived in-component via @quagga/core.
 * Caller must have cleared the gate.
 */
export async function getSuppliersOverview(
  editionId: string | null,
): Promise<SupplierOverviewRow[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: schema.suppliers.id,
      name: schema.suppliers.name,
      services: schema.suppliers.services,
      contact: schema.suppliers.contact,
      website: schema.suppliers.website,
      category: schema.suppliers.category,
      returning: schema.suppliers.returning,
      standing: schema.suppliers.standing,
      steps: schema.supplierOnboarding.steps,
    })
    .from(schema.suppliers)
    .leftJoin(
      schema.supplierOnboarding,
      editionId
        ? and(
            eq(schema.supplierOnboarding.supplierId, schema.suppliers.id),
            eq(schema.supplierOnboarding.editionId, editionId),
          )
        : sql`false`,
    )
    .orderBy(asc(schema.suppliers.name));

  const noteCounts = await db
    .select({
      supplierId: schema.supplierNotes.supplierId,
      total: count(),
    })
    .from(schema.supplierNotes)
    .groupBy(schema.supplierNotes.supplierId);
  const countBySupplier = new Map(
    noteCounts.map((n) => [n.supplierId, Number(n.total)]),
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    services: r.services,
    contact: r.contact,
    website: r.website,
    category: r.category,
    returning: r.returning,
    standing: r.standing,
    steps: r.steps ?? {},
    notesCount: countBySupplier.get(r.id) ?? 0,
  }));
}

export interface SupplierNoteRow {
  id: string;
  kind: SupplierNoteKind;
  body: string;
  authorEmail: string | null;
  createdAt: Date;
}

/** Org-internal notes timeline for a supplier, newest first. */
export async function getSupplierNotes(
  supplierId: string,
): Promise<SupplierNoteRow[]> {
  const db = getDb();
  return db
    .select({
      id: schema.supplierNotes.id,
      kind: schema.supplierNotes.kind,
      body: schema.supplierNotes.body,
      authorEmail: schema.users.email,
      createdAt: schema.supplierNotes.createdAt,
    })
    .from(schema.supplierNotes)
    .leftJoin(schema.users, eq(schema.users.id, schema.supplierNotes.authorId))
    .where(eq(schema.supplierNotes.supplierId, supplierId))
    .orderBy(desc(schema.supplierNotes.createdAt));
}

// --- Camp categories ------------------------------------------------------

export interface CampCategoryRow {
  id: string;
  label: string;
  emoji: string | null;
  sort: number;
  /** Number of groups that have picked this category. */
  usage: number;
}

/**
 * The edition's category catalog with usage counts (build-spec §"Camp
 * categories"). Feeds the org category-management page. Caller must have
 * cleared the gate.
 */
export async function getCampCategories(
  editionId: string,
): Promise<CampCategoryRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.campCategories.id,
      label: schema.campCategories.label,
      emoji: schema.campCategories.emoji,
      sort: schema.campCategories.sort,
    })
    .from(schema.campCategories)
    .where(eq(schema.campCategories.editionId, editionId))
    .orderBy(asc(schema.campCategories.sort), asc(schema.campCategories.label));

  const assignments = await db
    .select({ categoryId: schema.groupCategories.categoryId })
    .from(schema.groupCategories)
    .innerJoin(
      schema.campCategories,
      eq(schema.campCategories.id, schema.groupCategories.categoryId),
    )
    .where(eq(schema.campCategories.editionId, editionId));
  const usage = countCategoryUsage(assignments);

  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    emoji: r.emoji,
    sort: r.sort,
    usage: usage.get(r.id) ?? 0,
  }));
}

// --- Status board / overview stats ----------------------------------------

/** Camp registration statuses that count as "registered or in flight" for the
 * officer-coverage denominator (draft/withdrawn/rejected excluded). */
const OFFICER_IN_FLIGHT: readonly RegistrationStatus[] = [
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
];

export interface StatusBoard {
  edition: ActiveEdition | null;
  kpis: StatusBoardKpis;
  funnel: RegistrationFunnel;
  officerCoverage: OfficerCoverage;
  supplierOnboarding: SupplierOnboardingRollup;
  supplierStandings: Record<SupplierStanding, number>;
  questionnaires: QuestionnaireCompletionRollup;
}

/**
 * The full status-board read model (build-spec §"Org stats dashboard" +
 * §"Status board KPI row"). Fetches the raw rows and runs the pure @quagga/core
 * derivations so the org landing + Overview share one consistent source. Caller
 * must have cleared the gate. Degrades to all-zero derivations when no edition
 * is active (every derivation handles empty input).
 */
export async function getStatusBoard(
  edition: ActiveEdition | null,
): Promise<StatusBoard> {
  const db = getDb();

  if (!edition) {
    return {
      edition: null,
      kpis: deriveStatusBoardKpis({ bios: [], projects: [] }),
      funnel: deriveRegistrationFunnel([]),
      officerCoverage: deriveOfficerCoverage([]),
      supplierOnboarding: deriveSupplierOnboardingRollup([]),
      supplierStandings: deriveSupplierStandingRollup([]),
      questionnaires: deriveQuestionnaireCompletion([]),
    };
  }

  // Burner bios (completeness) for the edition.
  const bioRows = await db
    .select({ completedAt: schema.burnerBios.completedAt })
    .from(schema.burnerBios)
    .where(eq(schema.burnerBios.editionId, edition.id));

  // Projects (camps / MV / artworks) with their best registration for the
  // edition (≤1 per group/edition via the unique index).
  const projectRows = await db
    .select({
      kind: schema.groups.kind,
      status: schema.registrations.status,
      grantsInterest: schema.registrations.grantsInterest,
    })
    .from(schema.groups)
    .leftJoin(
      schema.registrations,
      and(
        eq(schema.registrations.groupId, schema.groups.id),
        eq(schema.registrations.editionId, edition.id),
      ),
    )
    .where(
      inArray(schema.groups.kind, ["theme_camp", "artwork", "mutant_vehicle"]),
    );
  const projects: ProjectStatInput[] = projectRows.map((r) => ({
    kind: r.kind,
    status: r.status ?? null,
    grantsInterest: r.grantsInterest ?? null,
  }));

  // Registration funnel — every registration status for the edition.
  const regRows = await db
    .select({ status: schema.registrations.status })
    .from(schema.registrations)
    .where(eq(schema.registrations.editionId, edition.id));

  // Officer coverage — camps registered or in flight, with their sound level
  // and the officer slots that currently have a member (pending or accepted).
  const campRegRows = await db
    .select({
      groupId: schema.registrations.groupId,
      status: schema.registrations.status,
      soundRaw: schema.registrations.s5AmplifiedMusic,
    })
    .from(schema.registrations)
    .innerJoin(
      schema.groups,
      eq(schema.groups.id, schema.registrations.groupId),
    )
    .where(
      and(
        eq(schema.registrations.editionId, edition.id),
        eq(schema.groups.kind, "theme_camp"),
      ),
    );

  const officerAssignmentRows = await db
    .select({
      groupId: schema.memberships.groupId,
      officerKey: schema.projectRoles.officerKey,
      consent: schema.memberRoleAssignments.consentStatus,
    })
    .from(schema.memberRoleAssignments)
    .innerJoin(
      schema.projectRoles,
      eq(schema.projectRoles.id, schema.memberRoleAssignments.projectRoleId),
    )
    .innerJoin(
      schema.memberships,
      eq(schema.memberships.id, schema.memberRoleAssignments.membershipId),
    )
    .where(eq(schema.projectRoles.kind, "officer"));

  const assignedByGroup = new Map<string, Set<OfficerKey>>();
  for (const row of officerAssignmentRows) {
    // A slot counts as filled once a member holds it (pending or accepted).
    if (row.consent !== "pending" && row.consent !== "accepted") continue;
    if (!row.officerKey) continue;
    const set = assignedByGroup.get(row.groupId) ?? new Set<OfficerKey>();
    set.add(row.officerKey as OfficerKey);
    assignedByGroup.set(row.groupId, set);
  }

  const inFlight = new Set<RegistrationStatus>(OFFICER_IN_FLIGHT);
  const officerCamps = campRegRows
    .filter((r) => inFlight.has(r.status))
    .map((r) => ({
      isRegisteredOrInFlight: true,
      triggers: {
        soundLevel: soundLevelFromValue(r.soundRaw),
        hasGenerators: false,
        hasOpenFlame: false,
        hasFuelStorage: false,
      },
      assignedKeys: assignedByGroup.get(r.groupId) ?? new Set<OfficerKey>(),
    }));

  // Suppliers — standing + onboarding step map for the edition.
  const supplierRows = await db
    .select({
      standing: schema.suppliers.standing,
      steps: schema.supplierOnboarding.steps,
    })
    .from(schema.suppliers)
    .leftJoin(
      schema.supplierOnboarding,
      and(
        eq(schema.supplierOnboarding.supplierId, schema.suppliers.id),
        eq(schema.supplierOnboarding.editionId, edition.id),
      ),
    );

  // Questionnaire completion — open activations for the edition + their
  // required-action statuses.
  const activationRows = await db
    .select({
      id: schema.questionnaireActivations.id,
      title: schema.questionnaireActivations.title,
    })
    .from(schema.questionnaireActivations)
    .where(
      and(
        eq(schema.questionnaireActivations.editionId, edition.id),
        eq(schema.questionnaireActivations.status, "open"),
      ),
    );
  const activationIds = activationRows.map((a) => a.id);
  const actionRows =
    activationIds.length === 0
      ? []
      : await db
          .select({
            activationId: schema.requiredActions.activationId,
            status: schema.requiredActions.status,
          })
          .from(schema.requiredActions)
          .where(inArray(schema.requiredActions.activationId, activationIds));
  const actionsByActivation = new Map<string, { status: string }[]>();
  for (const a of actionRows) {
    if (!a.activationId) continue;
    const list = actionsByActivation.get(a.activationId) ?? [];
    list.push({ status: a.status });
    actionsByActivation.set(a.activationId, list);
  }
  const sends = activationRows.map((a) => ({
    activationId: a.id,
    title: a.title,
    actions: actionsByActivation.get(a.id) ?? [],
  }));

  return {
    edition,
    kpis: deriveStatusBoardKpis({ bios: bioRows, projects }),
    funnel: deriveRegistrationFunnel(regRows.map((r) => r.status)),
    officerCoverage: deriveOfficerCoverage(officerCamps),
    supplierOnboarding: deriveSupplierOnboardingRollup(
      supplierRows.map((s) => ({ steps: s.steps })),
    ),
    supplierStandings: deriveSupplierStandingRollup(
      supplierRows.map((s) => ({ standing: s.standing })),
    ),
    questionnaires: deriveQuestionnaireCompletion(sends),
  };
}

