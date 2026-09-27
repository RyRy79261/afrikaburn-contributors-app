import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { activeMembership, formerMembership } from "@quagga/db";
import {
  buildCampRoster,
  canArchiveMember,
  canRestoreMember,
  buildRosterCsv,
  canEditOwnLogistics,
  canExportCampRoster,
  canViewCampRoster,
  deriveCampRosterStats,
  parseRosterFilter,
  publicMemberName,
  rosterCsvFilename,
  validateMemberLogistics,
  type CampRosterStats,
  type CampRosterView,
  type MemberLogistics,
  type RosterAccessContext,
  type RosterFilter,
  type RosterMemberInput,
  type RosterProjectRole,
  type RosterStatusFilter,
} from "@quagga/core";
import type { GroupKind } from "@quagga/types";
import { db, schema } from "./db";
import {
  getMemberPermissions,
  getOfficerStatus,
  getRoleAssignments,
  listRoles,
  type ProjectRole,
} from "./roles-store";

// Camp roster read/write paths (epic #55). EVERY decision here is made by a
// @quagga/core predicate — this module only loads the facts those predicates
// need, from the database, never from the request:
//
//   · the group by slug (the org group is never a roster);
//   · the viewer's permission membership OF THAT GROUP — null for a
//     non-member, which is how a lead of camp A gets nothing for camp B;
//   · for an authorised viewer only: members, this edition's bio COMPLETION
//     and first-time flag, and this edition's logistics. No bio content is
//     selected — not the phone, not the emergency contacts, not the ID
//     columns, not medical notes — so no predicate, however wrong, could
//     render one.
//
// Refusals come back as `null`, and the pages and the export route turn a
// null into the same not-found a nonexistent camp gets, so the roster is no
// oracle for which camps exist.

type SearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

interface RosterGroup {
  id: string;
  name: string;
  slug: string;
  kind: GroupKind;
}

async function groupBySlug(slug: string): Promise<RosterGroup | null> {
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

/** The group and the viewer's access to it, or null when there is no such
 * (project) group. Access is NOT decided here — the callers ask core. */
async function loadAccess(
  slug: string,
  viewerUserId: string,
): Promise<{ group: RosterGroup; access: RosterAccessContext } | null> {
  const group = await groupBySlug(slug);
  if (!group) return null;
  const viewerMembership = await getMemberPermissions(group.id, viewerUserId);
  return { group, access: { groupKind: group.kind, viewerMembership } };
}

/** Every member of the group with this edition's bio completion + first-time
 * flag and logistics. Called only AFTER the viewer has been authorised.
 *
 * `status` picks WHICH rows: the camp's current members, or its former
 * (archived) members — never both, so a former member cannot surface on the
 * current roster, its stats or its export whatever the rest of the filter
 * says (CDB-036). */
async function loadRosterMembers(
  group: RosterGroup,
  editionId: string,
  roles: readonly ProjectRole[],
  status: RosterStatusFilter = "current",
): Promise<RosterMemberInput[]> {
  const [rows, assignments] = await Promise.all([
    db()
      .select({
        membershipId: schema.memberships.id,
        userId: schema.memberships.userId,
        role: schema.memberships.role,
        username: schema.users.username,
        sanitizedAt: schema.users.sanitizedAt,
        // Completion and the first-time flag ONLY — never the bio's content.
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
          eq(schema.memberships.groupId, group.id),
          status === "former" ? formerMembership() : activeMembership(),
        ),
      ),
    getRoleAssignments(group.id, status),
  ]);

  // Roles a member HOLDS: accepted assignments, never the derived baseline
  // (everyone holds it, so it filters nothing and says nothing).
  const roleById = new Map(
    roles.filter((r) => r.kind !== "baseline").map((r) => [r.id, r]),
  );

  return rows.map((row) => {
    const projectRoles: RosterProjectRole[] = [];
    for (const a of assignments.get(row.membershipId) ?? []) {
      if (a.consent !== "accepted") continue;
      const role = roleById.get(a.projectRoleId);
      if (role) projectRoles.push({ id: role.id, name: role.name });
    }
    const sanitized = row.sanitizedAt != null;
    return {
      membershipId: row.membershipId,
      userId: row.userId,
      displayName: publicMemberName(row.username, {
        sanitizedAt: row.sanitizedAt,
      }),
      username: sanitized ? null : (row.username ?? null),
      structuralRole: row.role,
      projectRoles,
      bio:
        row.bioId != null
          ? {
              completedAt: row.bioCompletedAt ?? null,
              firstTime: row.bioFirstTime ?? false,
            }
          : null,
      logistics:
        row.logisticsId != null
          ? {
              joiningBuild: row.joiningBuild ?? false,
              joiningStrike: row.joiningStrike ?? false,
              arrivalDate: row.arrivalDate ?? null,
              departureDate: row.departureDate ?? null,
            }
          : null,
    };
  });
}

/** The project roles a filter may name (every non-baseline role of this
 * group), for the filter's options and for validating the `role` param. */
function filterableRoles(roles: readonly ProjectRole[]): RosterProjectRole[] {
  return roles
    .filter((r) => r.kind !== "baseline")
    .map((r) => ({ id: r.id, name: r.name }));
}

/** How many former (archived) members the camp has — a count for the stats
 * card, nothing more. */
async function countFormerMembers(groupId: string): Promise<number> {
  const [row] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.groupId, groupId), formerMembership()));
  return row?.count ?? 0;
}

/** The archive/restore action each listed row offers THIS viewer, decided by
 * the same @quagga/core predicates the server actions enforce — so the page
 * never offers what the action would refuse. A row absent from the map
 * offers nothing. */
function rosterMemberActions(input: {
  viewerUserId: string;
  access: RosterAccessContext;
  members: readonly RosterMemberInput[];
  status: RosterStatusFilter;
}): Record<string, "archive" | "restore"> {
  const actions: Record<string, "archive" | "restore"> = {};
  const actor = {
    userId: input.viewerUserId,
    membership: input.access.viewerMembership,
  };
  for (const m of input.members) {
    const target = {
      userId: m.userId,
      role: m.structuralRole,
      archived: input.status === "former",
    };
    if (input.status === "former") {
      if (canRestoreMember(actor, target).ok)
        actions[m.membershipId] = "restore";
    } else if (canArchiveMember(actor, target).ok) {
      actions[m.membershipId] = "archive";
    }
  }
  return actions;
}

export interface CampRosterPage {
  camp: { id: string; name: string; slug: string; kind: GroupKind };
  roster: CampRosterView;
  stats: CampRosterStats;
  filter: RosterFilter;
  roleOptions: RosterProjectRole[];
  /** membershipId → the one action this viewer may take on that row. */
  actions: Record<string, "archive" | "restore">;
}

/**
 * The roster page for a viewer, filtered by the URL's search params, or null
 * when the viewer may not see it (or there is no such camp). The refusal is
 * decided BEFORE any member row is read.
 */
export async function loadCampRoster(input: {
  slug: string;
  viewerUserId: string;
  editionId: string;
  searchParams: SearchParams;
}): Promise<CampRosterPage | null> {
  const loaded = await loadAccess(input.slug, input.viewerUserId);
  if (!loaded || !canViewCampRoster(loaded.access)) return null;
  const { group, access } = loaded;

  const [roles, officerStatus] = await Promise.all([
    listRoles(group.id),
    getOfficerStatus(group.id, input.editionId),
  ]);
  const roleOptions = filterableRoles(roles);
  const filter = parseRosterFilter(
    input.searchParams,
    new Set(roleOptions.map((r) => r.id)),
  );
  // The stats card always describes the CURRENT camp, whichever list is open.
  const current = await loadRosterMembers(group, input.editionId, roles);
  const listed =
    filter.status === "former"
      ? await loadRosterMembers(group, input.editionId, roles, "former")
      : current;
  const formerCount = await countFormerMembers(group.id);
  const roster = buildCampRoster({ access, members: listed, filter });
  if (!roster) return null;
  return {
    camp: group,
    roster,
    // The UNFILTERED members: the card describes the camp, not the search.
    stats: deriveCampRosterStats(
      current,
      officerStatus.outstanding,
      formerCount,
    ),
    filter,
    roleOptions,
    actions: rosterMemberActions({
      viewerUserId: input.viewerUserId,
      access,
      members: listed,
      status: filter.status,
    }),
  };
}

/**
 * The roster as CSV — the same filter as the page, so "export" hands over
 * what the lead is looking at — or null when the viewer may not export it.
 */
export async function exportCampRosterCsv(input: {
  slug: string;
  viewerUserId: string;
  editionId: string;
  editionYear: number;
  searchParams: SearchParams;
  now?: Date;
}): Promise<{ csv: string; filename: string } | null> {
  const loaded = await loadAccess(input.slug, input.viewerUserId);
  if (!loaded || !canExportCampRoster(loaded.access)) return null;
  const { group, access } = loaded;

  const roles = await listRoles(group.id);
  const roleOptions = filterableRoles(roles);
  const filter = parseRosterFilter(
    input.searchParams,
    new Set(roleOptions.map((r) => r.id)),
  );
  // The export carries the page's filter, the current/former choice included.
  const members = await loadRosterMembers(
    group,
    input.editionId,
    roles,
    filter.status,
  );
  const roster = buildCampRoster({ access, members, filter });
  if (!roster) return null;
  return {
    csv: buildRosterCsv(roster.rows),
    filename: rosterCsvFilename(
      group.slug,
      input.editionYear,
      input.now ?? new Date(),
    ),
  };
}

// --- The member's own logistics --------------------------------------------

/** The viewer's own membership of the camp at `slug`, with the group kind the
 * self-edit predicate checks. Whose record it is comes from HERE — the
 * session user and the slug — never from a request body. */
async function ownMembership(
  slug: string,
  userId: string,
): Promise<{ id: string; userId: string; groupKind: GroupKind } | null> {
  const [row] = await db()
    .select({
      id: schema.memberships.id,
      userId: schema.memberships.userId,
      groupKind: schema.groups.kind,
    })
    .from(schema.memberships)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.memberships.groupId))
    .where(
      and(
        eq(schema.groups.slug, slug),
        eq(schema.memberships.userId, userId),
        activeMembership(),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The viewer's own logistics for this camp and edition: `undefined` when they
 * may not have any here (not a member, or the org group), `null` when they
 * have not set any yet.
 */
export async function getOwnLogistics(input: {
  slug: string;
  userId: string;
  editionId: string;
}): Promise<MemberLogistics | null | undefined> {
  const membership = await ownMembership(input.slug, input.userId);
  if (
    !membership ||
    !canEditOwnLogistics({ viewerUserId: input.userId, membership })
  ) {
    return undefined;
  }
  const [row] = await db()
    .select({
      joiningBuild: schema.membershipLogistics.joiningBuild,
      joiningStrike: schema.membershipLogistics.joiningStrike,
      arrivalDate: schema.membershipLogistics.arrivalDate,
      departureDate: schema.membershipLogistics.departureDate,
    })
    .from(schema.membershipLogistics)
    .where(
      and(
        eq(schema.membershipLogistics.membershipId, membership.id),
        eq(schema.membershipLogistics.editionId, input.editionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type SaveLogisticsResult =
  { ok: true; logistics: MemberLogistics } | { ok: false; error: string };

/**
 * Save the viewer's OWN logistics for this camp and edition. Refused unless
 * `canEditOwnLogistics` says yes for the membership the SESSION user holds
 * here; validated against the edition window by core; upserted on
 * (membership, edition).
 */
export async function saveOwnLogistics(input: {
  slug: string;
  userId: string;
  edition: { id: string; startDate: string; endDate: string };
  raw: unknown;
}): Promise<SaveLogisticsResult> {
  const membership = await ownMembership(input.slug, input.userId);
  if (
    !membership ||
    !canEditOwnLogistics({ viewerUserId: input.userId, membership })
  ) {
    return { ok: false, error: "You're not a member of this camp." };
  }
  const validated = validateMemberLogistics(input.raw, input.edition);
  if (!validated.ok) return validated;
  const value = validated.value;
  const now = new Date();
  await db()
    .insert(schema.membershipLogistics)
    .values({
      membershipId: membership.id,
      editionId: input.edition.id,
      ...value,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.membershipLogistics.membershipId,
        schema.membershipLogistics.editionId,
      ],
      set: { ...value, updatedAt: now },
    });
  return { ok: true, logistics: value };
}
