import "server-only";

import { and, eq, ne, sql, inArray } from "drizzle-orm";
import {
  isRegistered,
  normalizeName,
  isExactNormalizedMatch,
  isSimilarName,
  trigramSimilarity,
  publicMemberName,
  publicBioView,
  defaultPrivacyFlags,
  CAMP_DESCRIPTION_WORD_LIMIT,
  isWithinWordLimit,
  type BurnerBioFields,
  type PublicBioView,
} from "@quagga/core";
import type {
  GroupKind,
  Joinability,
  MembershipRole,
  RegistrationStatus,
} from "@quagga/types";
import { db, schema } from "./db";

export interface DirectoryEntry {
  id: string;
  name: string;
  slug: string;
  kind: GroupKind;
  description: string | null;
  joinability: Joinability;
  registered: boolean;
  memberCount: number;
  viewerRole: MembershipRole | null;
}

/** Slugify a camp name: lowercased, alnum runs joined with hyphens. */
export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "camp"
  );
}

async function memberCounts(
  groupIds: string[],
): Promise<Map<string, number>> {
  if (groupIds.length === 0) return new Map();
  const rows = await db()
    .select({
      groupId: schema.memberships.groupId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.memberships)
    .where(inArray(schema.memberships.groupId, groupIds))
    .groupBy(schema.memberships.groupId);
  return new Map(rows.map((r) => [r.groupId, r.count]));
}

/**
 * The directory listing (build-spec §apps/web `/directory`): registered camps
 * are public; unregistered (free) camps appear only to their own members. An
 * optional `search` filters by normalized name substring.
 */
export async function listDirectory(input: {
  editionId: string;
  viewerId: string | null;
  search?: string;
}): Promise<DirectoryEntry[]> {
  const groups = await db()
    .select()
    .from(schema.groups)
    .where(ne(schema.groups.kind, "org"));

  const groupIds = groups.map((g) => g.id);

  // Approved registrations for this edition ⇒ the "registered" predicate.
  const approved =
    groupIds.length === 0
      ? []
      : await db()
          .select({
            groupId: schema.registrations.groupId,
            status: schema.registrations.status,
          })
          .from(schema.registrations)
          .where(eq(schema.registrations.editionId, input.editionId));
  const regByGroup = new Map<string, { status: RegistrationStatus }[]>();
  for (const r of approved) {
    const list = regByGroup.get(r.groupId) ?? [];
    list.push({ status: r.status });
    regByGroup.set(r.groupId, list);
  }

  // The viewer's memberships (for free-camp visibility + role badge).
  const viewerRoles = new Map<string, MembershipRole>();
  if (input.viewerId) {
    const memberships = await db()
      .select({
        groupId: schema.memberships.groupId,
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, input.viewerId));
    for (const m of memberships) viewerRoles.set(m.groupId, m.role);
  }

  const counts = await memberCounts(groupIds);
  const needle = input.search ? normalizeName(input.search) : "";

  const entries: DirectoryEntry[] = [];
  for (const g of groups) {
    const registered = isRegistered(regByGroup.get(g.id) ?? []);
    const viewerRole = viewerRoles.get(g.id) ?? null;
    // Visibility: registered ⇒ public; otherwise members-only.
    if (!registered && !viewerRole) continue;
    if (needle && !g.nameNormalized.includes(needle)) continue;
    entries.push({
      id: g.id,
      name: g.name,
      slug: g.slug,
      kind: g.kind,
      description: g.description,
      joinability: g.joinability,
      registered,
      memberCount: counts.get(g.id) ?? 0,
      viewerRole,
    });
  }
  entries.sort((a, b) => {
    if (a.registered !== b.registered) return a.registered ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

export interface CampMember {
  userId: string;
  role: MembershipRole;
  displayName: string;
  isViewer: boolean;
}

export interface CampDetail {
  id: string;
  name: string;
  slug: string;
  kind: GroupKind;
  description: string | null;
  joinability: Joinability;
  registered: boolean;
  registrationStatus: string | null;
  createdByUserId: string | null;
  members: CampMember[];
  viewerRole: MembershipRole | null;
}

/** Full camp dashboard data by slug, from the viewer's perspective. */
export async function getCampBySlug(
  slug: string,
  editionId: string,
  viewerId: string | null,
): Promise<CampDetail | null> {
  const rows = await db()
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  const group = rows[0];
  if (!group || group.kind === "org") return null;

  const regs = await db()
    .select({ status: schema.registrations.status })
    .from(schema.registrations)
    .where(
      and(
        eq(schema.registrations.groupId, group.id),
        eq(schema.registrations.editionId, editionId),
      ),
    )
    .limit(1);
  const registrationStatus = regs[0]?.status ?? null;

  // NB: never select the account email here — this list renders on the public
  // (registered) camp page, and email is POPIA-relevant PII. Public display
  // names fall back to a neutral placeholder, never to email.
  const memberRows = await db()
    .select({
      userId: schema.memberships.userId,
      role: schema.memberships.role,
      displayName: schema.burnerBios.displayName,
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
    .where(eq(schema.memberships.groupId, group.id));

  const members: CampMember[] = memberRows.map((m) => ({
    userId: m.userId,
    role: m.role,
    displayName: publicMemberName(m.displayName),
    isViewer: m.userId === viewerId,
  }));
  const roleRank: Record<MembershipRole, number> = {
    god: 0,
    org_staff: 1,
    lead: 2,
    admin: 3,
    member: 4,
  };
  members.sort((a, b) => roleRank[a.role] - roleRank[b.role]);

  const viewerRole =
    members.find((m) => m.userId === viewerId)?.role ?? null;

  return {
    id: group.id,
    name: group.name,
    slug: group.slug,
    kind: group.kind,
    description: group.description,
    joinability: group.joinability,
    registered: registrationStatus === "approved",
    registrationStatus,
    createdByUserId: group.createdByUserId,
    members,
    viewerRole,
  };
}

export interface BurnerCamp {
  name: string;
  slug: string;
  kind: GroupKind;
  role: MembershipRole;
}

export interface PublicBurnerProfile {
  userId: string;
  /** Always safe to show — falls back to a neutral placeholder, never email. */
  displayName: string;
  /** Only the fields the burner flagged public; hard-locked fields never leak. */
  publicFields: PublicBioView;
  /** Registered camps the burner belongs to (free camps are members-only, so
   * they are never broadcast on a public profile). */
  camps: BurnerCamp[];
}

/**
 * The third-party (public) profile for a burner. Returns null if the user does
 * not exist. Surfaces ONLY public bio fields (via `publicBioView` — the hard
 * privacy lock is enforced there) and the burner's REGISTERED camp memberships;
 * free-camp memberships are omitted so a stranger can't discover them.
 */
export async function getPublicBurnerProfile(
  userId: string,
  editionId: string,
): Promise<PublicBurnerProfile | null> {
  const userRows = await db()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!userRows[0]) return null;

  // Non-sensitive bio columns only — never select phone / emergency / medical /
  // encrypted ID here; publicBioView additionally gates on the privacy flags.
  const bioRows = await db()
    .select({
      displayName: schema.burnerBios.displayName,
      legalName: schema.burnerBios.legalName,
      homeCity: schema.burnerBios.homeCity,
      bio: schema.burnerBios.bio,
      skills: schema.burnerBios.skills,
      attendedYears: schema.burnerBios.attendedYears,
      firstTime: schema.burnerBios.firstTime,
      contactEmail: schema.burnerBios.contactEmail,
      privacyFlags: schema.burnerBios.privacyFlags,
    })
    .from(schema.burnerBios)
    .where(
      and(
        eq(schema.burnerBios.userId, userId),
        eq(schema.burnerBios.editionId, editionId),
      ),
    )
    .limit(1);
  const bioRow = bioRows[0] ?? null;

  const fields: BurnerBioFields = {
    displayName: bioRow?.displayName ?? null,
    legalName: bioRow?.legalName ?? null,
    homeCity: bioRow?.homeCity ?? null,
    bio: bioRow?.bio ?? null,
    skills: bioRow?.skills ?? [],
    attendedYears: bioRow?.attendedYears ?? [],
    firstTime: bioRow?.firstTime ?? false,
    contactEmail: bioRow?.contactEmail ?? null,
    // Hard-locked fields are never fetched — publicBioView never reads them.
    phone: null,
    onsiteContactName: null,
    onsiteContactPhone: null,
    offsiteContactName: null,
    offsiteContactPhone: null,
    medicalNotes: null,
    idType: null,
    idNumber: null,
  };
  const flags = { ...defaultPrivacyFlags(), ...(bioRow?.privacyFlags ?? {}) };

  // Memberships → registered camps only.
  const membershipRows = await db()
    .select({
      groupId: schema.groups.id,
      name: schema.groups.name,
      slug: schema.groups.slug,
      kind: schema.groups.kind,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.memberships.groupId))
    .where(
      and(
        eq(schema.memberships.userId, userId),
        ne(schema.groups.kind, "org"),
      ),
    );

  const groupIds = membershipRows.map((r) => r.groupId);
  const approved =
    groupIds.length === 0
      ? []
      : await db()
          .select({ groupId: schema.registrations.groupId })
          .from(schema.registrations)
          .where(
            and(
              eq(schema.registrations.editionId, editionId),
              eq(schema.registrations.status, "approved"),
              inArray(schema.registrations.groupId, groupIds),
            ),
          );
  const registeredGroupIds = new Set(approved.map((r) => r.groupId));

  const camps: BurnerCamp[] = membershipRows
    .filter((r) => registeredGroupIds.has(r.groupId))
    .map((r) => ({
      name: r.name,
      slug: r.slug,
      kind: r.kind,
      role: r.role,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    userId,
    displayName: publicMemberName(bioRow?.displayName ?? null),
    publicFields: publicBioView(fields, flags),
    camps,
  };
}

export interface NameCheck {
  ok: boolean;
  reason: "exact" | null;
  warnings: string[];
}

/** The `/camps/new` dedupe decision: reject an exact normalized collision within
 * the same kind; warn (don't block) on trigram similarity ≥ 0.55. */
export async function checkCampName(
  name: string,
  kind: GroupKind,
): Promise<NameCheck> {
  const existing = await db()
    .select({ name: schema.groups.name })
    .from(schema.groups)
    .where(eq(schema.groups.kind, kind));
  const exact = existing.find((e) => isExactNormalizedMatch(e.name, name));
  if (exact) return { ok: false, reason: "exact", warnings: [] };
  const warnings = existing
    .filter((e) => isSimilarName(e.name, name))
    .sort((a, b) => trigramSimilarity(b.name, name) - trigramSimilarity(a.name, name))
    .map((e) => e.name);
  return { ok: true, reason: null, warnings };
}

export type CreateCampResult =
  | { ok: true; slug: string }
  | { ok: false; error: string };

/** Postgres unique-violation SQLSTATE. The Neon driver surfaces it as `.code`. */
const UNIQUE_VIOLATION = "23505";

/** Whether an unknown error is a Postgres unique-constraint violation. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/** Create a project group (instant free camp); the creator becomes its lead. */
export async function createCamp(input: {
  creatorId: string;
  name: string;
  kind: GroupKind;
  description: string | null;
  joinability: Joinability;
}): Promise<CreateCampResult> {
  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: "Give your camp a name." };
  if (
    input.description &&
    !isWithinWordLimit(input.description, CAMP_DESCRIPTION_WORD_LIMIT)
  ) {
    return {
      ok: false,
      error: `Description must be ${CAMP_DESCRIPTION_WORD_LIMIT} words or fewer.`,
    };
  }

  const check = await checkCampName(name, input.kind);
  if (!check.ok) {
    return {
      ok: false,
      error: "A camp of this kind already uses that name. Pick another.",
    };
  }

  // Ensure a unique slug (append a short suffix on collision).
  const base = slugify(name);
  let slug = base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const clash = await db()
      .select({ id: schema.groups.id })
      .from(schema.groups)
      .where(eq(schema.groups.slug, slug))
      .limit(1);
    if (!clash[0]) break;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }

  // checkCampName above is a SELECT-then-decide with a TOCTOU window: two
  // concurrent creates with the same normalized name can both pass it. The
  // unique index groups_kind_name_normalized_idx is the real guarantee — catch
  // its violation and surface the same graceful message rather than a 500. A
  // slug collision that survives the retry loop maps to the same handling.
  let inserted: { id: string; slug: string }[];
  try {
    inserted = await db()
      .insert(schema.groups)
      .values({
        kind: input.kind,
        name,
        nameNormalized: normalizeName(name),
        slug,
        description: input.description,
        joinability: input.joinability,
        createdByUserId: input.creatorId,
      })
      .returning({ id: schema.groups.id, slug: schema.groups.slug });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        error: "A camp of this kind already uses that name. Pick another.",
      };
    }
    throw err;
  }
  const group = inserted[0];
  if (!group) return { ok: false, error: "Could not create the camp." };

  await db().insert(schema.memberships).values({
    userId: input.creatorId,
    groupId: group.id,
    role: "lead",
  });

  return { ok: true, slug: group.slug };
}

/** The viewer's role in a group, or null if not a member. */
export async function getViewerRole(
  userId: string,
  groupId: string,
): Promise<MembershipRole | null> {
  const rows = await db()
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.groupId, groupId),
      ),
    )
    .limit(1);
  return rows[0]?.role ?? null;
}

/** Remove the viewer's own membership (leave). A lead may not leave while other
 * members remain — they must transfer lead first. */
export async function leaveCamp(
  userId: string,
  groupId: string,
): Promise<{ ok: boolean; error?: string }> {
  const role = await getViewerRole(userId, groupId);
  if (!role) return { ok: false, error: "You're not a member of this camp." };
  if (role === "lead") {
    const others = await db()
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.groupId, groupId),
          ne(schema.memberships.userId, userId),
        ),
      );
    if ((others[0]?.count ?? 0) > 0) {
      return {
        ok: false,
        error:
          "Transfer the lead role before leaving — a camp always needs a lead.",
      };
    }
  }
  await db()
    .delete(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.groupId, groupId),
      ),
    );
  return { ok: true };
}

/** Groups the user is a member of (for the nav / home). */
export async function listMyCamps(
  userId: string,
): Promise<{ name: string; slug: string; role: MembershipRole; kind: GroupKind }[]> {
  const rows = await db()
    .select({
      name: schema.groups.name,
      slug: schema.groups.slug,
      role: schema.memberships.role,
      kind: schema.groups.kind,
    })
    .from(schema.memberships)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.memberships.groupId))
    .where(eq(schema.memberships.userId, userId));
  return rows.filter((r) => r.kind !== "org");
}
