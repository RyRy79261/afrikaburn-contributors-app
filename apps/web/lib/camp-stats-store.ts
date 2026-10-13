import "server-only";

import { and, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { activeMembership, formerMembership } from "@quagga/db";
import {
  buildCampStats,
  CAMP_STATS_GROUP_KINDS,
  buildMemberParticipation,
  campStatsToday,
  canManageWorkAccessPasses,
  canViewActivationResults,
  canViewCampStats,
  canViewMemberParticipation,
  defaultPrivacyFlags,
  participationBioView,
  type BurnerBioFields,
  type CampStatsView,
  type CampmateContext,
  type MemberParticipation,
  type RosterAccessContext,
} from "@quagga/core";
import type { CampTenure, GroupKind, WapListStatus } from "@quagga/types";
import { db, schema } from "./db";
import { getMemberPermissions } from "./roles-store";
import { loadCampTenure } from "./camp-tenure";
import { listOnboardingsForEdition } from "./onboarding-store";
import { loadCampmateMemberships } from "./campmates-store";

// Camp statistics read paths (docs/camp-stats-spec.md). EVERY decision is a
// @quagga/core predicate — `canViewCampStats` / `canViewMemberParticipation`,
// both resting on the roster's `canViewCampRoster` — and every figure is
// derived in core. This module loads the facts, from the database, never from
// the request:
//
//   · the group by slug, and the viewer's permission membership OF THAT GROUP
//     (null for a non-member, which is how a lead of camp A gets nothing for
//     camp B);
//   · ONLY after the predicate said yes: the rows, in a handful of set-based
//     queries over the whole camp — never one query per member.
//
// WHAT IS NEVER SELECTED. No query here names a phone, an emergency contact,
// an ID column or medical notes. The camp page reads bio COMPLETION and the
// first-time flag only (as the roster card does). The participation summary
// reads the subject's skills and attended years together with their privacy
// flags, and core projects them through the profile page's own rule — so a
// field the member keeps private is never shown here either.
//
// WHO COUNTS. Current members (`activeMembership()`); former members only as a
// count of former; deleted (sanitised) accounts nowhere — the queries carry
// `sanitized_at` and core drops them, and the shift and pass counts exclude
// them in SQL.
//
// Refusals come back as `null`; the pages turn a null into the camp's
// ordinary not-found, so the stats page is no oracle for which camps exist.

interface StatsGroup {
  id: string;
  name: string;
  slug: string;
  kind: GroupKind;
}

/** The edition the page describes (the active one). */
export interface StatsEdition {
  id: string;
  year: number;
  startDate: string;
  endDate: string;
}

async function groupBySlug(slug: string): Promise<StatsGroup | null> {
  const [group] = await db()
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      slug: schema.groups.slug,
      kind: schema.groups.kind,
    })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  if (!group || group.kind === "org") return null;
  return group;
}

async function loadAccess(
  slug: string,
  viewerUserId: string,
): Promise<{ group: StatsGroup; access: RosterAccessContext } | null> {
  const group = await groupBySlug(slug);
  if (!group) return null;
  const viewerMembership = await getMemberPermissions(group.id, viewerUserId);
  return { group, access: { groupKind: group.kind, viewerMembership } };
}

/** The most recent SENT onboarding of this camp this edition (drafts reach
 * nobody, so they are not "sent"), or null. */
async function latestSentOnboarding(
  groupId: string,
  editionId: string,
): Promise<{ activationId: string; title: string } | null> {
  const list = await listOnboardingsForEdition(groupId, editionId);
  const sent = list.find((o) => o.status !== "draft");
  return sent ? { activationId: sent.activationId, title: sent.title } : null;
}

// --- The camp page -----------------------------------------------------------

export interface CampStatsPage {
  camp: StatsGroup;
  edition: StatsEdition;
  stats: CampStatsView;
  /** Which of the lists behind the figures THIS viewer may open — the
   * spec's "except where a figure links to a page the viewer may already
   * open". Each is that page's own predicate; the page re-checks anyway.
   * (The roster is implied by the stats page itself; shifts are open to
   * every member.) */
  links: { onboardingResults: boolean; passes: boolean };
}

/** The pages behind the figures this viewer may open (see `links`). */
export function campStatsLinks(
  group: { id: string },
  access: RosterAccessContext,
): CampStatsPage["links"] {
  const membership = access.viewerMembership;
  return {
    onboardingResults:
      membership !== null &&
      canViewActivationResults(
        [{ groupId: group.id, role: membership.structuralRole }],
        { authoredScope: "group", groupId: group.id },
        "",
      ),
    passes: canManageWorkAccessPasses(membership),
  };
}

/**
 * The stats page for a viewer, or null when they may not see it (or there is
 * no such camp). The refusal is decided BEFORE any member row is read.
 */
export async function loadCampStats(input: {
  slug: string;
  viewerUserId: string;
  edition: StatsEdition;
  now?: Date;
}): Promise<CampStatsPage | null> {
  const loaded = await loadAccess(input.slug, input.viewerUserId);
  if (!loaded || !canViewCampStats(loaded.access)) return null;
  const { group, access } = loaded;
  const edition = input.edition;
  const handle = db();

  const [current, former, shifts, registration, onboarding] = await Promise.all(
    [
      // Current members: completion + first-time flag and this edition's
      // logistics. Never the bio's content.
      handle
        .select({
          membershipId: schema.memberships.id,
          sanitizedAt: schema.users.sanitizedAt,
          bioId: schema.burnerBios.id,
          bioCompletedAt: schema.burnerBios.completedAt,
          bioFirstTime: schema.burnerBios.firstTime,
          logisticsId: schema.membershipLogistics.id,
          joiningBuild: schema.membershipLogistics.joiningBuild,
          joiningStrike: schema.membershipLogistics.joiningStrike,
          arrivalDate: schema.membershipLogistics.arrivalDate,
          departureDate: schema.membershipLogistics.departureDate,
        })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .leftJoin(
          schema.burnerBios,
          and(
            eq(schema.burnerBios.userId, schema.memberships.userId),
            eq(schema.burnerBios.editionId, edition.id),
          ),
        )
        .leftJoin(
          schema.membershipLogistics,
          and(
            eq(schema.membershipLogistics.membershipId, schema.memberships.id),
            eq(schema.membershipLogistics.editionId, edition.id),
          ),
        )
        .where(
          and(eq(schema.memberships.groupId, group.id), activeMembership()),
        ),
      // Former members: whether each account still exists, nothing else.
      handle
        .select({ sanitizedAt: schema.users.sanitizedAt })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(
          and(eq(schema.memberships.groupId, group.id), formerMembership()),
        ),
      // This edition's shifts with their filled count — current, non-deleted
      // members only, exactly as the camp page's Shifts tile counts them.
      handle
        .select({
          date: schema.shifts.shiftDate,
          capacity: schema.shifts.capacity,
          teamId: schema.shifts.teamId,
          teamName: schema.shiftTeams.name,
          teamSort: schema.shiftTeams.sort,
          filled: sql<number>`(
            select count(*)::int from ${schema.shiftAssignments}
            inner join ${schema.memberships}
              on ${schema.memberships.id} = ${schema.shiftAssignments.membershipId}
            inner join ${schema.users}
              on ${schema.users.id} = ${schema.memberships.userId}
            where ${schema.shiftAssignments.shiftId} = ${schema.shifts.id}
              and ${schema.memberships.groupId} = ${group.id}
              and ${activeMembership()}
              and ${schema.users.sanitizedAt} is null
          )`,
        })
        .from(schema.shifts)
        .leftJoin(
          schema.shiftTeams,
          eq(schema.shiftTeams.id, schema.shifts.teamId),
        )
        .where(
          and(
            eq(schema.shifts.groupId, group.id),
            eq(schema.shifts.editionId, edition.id),
          ),
        ),
      // The registration's pass list status and its passes held by current,
      // non-deleted members.
      handle
        .select({
          id: schema.registrations.id,
          listStatus: schema.registrations.wapListStatus,
          allocated: sql<number>`(
            select count(*)::int from ${schema.wapAllocations}
            inner join ${schema.memberships}
              on ${schema.memberships.id} = ${schema.wapAllocations.membershipId}
            inner join ${schema.users}
              on ${schema.users.id} = ${schema.memberships.userId}
            where ${schema.wapAllocations.registrationId} = ${schema.registrations.id}
              and ${activeMembership()}
              and ${schema.users.sanitizedAt} is null
          )`,
        })
        .from(schema.registrations)
        // THE JOIN IS LOAD-BEARING. A drizzle select over ONE table renders
        // its columns unqualified — inside the subquery above, too — so
        // `memberships.id` and `registrations.id` both became a bare "id"
        // and Postgres refused the query as ambiguous (caught by the local
        // e2e, invisible to the mocked unit tests). Any join switches drizzle
        // to table-qualified names; this one also pins the edition.
        .innerJoin(
          schema.editions,
          eq(schema.editions.id, schema.registrations.editionId),
        )
        .where(
          and(
            eq(schema.registrations.groupId, group.id),
            eq(schema.editions.id, edition.id),
          ),
        )
        .limit(1),
      latestSentOnboarding(group.id, edition.id),
    ],
  );

  const [tenure, requests, onboardingRows] = await Promise.all([
    loadCampTenure(group.id, edition.id),
    registration[0]
      ? handle
          .select({
            requested: schema.wapRequests.requested,
            status: schema.wapRequests.status,
            granted: schema.wapRequests.granted,
          })
          .from(schema.wapRequests)
          .where(eq(schema.wapRequests.registrationId, registration[0].id))
      : Promise.resolve([]),
    onboarding
      ? handle
          .select({
            status: schema.requiredActions.status,
            openedAt: schema.onboardingProgress.openedAt,
          })
          .from(schema.requiredActions)
          .innerJoin(
            schema.memberships,
            and(
              eq(schema.memberships.userId, schema.requiredActions.userId),
              eq(schema.memberships.groupId, group.id),
              activeMembership(),
            ),
          )
          .innerJoin(
            schema.users,
            and(
              eq(schema.users.id, schema.requiredActions.userId),
              isNull(schema.users.sanitizedAt),
            ),
          )
          .leftJoin(
            schema.onboardingProgress,
            and(
              eq(
                schema.onboardingProgress.activationId,
                schema.requiredActions.activationId,
              ),
              eq(
                schema.onboardingProgress.userId,
                schema.requiredActions.userId,
              ),
            ),
          )
          .where(
            eq(schema.requiredActions.activationId, onboarding.activationId),
          )
      : Promise.resolve([]),
  ]);

  const stats = buildCampStats({
    access,
    edition: { startDate: edition.startDate, endDate: edition.endDate },
    today: campStatsToday(input.now ?? new Date()),
    current: current.map((m) => ({
      sanitized: m.sanitizedAt != null,
      tenure: tenure.get(m.membershipId) ?? ("new" as CampTenure),
      bio:
        m.bioId != null
          ? {
              completedAt: m.bioCompletedAt ?? null,
              firstTime: m.bioFirstTime ?? false,
            }
          : null,
      logistics:
        m.logisticsId != null
          ? {
              joiningBuild: m.joiningBuild ?? false,
              joiningStrike: m.joiningStrike ?? false,
              arrivalDate: m.arrivalDate ?? null,
              departureDate: m.departureDate ?? null,
            }
          : null,
    })),
    former: former.map((f) => ({ sanitized: f.sanitizedAt != null })),
    onboarding: onboarding
      ? {
          activationId: onboarding.activationId,
          title: onboarding.title,
          // Tenure is not a figure on this page; the tally only needs a value.
          rows: onboardingRows.map((r) => ({
            status: r.status,
            tenure: "new" as CampTenure,
            started: r.openedAt instanceof Date,
          })),
        }
      : null,
    shifts: shifts.map((s) => ({
      date: s.date,
      capacity: s.capacity,
      filled: Number(s.filled),
      teamId: s.teamId,
      teamName: s.teamName ?? null,
      teamSort: s.teamSort ?? null,
    })),
    passes: registration[0]
      ? {
          requests,
          allocated: Number(registration[0].allocated),
          listStatus: registration[0].listStatus,
        }
      : null,
  });
  if (!stats) return null;
  return { camp: group, edition, stats, links: campStatsLinks(group, access) };
}

// --- One member's participation ----------------------------------------------

/** Bio fields with every sensitive slot EMPTY — they are never selected, so
 * they cannot be projected. */
function participationFields(row: {
  skills: string[];
  attendedYears: number[];
}): BurnerBioFields {
  return {
    legalName: null,
    homeCity: null,
    bio: null,
    skills: row.skills,
    attendedYears: row.attendedYears,
    firstTime: false,
    contactEmail: null,
    phone: null,
    onsiteContactName: null,
    onsiteContactPhone: null,
    offsiteContactName: null,
    offsiteContactPhone: null,
    medicalNotes: null,
    idType: null,
    idNumber: null,
  };
}

/**
 * A member's participation summary for a viewer — the member themself, or a
 * roster viewer of the same camp — or null when refused (no such camp, the
 * subject is not a current member, the account is deleted, or the viewer may
 * not see it). Every refusal is decided BEFORE the subject's bio, shifts,
 * passes or onboarding are read.
 */
export async function loadMemberParticipation(input: {
  slug: string;
  viewerUserId: string;
  subjectUserId: string;
  edition: StatsEdition;
  now?: Date;
}): Promise<MemberParticipation | null> {
  const loaded = await loadAccess(input.slug, input.viewerUserId);
  if (!loaded) return null;
  const { group, access } = loaded;
  const edition = input.edition;
  const handle = db();

  const [subject] = await handle
    .select({
      membershipId: schema.memberships.id,
      role: schema.memberships.role,
      createdAt: schema.memberships.createdAt,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.groupId, group.id),
        eq(schema.memberships.userId, input.subjectUserId),
        activeMembership(),
      ),
    )
    .limit(1);
  if (
    !subject ||
    subject.sanitizedAt != null ||
    !canViewMemberParticipation({
      viewerUserId: input.viewerUserId,
      subjectUserId: input.subjectUserId,
      subjectInGroup: true,
      access,
    })
  ) {
    return null;
  }
  const isSelf = input.viewerUserId === input.subjectUserId;

  const [
    roles,
    logistics,
    editions,
    shiftSpots,
    passes,
    bioRows,
    onboarding,
    memberships,
  ] = await Promise.all([
    // Roles held now: accepted assignments, never the derived baseline.
    handle
      .select({ id: schema.projectRoles.id, name: schema.projectRoles.name })
      .from(schema.memberRoleAssignments)
      .innerJoin(
        schema.projectRoles,
        eq(schema.projectRoles.id, schema.memberRoleAssignments.projectRoleId),
      )
      .where(
        and(
          eq(schema.memberRoleAssignments.membershipId, subject.membershipId),
          eq(schema.memberRoleAssignments.consentStatus, "accepted"),
          eq(schema.projectRoles.groupId, group.id),
          ne(schema.projectRoles.kind, "baseline"),
        ),
      )
      .orderBy(schema.projectRoles.sort, schema.projectRoles.name),
    // Every edition this membership planned for (tenure), with this
    // edition's plans.
    handle
      .select({
        editionId: schema.membershipLogistics.editionId,
        year: schema.editions.year,
        joiningBuild: schema.membershipLogistics.joiningBuild,
        joiningStrike: schema.membershipLogistics.joiningStrike,
        arrivalDate: schema.membershipLogistics.arrivalDate,
        departureDate: schema.membershipLogistics.departureDate,
      })
      .from(schema.membershipLogistics)
      .innerJoin(
        schema.editions,
        eq(schema.editions.id, schema.membershipLogistics.editionId),
      )
      .where(eq(schema.membershipLogistics.membershipId, subject.membershipId)),
    handle
      .select({ year: schema.editions.year, endDate: schema.editions.endDate })
      .from(schema.editions),
    // Spots held on this camp's shifts, every edition, days already passed.
    handle
      .select({
        date: schema.shifts.shiftDate,
        editionYear: schema.editions.year,
      })
      .from(schema.shiftAssignments)
      .innerJoin(
        schema.shifts,
        eq(schema.shifts.id, schema.shiftAssignments.shiftId),
      )
      .innerJoin(
        schema.editions,
        eq(schema.editions.id, schema.shifts.editionId),
      )
      .where(
        and(
          eq(schema.shiftAssignments.membershipId, subject.membershipId),
          eq(schema.shifts.groupId, group.id),
          lt(schema.shifts.shiftDate, campStatsToday(input.now ?? new Date())),
        ),
      ),
    // The camp's pass lists this membership is on, every edition.
    handle
      .select({
        year: schema.editions.year,
        listStatus: schema.registrations.wapListStatus,
      })
      .from(schema.wapAllocations)
      .innerJoin(
        schema.registrations,
        eq(schema.registrations.id, schema.wapAllocations.registrationId),
      )
      .innerJoin(
        schema.editions,
        eq(schema.editions.id, schema.registrations.editionId),
      )
      .where(
        and(
          eq(schema.wapAllocations.membershipId, subject.membershipId),
          eq(schema.registrations.groupId, group.id),
        ),
      ),
    // The two bio fields the summary shows, with the flags that decide who
    // sees them. Nothing else from the bio.
    handle
      .select({
        skills: schema.burnerBios.skills,
        attendedYears: schema.burnerBios.attendedYears,
        privacyFlags: schema.burnerBios.privacyFlags,
        completedAt: schema.burnerBios.completedAt,
      })
      .from(schema.burnerBios)
      .where(
        and(
          eq(schema.burnerBios.userId, input.subjectUserId),
          eq(schema.burnerBios.editionId, edition.id),
        ),
      )
      .limit(1),
    latestSentOnboarding(group.id, edition.id),
    isSelf
      ? Promise.resolve(null)
      : loadCampmateMemberships([input.viewerUserId, input.subjectUserId]),
  ]);

  const [onboardingRow] = onboarding
    ? await handle
        .select({
          status: schema.requiredActions.status,
          openedAt: schema.onboardingProgress.openedAt,
        })
        .from(schema.requiredActions)
        .leftJoin(
          schema.onboardingProgress,
          and(
            eq(
              schema.onboardingProgress.activationId,
              schema.requiredActions.activationId,
            ),
            eq(schema.onboardingProgress.userId, schema.requiredActions.userId),
          ),
        )
        .where(
          and(
            eq(schema.requiredActions.activationId, onboarding.activationId),
            eq(schema.requiredActions.userId, input.subjectUserId),
          ),
        )
        .limit(1)
    : [];

  const ctx: CampmateContext = {
    viewerUserId: input.viewerUserId,
    subjectUserId: input.subjectUserId,
    viewerMemberships: memberships?.get(input.viewerUserId) ?? [],
    subjectMemberships: memberships?.get(input.subjectUserId) ?? [],
  };
  const bioRow = bioRows[0];
  const bio = participationBioView({
    ctx,
    bio: bioRow
      ? {
          fields: participationFields(bioRow),
          privacyFlags: {
            ...defaultPrivacyFlags(),
            ...(bioRow.privacyFlags ?? {}),
          },
          confirmed: bioRow.completedAt != null,
        }
      : null,
  });

  const thisEditionPlans = logistics.find((l) => l.editionId === edition.id);
  const thisEditionPass = passes.find((p) => p.year === edition.year);

  return buildMemberParticipation({
    viewerUserId: input.viewerUserId,
    access,
    subject: {
      userId: input.subjectUserId,
      inGroup: true,
      sanitized: false,
      structuralRole: subject.role,
      projectRoles: roles,
      membershipCreatedAt: subject.createdAt,
    },
    bio,
    edition: { year: edition.year },
    editions,
    logisticsEditionYears: logistics.map((l) => l.year),
    logistics: thisEditionPlans
      ? {
          joiningBuild: thisEditionPlans.joiningBuild,
          joiningStrike: thisEditionPlans.joiningStrike,
          arrivalDate: thisEditionPlans.arrivalDate ?? null,
          departureDate: thisEditionPlans.departureDate ?? null,
        }
      : null,
    shifts: shiftSpots,
    today: campStatsToday(input.now ?? new Date()),
    onboarding: onboardingRow
      ? {
          status: onboardingRow.status,
          started: onboardingRow.openedAt instanceof Date,
        }
      : null,
    passes: {
      thisEdition: (thisEditionPass?.listStatus ??
        null) as WapListStatus | null,
      earlierYears: passes
        .filter((p) => p.year < edition.year)
        .map((p) => p.year),
    },
  });
}

// --- On a burner's profile ---------------------------------------------------

export interface ProfileParticipation {
  camp: { name: string; slug: string };
  participation: MemberParticipation;
}

/**
 * The participation blocks a burner's profile shows THIS viewer (frame C2):
 * one per theme camp the subject is a current member of AND the viewer may
 * open the roster of. Anyone else — a plain camp-mate, a lead of another
 * camp, a stranger — gets an empty list. The member's own summary lives on
 * the camp page ("Your participation"), so a plain member viewing their own
 * profile gets nothing here either; a lead viewing their own does, as a roster
 * viewer of their camp.
 *
 * The camps are found in ONE query (both people's active memberships of the
 * same theme camp); each is then decided by `canViewCampStats` before
 * `loadMemberParticipation` (which re-checks) reads anything about the
 * subject. A burner shares a camp with a viewer once in nearly every case, so
 * the per-camp read is bounded by that overlap, never by camp size.
 */
export async function loadProfileParticipation(input: {
  viewerUserId: string;
  subjectUserId: string;
  edition: StatsEdition;
  now?: Date;
}): Promise<ProfileParticipation[]> {
  // The viewer's side of the shared camp. Its archivedAt filter is in the
  // join below: a former member of the camp shares nothing with anyone.
  const viewerMs = alias(schema.memberships, "viewer_membership");
  const shared = await db()
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      slug: schema.groups.slug,
      kind: schema.groups.kind,
    })
    .from(schema.memberships)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.memberships.groupId))
    .innerJoin(
      viewerMs,
      and(
        eq(viewerMs.groupId, schema.memberships.groupId),
        eq(viewerMs.userId, input.viewerUserId),
        isNull(viewerMs.archivedAt),
      ),
    )
    .where(
      and(
        eq(schema.memberships.userId, input.subjectUserId),
        activeMembership(),
        inArray(schema.groups.kind, [...CAMP_STATS_GROUP_KINDS]),
      ),
    )
    .orderBy(schema.groups.name);

  const blocks: ProfileParticipation[] = [];
  for (const group of shared) {
    const viewerMembership = await getMemberPermissions(
      group.id,
      input.viewerUserId,
    );
    if (!canViewCampStats({ groupKind: group.kind, viewerMembership })) {
      continue;
    }
    const participation = await loadMemberParticipation({
      slug: group.slug,
      viewerUserId: input.viewerUserId,
      subjectUserId: input.subjectUserId,
      edition: input.edition,
      now: input.now,
    });
    if (participation) {
      blocks.push({
        camp: { name: group.name, slug: group.slug },
        participation,
      });
    }
  }
  return blocks;
}
