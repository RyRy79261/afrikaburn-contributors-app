import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type {
  MembershipRole,
  OfficerKey,
  RegistrationStatus,
  SupplierNoteKind,
  SupplierOnboardingSteps,
  SupplierReturning,
  SupplierStanding,
} from "@quagga/types";
import {
  canReadPersonalInformation,
  countCategoryUsage,
  ORG_RANKS,
  orgRankFromRole,
  deriveOfficerCoverage,
  deriveQuestionnaireCompletion,
  deriveRegistrationFunnel,
  deriveStatusBoardKpis,
  deriveSupplierOnboardingRollup,
  deriveSupplierStandingRollup,
  publicMemberName,
  soundLevelFromValue,
  type OfficerCoverage,
  type ProjectStatInput,
  type OrgActor,
  type OrgRank,
  type QuestionnaireCompletionRollup,
  type RegistrationFunnel,
  type StatusBoardKpis,
  type SupplierOnboardingRollup,
} from "@quagga/core";
import { decryptOrNull } from "@quagga/db/crypto";

import { getDb, schema } from "@/lib/db";
import { deriveCohort, type Cohort } from "@/lib/org-logic";

// Data access for the console. Every function is read-only and self-contained;
// mutations live in lib/actions/*. All assume the caller already cleared the
// gate (resolveOrgSession) — these do not re-check auth.
//
// EXCEPT for one thing, which they DO decide here: PERSONAL INFORMATION.
//
// Every query that returns a person takes the caller's `OrgActor` and runs
// `canReadPersonalInformation` BEFORE the select — the `canViewMedicalNotes`
// pattern (see `getRosterMemberDetail`), applied to the rest of it. An engineer
// does not merely fail to see a contact number: the column is never selected, so
// it is never in the row, never in the returned object, and never in the RSC
// payload a component would have shipped it in regardless of what it rendered.
//
// Deciding after the fetch is the shape this deliberately avoids. A value that
// reached render scope is one careless `<pre>{JSON.stringify(detail)}</pre>`, one
// `console.log`, one new prop away from shipping — and none of those look like a
// privacy bug in review.

/** Whether the caller receives personal information at all (see above). */
function seesPersonalInformation(actor: OrgActor): boolean {
  return canReadPersonalInformation(actor);
}

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

  const byStatus: Record<RegistrationStatus, number> = {
    ...EMPTY_STATUS_COUNTS,
  };
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
  /** The account's email — null for a caller who may not read personal info. */
  email: string | null;
  /** The account-level handle (public by design; not personal information). */
  username: string | null;
  /** Their org rank, or null when they hold none. */
  role: OrgRank | null;
  /** Free-text org department label, or null. */
  department: string | null;
  isDepartmentLead: boolean;
  createdAt: Date;
}

/**
 * Search users by email OR username (case-insensitive substring), annotated with
 * their org rank. Empty query returns the most recent accounts. One row per user.
 *
 * WITHOUT `read_personal_information` the email column is neither SELECTED nor
 * MATCHED. Dropping it from the select alone would leave the search itself as an
 * oracle: type a whole address, get a row back, and you have confirmed that
 * address has an account here — a lookup service for exactly the data the rank
 * is not allowed to hold. So an engineer's search runs against the username
 * only, and the page says so rather than silently returning nothing.
 */
export async function searchAccounts(
  orgGroupId: string,
  query: string,
  actor: OrgActor,
): Promise<AccountRow[]> {
  const db = getDb();
  const personal = seesPersonalInformation(actor);
  const q = query.trim();
  const like = `%${q}%`;

  const rows = await db
    .select({
      userId: schema.users.id,
      username: schema.users.username,
      role: schema.memberships.role,
      department: schema.memberships.department,
      departmentLead: schema.memberships.departmentLead,
      createdAt: schema.users.createdAt,
      ...(personal ? { email: schema.users.email } : {}),
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
        ? personal
          ? or(
              ilike(schema.users.email, like),
              ilike(schema.users.username, like),
            )
          : ilike(schema.users.username, like)
        : undefined,
    )
    .orderBy(desc(schema.users.createdAt))
    .limit(50);

  return rows.map((r) => ({
    userId: r.userId,
    email: "email" in r ? ((r.email as string | null) ?? null) : null,
    username: r.username,
    role: orgRankFromRole(r.role),
    department: r.department,
    isDepartmentLead: r.departmentLead ?? false,
    createdAt: r.createdAt,
  }));
}

export interface OrgAccessRoster {
  members: AccountRow[];
  /** How many hold the System manager rank. Drives the sole-manager warning. */
  systemManagerCount: number;
}

/**
 * Everyone who currently HOLDS org access, newest grant last — the standing
 * question the System panel exists to answer ("who can get into this console,
 * at what rank, in whose department?").
 *
 * Deliberately not `searchAccounts` with a filter. That query answers a
 * different question — "find me a burner so I can grant them something" — and
 * walks the whole `users` table to do it. This one is driven from `memberships`,
 * so it is bounded by the number of staff rather than by the number of burners,
 * and it cannot accidentally list a person who holds nothing.
 *
 * Same personal-information rule as everywhere else: the email column is
 * resolved BEFORE the select, so an engineer's rows never contain one. The
 * counts are not personal information — how many people hold a rank is a fact
 * about the deployment, not about a person — which is what lets an engineer see
 * that there is exactly one System manager without being told who.
 */
export async function getOrgAccessRoster(
  orgGroupId: string,
  actor: OrgActor,
): Promise<OrgAccessRoster> {
  const db = getDb();
  const personal = seesPersonalInformation(actor);

  const rows = await db
    .select({
      userId: schema.users.id,
      username: schema.users.username,
      role: schema.memberships.role,
      department: schema.memberships.department,
      departmentLead: schema.memberships.departmentLead,
      createdAt: schema.users.createdAt,
      ...(personal ? { email: schema.users.email } : {}),
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.groupId, orgGroupId),
        inArray(schema.memberships.role, [...ORG_RANKS]),
      ),
    )
    .orderBy(asc(schema.users.createdAt))
    .limit(200);

  const members = rows.map((r) => ({
    userId: r.userId,
    email: "email" in r ? ((r.email as string | null) ?? null) : null,
    username: r.username,
    role: orgRankFromRole(r.role),
    department: r.department,
    isDepartmentLead: r.departmentLead ?? false,
    createdAt: r.createdAt,
  }));

  return {
    members,
    systemManagerCount: members.filter((m) => m.role === "god").length,
  };
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

/** One reply threaded under a section review (camp answering, or AB following up). */
export interface SectionReviewReplyRow {
  id: string;
  authorUserId: string | null;
  /** Display label: the author's Burner Bio name for this edition, "AfrikaBurn"
   * for org staff, or "A camp member" fallback. */
  authorName: string;
  /** True when the author is org staff (god / org_staff). */
  isOrg: boolean;
  body: string;
  createdAt: Date;
}

export interface SectionReviewRow {
  id: string;
  sectionKey: string;
  status: "open" | "resolved";
  comment: string;
  reviewerEmail: string | null;
  createdAt: Date;
  /** The camp/AB reply conversation under this review, oldest first. */
  replies: SectionReviewReplyRow[];
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

// The `registrations` columns that are a HUMAN BEING'S contact details rather
// than facts about a camp: the camp's contact address, the alternate contact
// (name + phone + email) and the LNT lead (name + phone + email). Everything
// else on the row — sound plan, population, placement wishes, budget — is the
// camp's answer, not a person's, and every rank reads it.
const REGISTRATION_CONTACT_KEYS = [
  "s1ContactEmail",
  "s1AltContactName",
  "s1AltContactPhone",
  "s1AltContactEmail",
  "s2LntLeadName",
  "s2LntLeadPhone",
  "s2LntLeadEmail",
] as const;

/** The same keys, nulled — spread back so the row keeps its full shape. */
const REGISTRATION_CONTACT_NULLS = Object.fromEntries(
  REGISTRATION_CONTACT_KEYS.map((key) => [key, null]),
) as Record<(typeof REGISTRATION_CONTACT_KEYS)[number], null>;

/**
 * Load one registration row, selecting the contact columns ONLY for a caller
 * allowed to read them. The refused branch selects every OTHER column by name
 * (via drizzle's `getTableColumns`, so a column added to the schema later is
 * included automatically rather than silently vanishing) and spreads nulls into
 * the contact keys, keeping the row's type identical for both callers.
 */
async function loadRegistrationRow(
  id: string,
  personal: boolean,
): Promise<typeof schema.registrations.$inferSelect | undefined> {
  const db = getDb();
  if (personal) {
    const [row] = await db
      .select()
      .from(schema.registrations)
      .where(eq(schema.registrations.id, id))
      .limit(1);
    return row;
  }

  const {
    s1ContactEmail: _contactEmail,
    s1AltContactName: _altName,
    s1AltContactPhone: _altPhone,
    s1AltContactEmail: _altEmail,
    s2LntLeadName: _lntName,
    s2LntLeadPhone: _lntPhone,
    s2LntLeadEmail: _lntEmail,
    ...withoutContact
  } = getTableColumns(schema.registrations);

  const [row] = await db
    .select(withoutContact)
    .from(schema.registrations)
    .where(eq(schema.registrations.id, id))
    .limit(1);
  return row ? { ...row, ...REGISTRATION_CONTACT_NULLS } : undefined;
}

/**
 * Full read model for one registration detail page. Null if not found.
 *
 * For a caller without `read_personal_information` the camp's contact people
 * (alt contact, LNT lead) and the reviewer/decider identities are never
 * selected: the review itself — plans, sound, placement, suppliers — is entirely
 * readable, which is the point of the engineer rank having access everywhere.
 */
export async function getRegistrationDetail(
  id: string,
  actor: OrgActor,
): Promise<RegistrationDetail | null> {
  const db = getDb();
  const personal = seesPersonalInformation(actor);

  const registration = await loadRegistrationRow(id, personal);
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
  const reviewRows = await db
    .select({
      id: schema.sectionReviews.id,
      sectionKey: schema.sectionReviews.sectionKey,
      status: schema.sectionReviews.status,
      comment: schema.sectionReviews.comment,
      createdAt: schema.sectionReviews.createdAt,
      ...(personal ? { reviewerEmail: reviewer.email } : {}),
    })
    .from(schema.sectionReviews)
    .leftJoin(reviewer, eq(reviewer.id, schema.sectionReviews.reviewerId))
    .where(eq(schema.sectionReviews.registrationId, id))
    .orderBy(asc(schema.sectionReviews.createdAt));
  const reviews = reviewRows.map((r) => ({
    ...r,
    reviewerEmail:
      "reviewerEmail" in r
        ? ((r.reviewerEmail as string | null) ?? null)
        : null,
  }));

  const repliesByReview = await getSectionReviewReplies(
    reviews.map((r) => r.id),
  );

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
  if (personal && registration.decidedByUserId) {
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
      replies: repliesByReview.get(r.id) ?? [],
    })),
    supplierDeclarations,
    decidedByEmail,
    cohort: deriveCohort(group ? prior.has(group.id) : false),
  };
}

/**
 * Load the reply threads for a set of section reviews, grouped by review id.
 * Author labels resolve against the registration's edition; org-staff authors
 * collapse to "AfrikaBurn" so the review team presents as one voice, mirroring
 * the camp-side thread.
 */
async function getSectionReviewReplies(
  reviewIds: string[],
): Promise<Map<string, SectionReviewReplyRow[]>> {
  const byReview = new Map<string, SectionReviewReplyRow[]>();
  if (reviewIds.length === 0) return byReview;

  const db = getDb();
  const rows = await db
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
  if (rows.length === 0) return byReview;

  const authorIds = [
    ...new Set(
      rows.map((r) => r.authorUserId).filter((v): v is string => Boolean(v)),
    ),
  ];
  const names = new Map<string, string>();
  const orgStaff = new Set<string>();
  if (authorIds.length > 0) {
    const authors = await db
      .select({
        userId: schema.users.id,
        username: schema.users.username,
        sanitizedAt: schema.users.sanitizedAt,
      })
      .from(schema.users)
      .where(inArray(schema.users.id, authorIds));
    for (const a of authors) {
      if (a.username || a.sanitizedAt) {
        names.set(
          a.userId,
          publicMemberName(a.username, { sanitizedAt: a.sanitizedAt }),
        );
      }
    }

    const [org] = await db
      .select({ id: schema.groups.id })
      .from(schema.groups)
      .where(eq(schema.groups.kind, "org"))
      .limit(1);
    if (org) {
      const orgMembers = await db
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
  }

  for (const r of rows) {
    const isOrg = r.authorUserId ? orgStaff.has(r.authorUserId) : false;
    const authorName = isOrg
      ? "AfrikaBurn"
      : ((r.authorUserId ? names.get(r.authorUserId) : null) ??
        "A camp member");
    const list = byReview.get(r.reviewId) ?? [];
    list.push({
      id: r.id,
      authorUserId: r.authorUserId,
      authorName,
      isOrg,
      body: r.body,
      createdAt: r.createdAt,
    });
    byReview.set(r.reviewId, list);
  }
  return byReview;
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
 *
 * The consent an officer gave was to AfrikaBurn's SAFETY AND OPS people holding
 * their number, which is not everyone who can open the console: a caller without
 * `read_personal_information` gets the officer roster (who holds which post —
 * that IS the coverage answer) with neither email nor phone selected.
 */
export async function getRegistrationOfficers(
  groupId: string,
  editionId: string,
  actor: OrgActor,
): Promise<OfficerContactRow[]> {
  const db = getDb();
  const personal = seesPersonalInformation(actor);
  const rows = await db
    .select({
      officerKey: schema.projectRoles.officerKey,
      officerName: schema.projectRoles.name,
      emoji: schema.projectRoles.emoji,
      consent: schema.memberRoleAssignments.consentStatus,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
      ...(personal
        ? {
            bioEmail: schema.burnerBios.contactEmail,
            phone: schema.burnerBios.phone,
            userEmail: schema.users.email,
          }
        : {}),
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
    displayName: publicMemberName(r.username, { sanitizedAt: r.sanitizedAt }),
    email:
      "bioEmail" in r
        ? ((r.bioEmail as string | null) ??
          (r.userEmail as string | null) ??
          null)
        : null,
    phone: "phone" in r ? ((r.phone as string | null) ?? null) : null,
    consent: r.consent,
  }));
}

export interface RosterMemberRow {
  userId: string;
  displayName: string;
  role: MembershipRole;
}

/**
 * A camp/project's member roster for the review screen. It carries NOTHING
 * medical — not the notes, and not a has/has-not flag either.
 *
 * The flag mattered as much as the notes: the FACT that a named person has
 * declared a health condition is itself special personal information (POPIA
 * s26/27), and rendering it down forty rows hands a reviewer a complete census
 * of who has disclosed — in one un-audited page load. That is exactly the
 * casual bulk exposure AGENTS.md forbids ("never in a list, roster, card or
 * export — only on a member's DETAIL view, because casual bulk exposure is a
 * different risk from purposeful access"), and the detail view is where the
 * `bio.medical.view` audit row gets written. A signpost is a list read with no
 * trail, so the query deliberately never selects `medical_notes` at all —
 * there is nothing here for a future edit to leak.
 *
 * Enforced by `lib/__tests__/roster-privacy.test.ts`.
 */
export async function getRegistrationRoster(
  groupId: string,
): Promise<RosterMemberRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      userId: schema.memberships.userId,
      role: schema.memberships.role,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.groupId, groupId))
    .orderBy(asc(schema.users.username));

  return rows.map((r) => ({
    userId: r.userId,
    displayName: publicMemberName(r.username, { sanitizedAt: r.sanitizedAt }),
    role: r.role,
  }));
}

/** One member's DETAIL row for the org console — the only org surface that
 * resolves medical notes, and one subject at a time. */
export interface RosterMemberDetail {
  userId: string;
  displayName: string;
  role: MembershipRole;
  /** Decrypted medical notes, or null when the burner recorded none. */
  medicalNotes: string | null;
}

/**
 * A single camp member's detail for the org console. Medical notes are decrypted
 * HERE and nowhere else on the org side — the caller must have cleared
 * `guardConsole` (god / org_staff) and must record the read. `decryptOrNull`
 * yields null when no key is configured, exactly as the owner's own read does.
 *
 * `includeMedicalNotes` is the AUTHORISATION, passed in rather than assumed: the
 * caller runs `canViewMedicalNotes` first and this function neither selects nor
 * decrypts the column when the answer is no. Deciding after the decrypt — the
 * shape this replaced — left plaintext sitting in render scope behind nothing
 * but a conditional, which is one careless `<pre>{JSON.stringify(member)}</pre>`
 * away from shipping it in the RSC payload. `apps/web`'s resolver has always
 * ordered it this way; now both sides match.
 */
export async function getRosterMemberDetail(
  groupId: string,
  editionId: string,
  userId: string,
  options: { includeMedicalNotes: boolean },
): Promise<RosterMemberDetail | null> {
  const db = getDb();
  const [row] = await db
    .select({
      userId: schema.memberships.userId,
      role: schema.memberships.role,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
      ...(options.includeMedicalNotes
        ? { medicalNotes: schema.burnerBios.medicalNotes }
        : {}),
    })
    .from(schema.memberships)
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
        eq(schema.memberships.userId, userId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const ciphertext =
    "medicalNotes" in row ? (row.medicalNotes as string | null) : null;
  return {
    userId: row.userId,
    displayName: publicMemberName(row.username, {
      sanitizedAt: row.sanitizedAt,
    }),
    role: row.role,
    medicalNotes: options.includeMedicalNotes
      ? decryptOrNull(ciphertext)
      : null,
  };
}

export interface DecisionLogRow {
  id: string;
  action: string;
  actorEmail: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * Decision history for a registration (audit_events on this subject). WHAT was
 * decided and when is org record; WHO decided it is a staff member's email, so
 * it is only selected for a caller who may read personal information — the
 * history still reads, attributed to "Staff".
 */
export async function getRegistrationDecisionLog(
  registrationId: string,
  actor: OrgActor,
): Promise<DecisionLogRow[]> {
  const db = getDb();
  const personal = seesPersonalInformation(actor);
  const rows = await db
    .select({
      id: schema.auditEvents.id,
      action: schema.auditEvents.action,
      meta: schema.auditEvents.meta,
      createdAt: schema.auditEvents.createdAt,
      ...(personal ? { actorEmail: schema.users.email } : {}),
    })
    .from(schema.auditEvents)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditEvents.actorId))
    .where(eq(schema.auditEvents.subject, registrationId))
    .orderBy(desc(schema.auditEvents.createdAt));
  return rows.map((r) => ({
    ...r,
    actorEmail:
      "actorEmail" in r ? ((r.actorEmail as string | null) ?? null) : null,
  }));
}

export interface SupplierOverviewRow {
  id: string;
  name: string;
  services: string | null;
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
 *
 * `contact` is a named human at that business with their phone or address, so it
 * needs `read_personal_information`. Worth noticing: nothing on this screen
 * RENDERS it — it was being selected and shipped in the payload for a column
 * that does not exist. Exactly the leak the header warns about, and the reason
 * the rule is enforced at the select rather than in the JSX.
 */
export async function getSuppliersOverview(
  editionId: string | null,
): Promise<SupplierOverviewRow[]> {
  const db = getDb();
  // NOTE: `suppliers.contact` is deliberately NOT selected for ANY rank, which
  // is why this query takes no rank decision at all. The table renders no
  // contact column, so withholding it from engineers alone still shipped a
  // supplier's contact details in the RSC payload of every staff and god page
  // load, for nothing. A field nobody renders should not be fetched.

  const rows = await db
    .select({
      id: schema.suppliers.id,
      name: schema.suppliers.name,
      services: schema.suppliers.services,
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
    contact: "contact" in r ? ((r.contact as string | null) ?? null) : null,
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

/** Org-internal notes timeline for a supplier, newest first. The note bodies are
 * org record about a BUSINESS and every rank reads them; the author's email is a
 * staff member's, so it needs `read_personal_information`. */
export async function getSupplierNotes(
  supplierId: string,
  actor: OrgActor,
): Promise<SupplierNoteRow[]> {
  const db = getDb();
  const personal = seesPersonalInformation(actor);
  const rows = await db
    .select({
      id: schema.supplierNotes.id,
      kind: schema.supplierNotes.kind,
      body: schema.supplierNotes.body,
      createdAt: schema.supplierNotes.createdAt,
      ...(personal ? { authorEmail: schema.users.email } : {}),
    })
    .from(schema.supplierNotes)
    .leftJoin(schema.users, eq(schema.users.id, schema.supplierNotes.authorId))
    .where(eq(schema.supplierNotes.supplierId, supplierId))
    .orderBy(desc(schema.supplierNotes.createdAt));
  return rows.map((r) => ({
    ...r,
    authorEmail:
      "authorEmail" in r ? ((r.authorEmail as string | null) ?? null) : null,
  }));
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
