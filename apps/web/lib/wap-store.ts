import "server-only";

import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  canManageWorkAccessPasses,
  decideWapAllocate,
  decideWapEdit,
  decideWapRequest,
  decideWapSubmit,
  effectiveWapPass,
  isBioComplete,
  isWapEligibleMember,
  isWapRequestWindowOpen,
  normalizeWapOverrides,
  pendingWapRequest,
  publicMemberName,
  totalWapGranted,
  validateWapOverrides,
  WAP_AUDIT,
  wapChangesSinceApproval,
  wapDuplicateHolders,
  wapListStatusAfterEdit,
  wapPassFlags,
  wapRefusalMessage,
  wapRequestWindowState,
  wapSinceApprovalBadge,
  type EffectiveWapPass,
  type MemberLogistics,
  type WapPassFlag,
  type WapPassOverrides,
  type WapRefusal,
  type WapWindowState,
} from "@quagga/core";
import type {
  MembershipRole,
  RegistrationStatus,
  WapListStatus,
  WapRequestStatus,
} from "@quagga/types";
import { activeMembership } from "@quagga/db";
import { db, schema, withTransaction, type Tx } from "./db";

// Work Access Passes, the project side (epic #53, docs/wap-spec.md). Every
// rule is a pure @quagga/core function (packages/core/src/work-access-passes.ts);
// this file loads the facts those functions read — from the database, never
// from the request — and performs the writes.
//
// SCOPING. A request names a project by slug and then only ids (an allocation,
// a membership). Each one is resolved INSIDE the project the caller's
// membership was resolved for (`groupId`) and inside the active edition's
// registration, so an id from another project answers exactly like one that
// does not exist.
//
// RACES. Every write runs in one transaction that first locks the memberships
// it depends on (`FOR SHARE` — a concurrent archive or demotion UPDATEs that
// row, so it waits for this write or this write re-reads it and finds nobody),
// then takes the project's registration row `FOR UPDATE`, then re-reads the
// counts and the list status and re-decides. Two tabs adding the last pass, or
// an edit racing a submit, serialise on the registration lock; the loser
// re-reads and is refused. Lock order is memberships → registration
// everywhere in this file (the org's review locks only the registration), so
// no two writes can deadlock.
//
// PRIVACY. Nothing here reads a hard-locked field (phone, emergency contacts,
// ID) or medical notes. The bio is read for its completion stamp only.
//
// FREE CAMPS. "Also has a pass from {project}" names the other project even
// when it is a free camp — the narrow, decided exception (AGENTS.md, under the
// free-camp law). It is computed ONLY by `wapDuplicateHolders`, ONLY for a
// viewer who manages this project, and ONLY for people on this list.

export type WapResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string };

type Handle = Tx | ReturnType<typeof db>;

const NO_REGISTRATION =
  "Submit the project's registration before asking for passes.";

function refused(reason: WapRefusal): { ok: false; error: string } {
  return { ok: false, error: wapRefusalMessage(reason) };
}

// --- Views -----------------------------------------------------------------

export interface WapRequestView {
  id: string;
  requested: number;
  reason: string | null;
  status: WapRequestStatus;
  granted: number | null;
  requestedByName: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export interface WapPassView {
  allocationId: string;
  membershipId: string;
  userId: string;
  displayName: string;
  overrides: WapPassOverrides;
  /** The member's own roster plan for the edition, or null. */
  plan: MemberLogistics | null;
  effective: EffectiveWapPass;
  flags: WapPassFlag[];
}

export interface WapCandidate {
  membershipId: string;
  displayName: string;
}

export interface WapListView {
  status: WapListStatus;
  submittedAt: Date | null;
  submittedByName: string | null;
  reviewedAt: Date | null;
  returnNote: string | null;
  approvedAt: Date | null;
  /** "Changed since approval" / "1 removed since approval", or null. */
  sinceApproval: string | null;
}

export interface WapPage {
  window: WapWindowState;
  /** Null when the project has no registration for the edition. */
  registration: {
    id: string;
    status: RegistrationStatus;
    firstArrival: string | null;
  } | null;
  requests: WapRequestView[];
  pending: WapRequestView | null;
  totalGranted: number;
  list: WapListView;
  passes: WapPassView[];
  /** Current members not on the list (sorted by name). */
  candidates: WapCandidate[];
  /** Why the project can't ask right now, or null when it can. */
  requestBlocked: string | null;
  /** Why the list can't be submitted right now, or null when it can. */
  submitBlocked: string | null;
}

interface RegistrationRow {
  id: string;
  status: RegistrationStatus;
  firstArrival: string | null;
  listStatus: WapListStatus;
  submittedAt: Date | null;
  submittedByUserId: string | null;
  reviewedAt: Date | null;
  returnNote: string | null;
  approvedAt: Date | null;
  approvedSnapshot: Parameters<typeof wapChangesSinceApproval>[0];
}

const registrationColumns = {
  id: schema.registrations.id,
  status: schema.registrations.status,
  firstArrival: schema.registrations.s4FirstArrivalDate,
  listStatus: schema.registrations.wapListStatus,
  submittedAt: schema.registrations.wapListSubmittedAt,
  submittedByUserId: schema.registrations.wapListSubmittedByUserId,
  reviewedAt: schema.registrations.wapListReviewedAt,
  returnNote: schema.registrations.wapListReturnNote,
  approvedAt: schema.registrations.wapListApprovedAt,
  approvedSnapshot: schema.registrations.wapListApprovedSnapshot,
};

async function readRegistration(
  handle: Handle,
  groupId: string,
  editionId: string,
): Promise<RegistrationRow | null> {
  const [row] = await handle
    .select(registrationColumns)
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

/** The registration row `FOR UPDATE` — the cap and status lock. */
async function lockRegistration(
  tx: Tx,
  groupId: string,
  editionId: string,
): Promise<RegistrationRow | null> {
  const [row] = await tx
    .select(registrationColumns)
    .from(schema.registrations)
    .where(
      and(
        eq(schema.registrations.groupId, groupId),
        eq(schema.registrations.editionId, editionId),
      ),
    )
    .limit(1)
    .for("update");
  return row ?? null;
}

async function readWindow(
  handle: Handle,
  editionId: string,
): Promise<{
  wapRequestsOpenAt: Date | null;
  wapRequestsCloseAt: Date | null;
}> {
  const [row] = await handle
    .select({
      wapRequestsOpenAt: schema.editions.wapRequestsOpenAt,
      wapRequestsCloseAt: schema.editions.wapRequestsCloseAt,
    })
    .from(schema.editions)
    .where(eq(schema.editions.id, editionId))
    .limit(1);
  return row ?? { wapRequestsOpenAt: null, wapRequestsCloseAt: null };
}

async function readRequests(
  handle: Handle,
  registrationId: string,
): Promise<WapRequestView[]> {
  const rows = await handle
    .select({
      id: schema.wapRequests.id,
      requested: schema.wapRequests.requested,
      reason: schema.wapRequests.reason,
      status: schema.wapRequests.status,
      granted: schema.wapRequests.granted,
      createdAt: schema.wapRequests.createdAt,
      decidedAt: schema.wapRequests.decidedAt,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
      requestedBy: schema.wapRequests.requestedByUserId,
    })
    .from(schema.wapRequests)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.wapRequests.requestedByUserId),
    )
    .where(eq(schema.wapRequests.registrationId, registrationId))
    .orderBy(desc(schema.wapRequests.createdAt));
  return rows.map((r) => ({
    id: r.id,
    requested: r.requested,
    reason: r.reason,
    status: r.status,
    granted: r.granted,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    requestedByName: r.requestedBy
      ? publicMemberName(r.username, { sanitizedAt: r.sanitizedAt })
      : null,
  }));
}

interface MemberRow {
  membershipId: string;
  userId: string;
  role: MembershipRole;
  displayName: string;
  bioComplete: boolean;
  plan: MemberLogistics | null;
}

/** The project's CURRENT members (not archived, not a deleted account), with
 * this edition's roster plan and bio completion — never the bio's content. */
async function readMembers(
  handle: Handle,
  groupId: string,
  editionId: string,
): Promise<MemberRow[]> {
  const rows = await handle
    .select({
      membershipId: schema.memberships.id,
      userId: schema.memberships.userId,
      role: schema.memberships.role,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
      bioCompletedAt: schema.burnerBios.completedAt,
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
        eq(schema.memberships.groupId, groupId),
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    );
  return rows
    .map((r) => ({
      membershipId: r.membershipId,
      userId: r.userId,
      role: r.role,
      displayName: publicMemberName(r.username, { sanitizedAt: r.sanitizedAt }),
      bioComplete: isBioComplete({ completedAt: r.bioCompletedAt ?? null }),
      plan:
        r.logisticsId != null
          ? {
              joiningBuild: r.joiningBuild ?? false,
              joiningStrike: r.joiningStrike ?? false,
              arrivalDate: r.arrivalDate ?? null,
              departureDate: r.departureDate ?? null,
            }
          : null,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

interface AllocationRow {
  id: string;
  membershipId: string;
  overrides: WapPassOverrides;
}

async function readAllocations(
  handle: Handle,
  registrationId: string,
): Promise<AllocationRow[]> {
  const rows = await handle
    .select({
      id: schema.wapAllocations.id,
      membershipId: schema.wapAllocations.membershipId,
      arrivalDate: schema.wapAllocations.arrivalDate,
      departureDate: schema.wapAllocations.departureDate,
      build: schema.wapAllocations.build,
      strike: schema.wapAllocations.strike,
    })
    .from(schema.wapAllocations)
    .where(eq(schema.wapAllocations.registrationId, registrationId))
    .orderBy(asc(schema.wapAllocations.createdAt));
  return rows.map((r) => ({
    id: r.id,
    membershipId: r.membershipId,
    overrides: {
      arrivalDate: r.arrivalDate,
      departureDate: r.departureDate,
      build: r.build,
      strike: r.strike,
    },
  }));
}

/** Users on this list with an unfinished SENT onboarding of this project. */
async function readOnboardingUnfinished(
  handle: Handle,
  groupId: string,
  editionId: string,
  userIds: readonly string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await handle
    .selectDistinct({ userId: schema.requiredActions.userId })
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
        eq(schema.questionnaireActivations.groupId, groupId),
        eq(schema.questionnaireActivations.editionId, editionId),
        eq(schema.questionnaireActivations.authoredScope, "group"),
        ne(schema.questionnaireActivations.status, "draft"),
        sql`${schema.questionnaireActivations.definition} ->> 'preset' = 'onboarding'`,
      ),
    );
  return new Set(rows.map((r) => r.userId));
}

/**
 * Every OTHER pass this edition held by someone on this list: user, the other
 * registration, and that project's NAME — nothing else about it is read. Only
 * passes held through a current membership count.
 */
async function readOtherHoldings(
  handle: Handle,
  registrationId: string,
  editionId: string,
  userIds: readonly string[],
) {
  if (userIds.length === 0) return [];
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
        ne(schema.registrations.id, registrationId),
        activeMembership(),
      ),
    );
}

async function userName(
  handle: Handle,
  userId: string | null,
): Promise<string | null> {
  if (!userId) return null;
  const [u] = await handle
    .select({
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return u
    ? publicMemberName(u.username, { sanitizedAt: u.sanitizedAt })
    : null;
}

/**
 * Everything the lead's Passes page renders. The CALLER must already have
 * decided the viewer manages this project (`canManageWorkAccessPasses`) —
 * the page 404s everyone else before calling this, because the flags name
 * other projects.
 */
export async function loadWapPage(input: {
  groupId: string;
  editionId: string;
  mayManage: boolean;
  now?: Date;
}): Promise<WapPage> {
  if (!input.mayManage) {
    throw new Error("loadWapPage is for the project's leads only.");
  }
  const now = input.now ?? new Date();
  const handle = db();
  const [windowFacts, registration, members] = await Promise.all([
    readWindow(handle, input.editionId),
    readRegistration(handle, input.groupId, input.editionId),
    readMembers(handle, input.groupId, input.editionId),
  ]);
  const window = wapRequestWindowState(windowFacts, now);

  const emptyList: WapListView = {
    status: "draft",
    submittedAt: null,
    submittedByName: null,
    reviewedAt: null,
    returnNote: null,
    approvedAt: null,
    sinceApproval: null,
  };

  if (!registration) {
    return {
      window,
      registration: null,
      requests: [],
      pending: null,
      totalGranted: 0,
      list: emptyList,
      passes: [],
      candidates: [],
      requestBlocked: NO_REGISTRATION,
      submitBlocked: wapRefusalMessage("no_grant"),
    };
  }

  const [requests, allocations, submittedByName] = await Promise.all([
    readRequests(handle, registration.id),
    readAllocations(handle, registration.id),
    userName(handle, registration.submittedByUserId),
  ]);

  const byMembership = new Map(members.map((m) => [m.membershipId, m]));
  // A pass whose membership is no longer current (archived or a deleted
  // account — both release the row; this is belt and braces) is not shown.
  const live = allocations.filter((a) => byMembership.has(a.membershipId));
  const listUserIds = live.map((a) => byMembership.get(a.membershipId)!.userId);

  const [unfinished, holdings] = await Promise.all([
    readOnboardingUnfinished(
      handle,
      input.groupId,
      input.editionId,
      listUserIds,
    ),
    readOtherHoldings(handle, registration.id, input.editionId, listUserIds),
  ]);
  const others = wapDuplicateHolders(registration.id, listUserIds, holdings);

  const passes: WapPassView[] = live.map((a) => {
    const m = byMembership.get(a.membershipId)!;
    return {
      allocationId: a.id,
      membershipId: m.membershipId,
      userId: m.userId,
      displayName: m.displayName,
      overrides: a.overrides,
      plan: m.plan,
      effective: effectiveWapPass(
        a.overrides,
        m.plan,
        registration.firstArrival,
      ),
      flags: wapPassFlags({
        bioComplete: m.bioComplete,
        onboardingUnfinished: unfinished.has(m.userId),
        otherProjects: others.get(m.userId) ?? [],
      }),
    };
  });

  const onList = new Set(live.map((a) => a.membershipId));
  const candidates = members
    .filter((m) => !onList.has(m.membershipId))
    .map((m) => ({ membershipId: m.membershipId, displayName: m.displayName }));

  const totalGranted = totalWapGranted(requests);
  const changes = wapChangesSinceApproval(
    registration.approvedSnapshot,
    passes.map((p) => ({
      membershipId: p.membershipId,
      userId: p.userId,
      arrivalDate: p.effective.arrivalDate,
      departureDate: p.effective.departureDate,
      build: p.effective.build,
      strike: p.effective.strike,
    })),
  );

  const requestDecision = decideWapRequest({
    mayManage: true,
    windowOpen: window === "open",
    registrationStatus: registration.status,
    requests,
  });
  const submitDecision = decideWapSubmit({
    mayManage: true,
    listStatus: registration.listStatus,
    totalGranted,
    allocatedCount: passes.length,
  });

  return {
    window,
    registration: {
      id: registration.id,
      status: registration.status,
      firstArrival: registration.firstArrival,
    },
    requests,
    pending: pendingWapRequest(requests),
    totalGranted,
    list: {
      status: registration.listStatus,
      submittedAt: registration.submittedAt,
      submittedByName,
      reviewedAt: registration.reviewedAt,
      returnNote: registration.returnNote,
      approvedAt: registration.approvedAt,
      sinceApproval: wapSinceApprovalBadge(registration.listStatus, changes),
    },
    passes,
    candidates,
    requestBlocked: requestDecision.ok
      ? null
      : wapRefusalMessage(requestDecision.reason),
    submitBlocked: submitDecision.ok
      ? null
      : wapRefusalMessage(submitDecision.reason),
  };
}

/** The project page's Passes tile (leads only): counts, nothing named. */
export async function getWapTileSummary(
  groupId: string,
  editionId: string,
  now: Date = new Date(),
): Promise<{
  window: WapWindowState;
  granted: number;
  allocated: number;
  pending: number | null;
  listStatus: WapListStatus | null;
}> {
  const handle = db();
  const [windowFacts, registration] = await Promise.all([
    readWindow(handle, editionId),
    readRegistration(handle, groupId, editionId),
  ]);
  const window = wapRequestWindowState(windowFacts, now);
  if (!registration) {
    return {
      window,
      granted: 0,
      allocated: 0,
      pending: null,
      listStatus: null,
    };
  }
  const [requests, [count]] = await Promise.all([
    handle
      .select({
        requested: schema.wapRequests.requested,
        status: schema.wapRequests.status,
        granted: schema.wapRequests.granted,
      })
      .from(schema.wapRequests)
      .where(eq(schema.wapRequests.registrationId, registration.id)),
    handle
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.wapAllocations)
      .innerJoin(
        schema.memberships,
        eq(schema.memberships.id, schema.wapAllocations.membershipId),
      )
      .where(
        and(
          eq(schema.wapAllocations.registrationId, registration.id),
          activeMembership(),
        ),
      ),
  ]);
  return {
    window,
    granted: totalWapGranted(requests),
    allocated: Number(count?.n ?? 0),
    pending: pendingWapRequest(requests)?.requested ?? null,
    listStatus: registration.listStatus,
  };
}

/**
 * The viewer's OWN pass on this project: whether their membership is on the
 * list, and the list's status. Only the viewer's own row is read.
 */
export async function getOwnWapPass(input: {
  groupId: string;
  editionId: string;
  userId: string;
}): Promise<{ onList: boolean; listStatus: WapListStatus | null }> {
  const [row] = await db()
    .select({
      listStatus: schema.registrations.wapListStatus,
      allocationId: schema.wapAllocations.id,
    })
    .from(schema.registrations)
    .leftJoin(
      schema.memberships,
      and(
        eq(schema.memberships.groupId, schema.registrations.groupId),
        eq(schema.memberships.userId, input.userId),
        activeMembership(),
      ),
    )
    .leftJoin(
      schema.wapAllocations,
      and(
        eq(schema.wapAllocations.registrationId, schema.registrations.id),
        eq(schema.wapAllocations.membershipId, schema.memberships.id),
      ),
    )
    .where(
      and(
        eq(schema.registrations.groupId, input.groupId),
        eq(schema.registrations.editionId, input.editionId),
      ),
    )
    .limit(1);
  if (!row) return { onList: false, listStatus: null };
  return { onList: row.allocationId != null, listStatus: row.listStatus };
}

// --- Write plumbing --------------------------------------------------------

interface LockedMember {
  membershipId: string;
  userId: string;
  role: MembershipRole;
  groupId: string;
  archivedAt: Date | null;
}

/**
 * Lock the caller's membership (and, for an allocation, the member being
 * added) and their accounts `FOR SHARE`, in ONE statement, before the
 * registration. Re-checked UNDER the lock: archived or erased while we waited
 * = nobody. `FOR SHARE` conflicts with the UPDATE an archive or a role change
 * makes on the membership and with the `FOR UPDATE` an erasure takes on the
 * account, which is all these writes need; two lead writes never wait on each other here — they
 * serialise on the registration row instead.
 */
async function lockMembers(
  tx: Tx,
  groupId: string,
  userId: string,
  otherMembershipId?: string,
): Promise<{ actor: LockedMember | null; other: LockedMember | null }> {
  const who = otherMembershipId
    ? or(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.id, otherMembershipId),
      )
    : eq(schema.memberships.userId, userId);
  const rows = await tx
    .select({
      membershipId: schema.memberships.id,
      userId: schema.memberships.userId,
      role: schema.memberships.role,
      groupId: schema.memberships.groupId,
      archivedAt: schema.memberships.archivedAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        who,
        activeMembership(),
        isNull(schema.users.sanitizedAt),
      ),
    )
    .orderBy(asc(schema.memberships.id))
    // The USERS row too: account erasure takes it `FOR UPDATE` before it
    // deletes anything keyed by membership (apps/web/lib/account-sanitize.ts,
    // step 1c) and never touches a camp membership row, so locking only the
    // membership would not make this wait. Locking the users row does, and
    // Postgres re-checks `sanitized_at IS NULL` on the row it waited for.
    .for("share", { of: [schema.memberships, schema.users] });
  return {
    actor: rows.find((r) => r.userId === userId) ?? null,
    other: otherMembershipId
      ? (rows.find((r) => r.membershipId === otherMembershipId) ?? null)
      : null,
  };
}

function mayManage(actor: LockedMember | null): boolean {
  return canManageWorkAccessPasses(
    actor ? { structuralRole: actor.role } : null,
  );
}

async function countAllocations(tx: Tx, registrationId: string) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.wapAllocations)
    .where(eq(schema.wapAllocations.registrationId, registrationId));
  return Number(row?.n ?? 0);
}

async function grantedTotal(tx: Tx, registrationId: string) {
  const rows = await tx
    .select({
      status: schema.wapRequests.status,
      granted: schema.wapRequests.granted,
    })
    .from(schema.wapRequests)
    .where(eq(schema.wapRequests.registrationId, registrationId));
  return totalWapGranted(rows);
}

/** After an edit: move an APPROVED list back to draft (core decides). */
async function markEdited(tx: Tx, registration: RegistrationRow) {
  const next = wapListStatusAfterEdit(registration.listStatus);
  if (next === registration.listStatus) return;
  await tx
    .update(schema.registrations)
    .set({ wapListStatus: next, updatedAt: new Date() })
    .where(eq(schema.registrations.id, registration.id));
}

async function audit(
  tx: Tx,
  actorUserId: string,
  action: string,
  groupId: string,
  meta: Record<string, unknown>,
) {
  await tx.insert(schema.auditEvents).values({
    actorId: actorUserId,
    action,
    subject: groupId,
    meta: { groupId, ...meta },
  });
}

// --- Writes ----------------------------------------------------------------

/** Ask for passes — the first request or "ask for more". */
export async function requestWorkAccessPasses(input: {
  actorUserId: string;
  groupId: string;
  editionId: string;
  requested: number;
  reason: string | null;
  now?: Date;
}): Promise<WapResult> {
  const now = input.now ?? new Date();
  return withTransaction(async (tx): Promise<WapResult> => {
    const { actor } = await lockMembers(tx, input.groupId, input.actorUserId);
    if (!mayManage(actor)) return refused("not_manager");
    const registration = await lockRegistration(
      tx,
      input.groupId,
      input.editionId,
    );
    if (!registration) return { ok: false, error: NO_REGISTRATION };
    const window = await readWindow(tx, input.editionId);
    const requests = await tx
      .select({ status: schema.wapRequests.status })
      .from(schema.wapRequests)
      .where(eq(schema.wapRequests.registrationId, registration.id));
    const decision = decideWapRequest({
      mayManage: true,
      windowOpen: isWapRequestWindowOpen(window, now),
      registrationStatus: registration.status,
      requests,
    });
    if (!decision.ok) return refused(decision.reason);
    const [row] = await tx
      .insert(schema.wapRequests)
      .values({
        registrationId: registration.id,
        requested: input.requested,
        reason: input.reason,
        requestedByUserId: input.actorUserId,
      })
      .returning({ id: schema.wapRequests.id });
    await audit(tx, input.actorUserId, WAP_AUDIT.request, input.groupId, {
      registrationId: registration.id,
      requestId: row?.id ?? null,
      requested: input.requested,
    });
    return { ok: true };
  });
}

/** Put a current member on the list (≤ total granted, under the lock). */
export async function allocateWorkAccessPass(input: {
  actorUserId: string;
  groupId: string;
  editionId: string;
  membershipId: string;
}): Promise<WapResult> {
  return withTransaction(async (tx): Promise<WapResult> => {
    const { actor, other } = await lockMembers(
      tx,
      input.groupId,
      input.actorUserId,
      input.membershipId,
    );
    if (!mayManage(actor)) return refused("not_manager");
    const registration = await lockRegistration(
      tx,
      input.groupId,
      input.editionId,
    );
    if (!registration) return refused("no_grant");
    // One connection: the reads go one after another, all under the lock.
    const totalGranted = await grantedTotal(tx, registration.id);
    const allocatedCount = await countAllocations(tx, registration.id);
    const existing = await tx
      .select({ id: schema.wapAllocations.id })
      .from(schema.wapAllocations)
      .where(
        and(
          eq(schema.wapAllocations.registrationId, registration.id),
          eq(schema.wapAllocations.membershipId, input.membershipId),
        ),
      )
      .limit(1);
    const decision = decideWapAllocate({
      mayManage: true,
      listStatus: registration.listStatus,
      totalGranted,
      allocatedCount,
      memberEligible: isWapEligibleMember(other, input.groupId),
      alreadyOnList: existing.length > 0,
    });
    if (!decision.ok) return refused(decision.reason);
    const [row] = await tx
      .insert(schema.wapAllocations)
      .values({
        registrationId: registration.id,
        membershipId: input.membershipId,
        allocatedByUserId: input.actorUserId,
      })
      .returning({ id: schema.wapAllocations.id });
    await markEdited(tx, registration);
    await audit(tx, input.actorUserId, WAP_AUDIT.allocate, input.groupId, {
      registrationId: registration.id,
      allocationId: row?.id ?? null,
      membershipId: input.membershipId,
    });
    return { ok: true };
  });
}

async function lockedAllocation(
  tx: Tx,
  registrationId: string,
  allocationId: string,
) {
  const [row] = await tx
    .select({
      id: schema.wapAllocations.id,
      membershipId: schema.wapAllocations.membershipId,
      arrivalDate: schema.wapAllocations.arrivalDate,
      departureDate: schema.wapAllocations.departureDate,
      build: schema.wapAllocations.build,
      strike: schema.wapAllocations.strike,
    })
    .from(schema.wapAllocations)
    .where(
      and(
        eq(schema.wapAllocations.id, allocationId),
        eq(schema.wapAllocations.registrationId, registrationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Take a name off the list. */
export async function removeWorkAccessPass(input: {
  actorUserId: string;
  groupId: string;
  editionId: string;
  allocationId: string;
}): Promise<WapResult> {
  return withTransaction(async (tx): Promise<WapResult> => {
    const { actor } = await lockMembers(tx, input.groupId, input.actorUserId);
    if (!mayManage(actor)) return refused("not_manager");
    const registration = await lockRegistration(
      tx,
      input.groupId,
      input.editionId,
    );
    if (!registration) return refused("not_on_list");
    const allocation = await lockedAllocation(
      tx,
      registration.id,
      input.allocationId,
    );
    const decision = decideWapEdit({
      mayManage: true,
      listStatus: registration.listStatus,
      onList: allocation !== null,
    });
    if (!decision.ok) return refused(decision.reason);
    await tx
      .delete(schema.wapAllocations)
      .where(
        and(
          eq(schema.wapAllocations.id, input.allocationId),
          eq(schema.wapAllocations.registrationId, registration.id),
        ),
      );
    await markEdited(tx, registration);
    await audit(tx, input.actorUserId, WAP_AUDIT.remove, input.groupId, {
      registrationId: registration.id,
      allocationId: input.allocationId,
      membershipId: allocation!.membershipId,
    });
    return { ok: true };
  });
}

/** The lead's corrections on one pass. Null = follow the roster plan. */
export async function updateWorkAccessPass(input: {
  actorUserId: string;
  groupId: string;
  edition: { id: string; startDate: string; endDate: string };
  allocationId: string;
  overrides: WapPassOverrides;
}): Promise<WapResult> {
  return withTransaction(async (tx): Promise<WapResult> => {
    const { actor } = await lockMembers(tx, input.groupId, input.actorUserId);
    if (!mayManage(actor)) return refused("not_manager");
    const registration = await lockRegistration(
      tx,
      input.groupId,
      input.edition.id,
    );
    if (!registration) return refused("not_on_list");
    const allocation = await lockedAllocation(
      tx,
      registration.id,
      input.allocationId,
    );
    const decision = decideWapEdit({
      mayManage: true,
      listStatus: registration.listStatus,
      onList: allocation !== null,
    });
    if (!decision.ok) return refused(decision.reason);
    const [planRow] = await tx
      .select({
        joiningBuild: schema.membershipLogistics.joiningBuild,
        joiningStrike: schema.membershipLogistics.joiningStrike,
        arrivalDate: schema.membershipLogistics.arrivalDate,
        departureDate: schema.membershipLogistics.departureDate,
      })
      .from(schema.membershipLogistics)
      .where(
        and(
          eq(schema.membershipLogistics.membershipId, allocation!.membershipId),
          eq(schema.membershipLogistics.editionId, input.edition.id),
        ),
      )
      .limit(1);
    const plan: MemberLogistics | null = planRow ?? null;
    const valid = validateWapOverrides(
      input.overrides,
      plan,
      registration.firstArrival,
      input.edition,
    );
    if (!valid.ok) return refused(valid.reason);
    const next = normalizeWapOverrides(input.overrides, plan);
    const unchanged =
      next.arrivalDate === allocation!.arrivalDate &&
      next.departureDate === allocation!.departureDate &&
      next.build === allocation!.build &&
      next.strike === allocation!.strike;
    // Saving what is already there is not an edit — it must not knock an
    // approved list back to draft.
    if (unchanged) return { ok: true };
    await tx
      .update(schema.wapAllocations)
      .set({ ...next, updatedAt: new Date() })
      .where(
        and(
          eq(schema.wapAllocations.id, input.allocationId),
          eq(schema.wapAllocations.registrationId, registration.id),
        ),
      );
    await markEdited(tx, registration);
    await audit(tx, input.actorUserId, WAP_AUDIT.override, input.groupId, {
      registrationId: registration.id,
      allocationId: input.allocationId,
    });
    return { ok: true };
  });
}

/** Send the list to AfrikaBurn. Clears the org's last return note. */
export async function submitWorkAccessPassList(input: {
  actorUserId: string;
  groupId: string;
  editionId: string;
  now?: Date;
}): Promise<WapResult> {
  const now = input.now ?? new Date();
  return withTransaction(async (tx): Promise<WapResult> => {
    const { actor } = await lockMembers(tx, input.groupId, input.actorUserId);
    if (!mayManage(actor)) return refused("not_manager");
    const registration = await lockRegistration(
      tx,
      input.groupId,
      input.editionId,
    );
    if (!registration) return refused("list_empty");
    const totalGranted = await grantedTotal(tx, registration.id);
    const allocatedCount = await countAllocations(tx, registration.id);
    const decision = decideWapSubmit({
      mayManage: true,
      listStatus: registration.listStatus,
      totalGranted,
      allocatedCount,
    });
    if (!decision.ok) return refused(decision.reason);
    await tx
      .update(schema.registrations)
      .set({
        wapListStatus: "submitted",
        wapListSubmittedAt: now,
        wapListSubmittedByUserId: input.actorUserId,
        wapListReturnNote: null,
        updatedAt: now,
      })
      .where(eq(schema.registrations.id, registration.id));
    await audit(tx, input.actorUserId, WAP_AUDIT.submit, input.groupId, {
      registrationId: registration.id,
      passes: allocatedCount,
    });
    return { ok: true };
  });
}
