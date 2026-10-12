import "server-only";

import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  effectiveWapPass,
  isBioComplete,
  legacyWapAsk,
  pendingWapRequest,
  publicMemberName,
  summariseWapProject,
  totalWapGranted,
  WAP_PROJECT_KINDS,
  wapChangesSinceApproval,
  wapDuplicateHolders,
  wapPassFlags,
  wapRequestWindowState,
  wapSinceApprovalBadge,
  type EffectiveWapPass,
  type MemberLogistics,
  type WapChangesSinceApproval,
  type WapHolding,
  type WapPassFlag,
  type WapProjectSummary,
  type WapWindowState,
} from "@quagga/core";
import type {
  GroupKind,
  RegistrationStatus,
  WapApprovedPass,
  WapListStatus,
  WapRequestStatus,
} from "@quagga/types";
import { activeMembership } from "@quagga/db";

import { getDb, schema, type DbHandle } from "./db";

// Work Access Passes, the ORG side (epic #53, docs/wap-spec.md, frames W2 and
// W3). Every rule is a pure @quagga/core function
// (packages/core/src/work-access-passes.ts); this file loads the facts those
// functions read. The writes are lib/actions/wap.ts.
//
// WHO MAY CALL WHAT is decided by the caller, never here:
//   · names (the review panel, the overview) — `read` on `registrations`;
//   · email (`withEmail`, the CSV only) — `personal_information` on
//     `registrations`. Without it the column is not even SELECTED.
//
// PRIVACY. Nothing here reads a hard-locked field (phone, emergency contacts,
// SA ID, passport) or medical notes. The bio is read for its completion stamp
// only. The export row type in @quagga/core has no slot for any of them.
//
// "Also has a pass from {project}" names the other project, a free camp
// included — the decided exception (AGENTS.md, under the free-camp law). The
// org reviewer is the other audience the spec names for it; it is computed
// only by `wapDuplicateHolders`, only for people on the list being shown.
//
// A LIVE PASS is one whose membership is current (not archived) and whose
// account is not sanitised — the same rule the lead's page uses
// (apps/web/lib/wap-store.ts). Archiving and account erasure delete the row
// anyway; the filter is belt and braces, and it keeps the org's count and the
// lead's count the same number.

// --- The request window ------------------------------------------------------

export interface WapWindowView {
  state: WapWindowState;
  openedAt: Date | null;
  closedAt: Date | null;
}

export async function getWapWindow(
  editionId: string,
  now: Date = new Date(),
): Promise<WapWindowView> {
  const [row] = await getDb()
    .select({
      wapRequestsOpenAt: schema.editions.wapRequestsOpenAt,
      wapRequestsCloseAt: schema.editions.wapRequestsCloseAt,
    })
    .from(schema.editions)
    .where(eq(schema.editions.id, editionId))
    .limit(1);
  const facts = row ?? { wapRequestsOpenAt: null, wapRequestsCloseAt: null };
  return {
    state: wapRequestWindowState(facts, now),
    openedAt: facts.wapRequestsOpenAt,
    closedAt: facts.wapRequestsCloseAt,
  };
}

// --- Passes ------------------------------------------------------------------

/** One live pass, as every org surface reads it. */
export interface OrgWapPass {
  allocationId: string;
  registrationId: string;
  membershipId: string;
  userId: string;
  displayName: string;
  username: string | null;
  /** Only when the caller asked for it (`withEmail`) — the CSV. */
  email: string | null;
  effective: EffectiveWapPass;
  flags: WapPassFlag[];
}

function planFrom(r: {
  logisticsId: string | null;
  joiningBuild: boolean | null;
  joiningStrike: boolean | null;
  arrivalDate: string | null;
  departureDate: string | null;
}): MemberLogistics | null {
  return r.logisticsId != null
    ? {
        joiningBuild: r.joiningBuild ?? false,
        joiningStrike: r.joiningStrike ?? false,
        arrivalDate: r.arrivalDate ?? null,
        departureDate: r.departureDate ?? null,
      }
    : null;
}

/**
 * Every live pass in the edition — or, with `registrationId`, on one list —
 * with its effective dates and its flags. `withEmail` adds the account email
 * to the SELECT; the caller must already hold `personal_information` on
 * `registrations`. `flags: false` skips the two flag queries (the approval
 * snapshot needs only the values).
 */
export async function readWapPasses(
  handle: DbHandle,
  editionId: string,
  options: {
    registrationId?: string;
    withEmail?: boolean;
    flags?: boolean;
  } = {},
): Promise<OrgWapPass[]> {
  const withFlags = options.flags !== false;
  const rows = await handle
    .select({
      allocationId: schema.wapAllocations.id,
      registrationId: schema.wapAllocations.registrationId,
      membershipId: schema.wapAllocations.membershipId,
      overrideArrival: schema.wapAllocations.arrivalDate,
      overrideDeparture: schema.wapAllocations.departureDate,
      overrideBuild: schema.wapAllocations.build,
      overrideStrike: schema.wapAllocations.strike,
      userId: schema.memberships.userId,
      groupId: schema.registrations.groupId,
      firstArrival: schema.registrations.s4FirstArrivalDate,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
      ...(options.withEmail ? { email: schema.users.email } : {}),
      bioCompletedAt: schema.burnerBios.completedAt,
      logisticsId: schema.membershipLogistics.id,
      joiningBuild: schema.membershipLogistics.joiningBuild,
      joiningStrike: schema.membershipLogistics.joiningStrike,
      arrivalDate: schema.membershipLogistics.arrivalDate,
      departureDate: schema.membershipLogistics.departureDate,
    })
    .from(schema.wapAllocations)
    .innerJoin(
      schema.registrations,
      eq(schema.registrations.id, schema.wapAllocations.registrationId),
    )
    .innerJoin(
      schema.memberships,
      eq(schema.memberships.id, schema.wapAllocations.membershipId),
    )
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .leftJoin(
      schema.burnerBios,
      and(
        eq(schema.burnerBios.userId, schema.memberships.userId),
        eq(schema.burnerBios.editionId, editionId),
      ),
    )
    .leftJoin(
      schema.membershipLogistics,
      and(
        eq(schema.membershipLogistics.membershipId, schema.memberships.id),
        eq(schema.membershipLogistics.editionId, editionId),
      ),
    )
    .where(
      and(
        eq(schema.registrations.editionId, editionId),
        options.registrationId
          ? eq(schema.wapAllocations.registrationId, options.registrationId)
          : undefined,
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    )
    .orderBy(asc(schema.wapAllocations.createdAt));

  const userIds = [...new Set(rows.map((r) => r.userId))];

  let unfinished = new Set<string>();
  let holdings: WapHolding[] = [];
  if (withFlags && userIds.length > 0) {
    [unfinished, holdings] = await Promise.all([
      readOnboardingUnfinished(handle, editionId, userIds),
      readHoldings(handle, editionId, userIds),
    ]);
  }

  // Duplicate holders, computed per list: each list sees only its own people.
  const byRegistration = new Map<string, string[]>();
  for (const r of rows) {
    const list = byRegistration.get(r.registrationId) ?? [];
    list.push(r.userId);
    byRegistration.set(r.registrationId, list);
  }
  const others = new Map<string, Map<string, string[]>>();
  for (const [registrationId, listUserIds] of byRegistration) {
    others.set(
      registrationId,
      wapDuplicateHolders(registrationId, listUserIds, holdings),
    );
  }

  return rows.map((r) => {
    const overrides = {
      arrivalDate: r.overrideArrival,
      departureDate: r.overrideDeparture,
      build: r.overrideBuild,
      strike: r.overrideStrike,
    };
    const plan = planFrom(r);
    return {
      allocationId: r.allocationId,
      registrationId: r.registrationId,
      membershipId: r.membershipId,
      userId: r.userId,
      displayName: publicMemberName(r.username, {
        sanitizedAt: r.sanitizedAt,
      }),
      username: r.username,
      email:
        "email" in r && typeof r.email === "string" && r.email ? r.email : null,
      effective: effectiveWapPass(overrides, plan, r.firstArrival),
      flags: withFlags
        ? wapPassFlags({
            bioComplete: isBioComplete({
              completedAt: r.bioCompletedAt ?? null,
            }),
            onboardingUnfinished: unfinished.has(`${r.userId}:${r.groupId}`),
            otherProjects: others.get(r.registrationId)?.get(r.userId) ?? [],
          })
        : [],
    };
  });
}

/** `${userId}:${groupId}` for every unfinished SENT onboarding of a project. */
async function readOnboardingUnfinished(
  handle: DbHandle,
  editionId: string,
  userIds: readonly string[],
): Promise<Set<string>> {
  const rows = await handle
    .selectDistinct({
      userId: schema.requiredActions.userId,
      groupId: schema.questionnaireActivations.groupId,
    })
    .from(schema.requiredActions)
    .innerJoin(
      schema.questionnaireActivations,
      eq(
        schema.questionnaireActivations.id,
        schema.requiredActions.activationId,
      ),
    )
    .where(
      and(
        inArray(schema.requiredActions.userId, [...userIds]),
        eq(schema.requiredActions.status, "pending"),
        eq(schema.questionnaireActivations.editionId, editionId),
        eq(schema.questionnaireActivations.authoredScope, "group"),
        ne(schema.questionnaireActivations.status, "draft"),
        sql`${schema.questionnaireActivations.definition} ->> 'preset' = 'onboarding'`,
      ),
    );
  return new Set(rows.map((r) => `${r.userId}:${r.groupId}`));
}

/** Every live pass this edition held by these people: who, which list, and
 * that project's NAME — nothing else about it is read. */
async function readHoldings(
  handle: DbHandle,
  editionId: string,
  userIds: readonly string[],
): Promise<WapHolding[]> {
  return handle
    .select({
      userId: schema.memberships.userId,
      registrationId: schema.registrations.id,
      projectName: schema.groups.name,
    })
    .from(schema.wapAllocations)
    .innerJoin(
      schema.memberships,
      eq(schema.memberships.id, schema.wapAllocations.membershipId),
    )
    .innerJoin(
      schema.registrations,
      eq(schema.registrations.id, schema.wapAllocations.registrationId),
    )
    .innerJoin(
      schema.groups,
      eq(schema.groups.id, schema.registrations.groupId),
    )
    .where(
      and(
        inArray(schema.memberships.userId, [...userIds]),
        eq(schema.registrations.editionId, editionId),
        activeMembership(),
      ),
    );
}

/** The snapshot an approval stores, from the passes as they stand. */
export function wapCurrentPasses(passes: readonly OrgWapPass[]) {
  return passes.map((p) => ({
    membershipId: p.membershipId,
    userId: p.userId,
    arrivalDate: p.effective.arrivalDate,
    departureDate: p.effective.departureDate,
    build: p.effective.build,
    strike: p.effective.strike,
  }));
}

// --- The review panel (W2) -----------------------------------------------------

export interface OrgWapRequestView {
  id: string;
  requested: number;
  reason: string | null;
  status: WapRequestStatus;
  granted: number | null;
  requestedByName: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export interface WapReview {
  registration: {
    id: string;
    status: RegistrationStatus;
    decidedAt: Date | null;
    editionId: string;
  };
  group: { id: string; name: string; kind: GroupKind; slug: string };
  edition: { id: string; name: string };
  memberCount: number;
  requests: OrgWapRequestView[];
  pending: OrgWapRequestView | null;
  /** Granted requests before the pending one exist — "Asks for N more". */
  pendingIsTopUp: boolean;
  totalGranted: number;
  /** "Asked at registration: N" — the old form's number, or null. */
  legacyAsk: number | null;
  list: {
    status: WapListStatus;
    submittedAt: Date | null;
    submittedByName: string | null;
    reviewedAt: Date | null;
    reviewedByName: string | null;
    returnNote: string | null;
    approvedAt: Date | null;
    /** "Changed since approval" / "1 removed since approval", or null. */
    badge: string | null;
  };
  passes: OrgWapPass[];
  changes: WapChangesSinceApproval;
  /** Names for the people in `changes.removed` (they are off the list). */
  removedNames: Map<string, string>;
}

async function namesFor(
  handle: DbHandle,
  userIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((u): u is string => Boolean(u)))];
  if (ids.length === 0) return new Map();
  const rows = await handle
    .select({
      id: schema.users.id,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, ids));
  return new Map(
    rows.map((u) => [
      u.id,
      publicMemberName(u.username, { sanitizedAt: u.sanitizedAt }),
    ]),
  );
}

/**
 * Everything the Work Access Passes panel of one registration renders. Null
 * when the registration does not exist or is not a pass-holding project. The
 * caller must already have decided the viewer holds `read` on
 * `registrations`: this returns names.
 */
export async function loadWapReview(
  registrationId: string,
): Promise<WapReview | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: schema.registrations.id,
      status: schema.registrations.status,
      decidedAt: schema.registrations.decidedAt,
      editionId: schema.registrations.editionId,
      legacy: schema.registrations.s4WorkAccessPasses,
      listStatus: schema.registrations.wapListStatus,
      submittedAt: schema.registrations.wapListSubmittedAt,
      submittedBy: schema.registrations.wapListSubmittedByUserId,
      reviewedAt: schema.registrations.wapListReviewedAt,
      reviewedBy: schema.registrations.wapListReviewedByUserId,
      returnNote: schema.registrations.wapListReturnNote,
      approvedAt: schema.registrations.wapListApprovedAt,
      snapshot: schema.registrations.wapListApprovedSnapshot,
      groupId: schema.groups.id,
      groupName: schema.groups.name,
      groupKind: schema.groups.kind,
      groupSlug: schema.groups.slug,
      editionName: schema.editions.name,
    })
    .from(schema.registrations)
    .innerJoin(
      schema.groups,
      eq(schema.groups.id, schema.registrations.groupId),
    )
    .innerJoin(
      schema.editions,
      eq(schema.editions.id, schema.registrations.editionId),
    )
    .where(eq(schema.registrations.id, registrationId))
    .limit(1);
  if (!row || !WAP_PROJECT_KINDS.includes(row.groupKind)) return null;

  const [requestRows, passes, memberCountRows] = await Promise.all([
    db
      .select({
        id: schema.wapRequests.id,
        requested: schema.wapRequests.requested,
        reason: schema.wapRequests.reason,
        status: schema.wapRequests.status,
        granted: schema.wapRequests.granted,
        createdAt: schema.wapRequests.createdAt,
        decidedAt: schema.wapRequests.decidedAt,
        requestedBy: schema.wapRequests.requestedByUserId,
      })
      .from(schema.wapRequests)
      .where(eq(schema.wapRequests.registrationId, registrationId))
      .orderBy(desc(schema.wapRequests.createdAt)),
    readWapPasses(db, row.editionId, { registrationId }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.groupId, row.groupId), activeMembership()),
      ),
  ]);

  const changes = wapChangesSinceApproval(
    row.snapshot as readonly WapApprovedPass[] | null,
    wapCurrentPasses(passes),
  );
  const names = await namesFor(db, [
    ...requestRows.map((r) => r.requestedBy),
    row.submittedBy,
    row.reviewedBy,
    ...changes.removed.map((p) => p.userId),
  ]);

  const requests: OrgWapRequestView[] = requestRows.map((r) => ({
    id: r.id,
    requested: r.requested,
    reason: r.reason,
    status: r.status,
    granted: r.granted,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    requestedByName: r.requestedBy ? (names.get(r.requestedBy) ?? null) : null,
  }));
  const pending = pendingWapRequest(requests);

  return {
    registration: {
      id: row.id,
      status: row.status,
      decidedAt: row.decidedAt,
      editionId: row.editionId,
    },
    group: {
      id: row.groupId,
      name: row.groupName,
      kind: row.groupKind,
      slug: row.groupSlug,
    },
    edition: { id: row.editionId, name: row.editionName },
    memberCount: memberCountRows[0]?.count ?? 0,
    requests,
    pending,
    pendingIsTopUp:
      pending !== null && requests.some((r) => r.status === "granted"),
    totalGranted: totalWapGranted(requests),
    legacyAsk: legacyWapAsk(row.legacy),
    list: {
      status: row.listStatus,
      submittedAt: row.submittedAt,
      submittedByName: row.submittedBy
        ? (names.get(row.submittedBy) ?? null)
        : null,
      reviewedAt: row.reviewedAt,
      reviewedByName: row.reviewedBy
        ? (names.get(row.reviewedBy) ?? null)
        : null,
      returnNote: row.returnNote,
      approvedAt: row.approvedAt,
      badge: wapSinceApprovalBadge(row.listStatus, changes),
    },
    passes,
    changes,
    removedNames: names,
  };
}

// --- The overview (W3) --------------------------------------------------------

/**
 * One summary row per project in the edition that has asked for passes at
 * least once. A project that never asked has nothing to show on this page —
 * it is still on the registrations pipeline.
 */
export async function loadWapOverview(
  editionId: string,
): Promise<WapProjectSummary[]> {
  const db = getDb();
  const [requestRows, allocationCounts] = await Promise.all([
    db
      .select({
        registrationId: schema.wapRequests.registrationId,
        requested: schema.wapRequests.requested,
        status: schema.wapRequests.status,
        granted: schema.wapRequests.granted,
        projectName: schema.groups.name,
        groupKind: schema.groups.kind,
        listStatus: schema.registrations.wapListStatus,
      })
      .from(schema.wapRequests)
      .innerJoin(
        schema.registrations,
        eq(schema.registrations.id, schema.wapRequests.registrationId),
      )
      .innerJoin(
        schema.groups,
        eq(schema.groups.id, schema.registrations.groupId),
      )
      .where(eq(schema.registrations.editionId, editionId)),
    // Live passes only — the same rule as `readWapPasses`.
    db
      .select({
        registrationId: schema.wapAllocations.registrationId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.wapAllocations)
      .innerJoin(
        schema.registrations,
        eq(schema.registrations.id, schema.wapAllocations.registrationId),
      )
      .innerJoin(
        schema.memberships,
        eq(schema.memberships.id, schema.wapAllocations.membershipId),
      )
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(
        and(
          eq(schema.registrations.editionId, editionId),
          activeMembership(),
          isNull(schema.users.sanitizedAt),
        ),
      )
      .groupBy(schema.wapAllocations.registrationId),
  ]);

  return summariseWapOverviewRows(requestRows, allocationCounts);
}

/** Group the overview's flat request rows into one summary per project. Pure. */
export function summariseWapOverviewRows(
  requestRows: readonly {
    registrationId: string;
    requested: number;
    status: WapRequestStatus;
    granted: number | null;
    projectName: string;
    groupKind: GroupKind;
    listStatus: WapListStatus;
  }[],
  allocationCounts: readonly { registrationId: string; count: number }[],
): WapProjectSummary[] {
  const allocated = new Map(
    allocationCounts.map((a) => [a.registrationId, Number(a.count)]),
  );
  const byRegistration = new Map<
    string,
    {
      projectName: string;
      groupKind: GroupKind;
      listStatus: WapListStatus;
      requests: {
        requested: number;
        status: WapRequestStatus;
        granted: number | null;
      }[];
    }
  >();
  for (const r of requestRows) {
    const entry = byRegistration.get(r.registrationId) ?? {
      projectName: r.projectName,
      groupKind: r.groupKind,
      listStatus: r.listStatus,
      requests: [],
    };
    entry.requests.push({
      requested: r.requested,
      status: r.status,
      granted: r.granted,
    });
    byRegistration.set(r.registrationId, entry);
  }
  return [...byRegistration.entries()]
    .map(([registrationId, e]) =>
      summariseWapProject({
        registrationId,
        projectName: e.projectName,
        groupKind: e.groupKind,
        listStatus: e.listStatus,
        requests: e.requests,
        allocated: allocated.get(registrationId) ?? 0,
      }),
    )
    .sort((a, b) => a.projectName.localeCompare(b.projectName));
}

// --- The export (WAP-009) ----------------------------------------------------

export interface WapExportProject {
  registrationId: string;
  projectName: string;
  projectKind: GroupKind;
  listStatus: WapListStatus;
}

/** The projects whose passes the export lists, keyed by registration. */
export async function readWapExportProjects(
  editionId: string,
): Promise<Map<string, WapExportProject>> {
  const rows = await getDb()
    .select({
      registrationId: schema.registrations.id,
      projectName: schema.groups.name,
      projectKind: schema.groups.kind,
      listStatus: schema.registrations.wapListStatus,
    })
    .from(schema.registrations)
    .innerJoin(
      schema.groups,
      eq(schema.groups.id, schema.registrations.groupId),
    )
    .where(eq(schema.registrations.editionId, editionId));
  return new Map(rows.map((r) => [r.registrationId, r]));
}
