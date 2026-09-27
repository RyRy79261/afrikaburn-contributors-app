import "server-only";

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  areCampMates,
  buildCampPeopleView,
  campmateBioView,
  canContact,
  canViewAvatar,
  defaultPrivacyFlags,
  parseVolunteering,
  publicMemberName,
  type BioExtras,
  type BurnerBioFields,
  type CampPersonCard,
  type CampPersonInput,
  type CampmateContext,
  type CampmateMembership,
  type PublicBioView,
} from "@quagga/core";
import { activeMembership } from "@quagga/db";
import { db, schema } from "./db";

// Camp-mate read paths (epic #68). EVERY decision here is made by a
// @quagga/core predicate — this module only loads the facts those predicates
// need, from the database, never from the request:
//
//   · memberships (with the group KIND, which core checks — an org or artwork
//     membership never makes two people camp-mates);
//   · this edition's bio, with ONLY the columns a camp-mate view can ever show.
//     Phone, emergency contacts, medical notes and the encrypted ID columns are
//     never selected here, so no predicate — however wrong — could render them.

/** The non-sensitive bio columns. Deliberately the same set the public profile
 * selects (groups-store `getPublicBurnerProfile`). */
const SAFE_BIO_COLUMNS = {
  userId: schema.burnerBios.userId,
  legalName: schema.burnerBios.legalName,
  homeCity: schema.burnerBios.homeCity,
  bio: schema.burnerBios.bio,
  skills: schema.burnerBios.skills,
  attendedYears: schema.burnerBios.attendedYears,
  firstTime: schema.burnerBios.firstTime,
  contactEmail: schema.burnerBios.contactEmail,
  about: schema.burnerBios.about,
  campHistory: schema.burnerBios.campHistory,
  volunteeringInterests: schema.burnerBios.volunteeringInterests,
  rangerTraining: schema.burnerBios.rangerTraining,
  rangerCurious: schema.burnerBios.rangerCurious,
  greenDotTraining: schema.burnerBios.greenDotTraining,
  privacyFlags: schema.burnerBios.privacyFlags,
  contactable: schema.burnerBios.contactable,
  listedInCampPeople: schema.burnerBios.listedInCampPeople,
  // Confirmation: every camp-mate exposure requires it (core module header).
  completedAt: schema.burnerBios.completedAt,
};

type SafeBioRow = {
  userId: string;
  legalName: string | null;
  homeCity: string | null;
  bio: string | null;
  skills: string[];
  attendedYears: number[];
  firstTime: boolean;
  contactEmail: string | null;
  about: string | null;
  campHistory: BioExtras["campHistory"] | null;
  volunteeringInterests: string[] | null;
  rangerTraining: boolean | null;
  rangerCurious: boolean | null;
  greenDotTraining: boolean | null;
  privacyFlags: Record<string, unknown>;
  contactable: string;
  listedInCampPeople: boolean;
  completedAt: Date | null;
};

/** Has the subject confirmed this edition's bio? A missing row is not. */
function isConfirmed(row: SafeBioRow | undefined): boolean {
  return row?.completedAt != null;
}

/** Column-shaped fields with every sensitive slot EMPTY — they were never
 * loaded, so they cannot be projected. */
function safeFields(row: SafeBioRow): BurnerBioFields {
  return {
    legalName: row.legalName,
    homeCity: row.homeCity,
    bio: row.bio,
    skills: row.skills,
    attendedYears: row.attendedYears,
    firstTime: row.firstTime,
    contactEmail: row.contactEmail,
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

function safeExtras(row: SafeBioRow): BioExtras {
  const volunteering = parseVolunteering(row.volunteeringInterests ?? []);
  return {
    about: row.about,
    campHistory: row.campHistory ?? [],
    volunteeringInterests: volunteering.interests,
    volunteeringOther: volunteering.other,
    rangerTraining: row.rangerTraining ?? false,
    rangerCurious: row.rangerCurious ?? false,
    greenDotTraining: row.greenDotTraining ?? false,
  };
}

function flagsOf(row: SafeBioRow | undefined): Record<string, unknown> {
  return { ...defaultPrivacyFlags(), ...(row?.privacyFlags ?? {}) };
}

/** Each user's memberships with the group kind, keyed by user id. */
export async function loadCampmateMemberships(
  userIds: readonly string[],
): Promise<Map<string, CampmateMembership[]>> {
  const out = new Map<string, CampmateMembership[]>();
  for (const id of userIds) out.set(id, []);
  if (userIds.length === 0) return out;
  const rows = await db()
    .select({
      userId: schema.memberships.userId,
      groupId: schema.memberships.groupId,
      groupKind: schema.groups.kind,
    })
    .from(schema.memberships)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.memberships.groupId))
    .where(
      and(
        inArray(schema.memberships.userId, [...new Set(userIds)]),
        // A former member is nobody's camp-mate there any more (CDB-036):
        // no shared-camp profile, photo or messaging reach through it.
        activeMembership(),
      ),
    );
  for (const row of rows) {
    out.get(row.userId)?.push({
      groupId: row.groupId,
      groupKind: row.groupKind,
    });
  }
  return out;
}

async function loadContext(
  viewerUserId: string,
  subjectUserId: string,
): Promise<CampmateContext> {
  const memberships = await loadCampmateMemberships([
    viewerUserId,
    subjectUserId,
  ]);
  return {
    viewerUserId,
    subjectUserId,
    viewerMemberships: memberships.get(viewerUserId) ?? [],
    subjectMemberships: memberships.get(subjectUserId) ?? [],
  };
}

async function loadSafeBio(
  userId: string,
  editionId: string,
): Promise<SafeBioRow | undefined> {
  const [row] = await db()
    .select(SAFE_BIO_COLUMNS)
    .from(schema.burnerBios)
    .where(
      and(
        eq(schema.burnerBios.userId, userId),
        eq(schema.burnerBios.editionId, editionId),
      ),
    )
    .limit(1);
  return row;
}

/**
 * The camp-mate view of `subjectUserId` for `viewerUserId` in this edition, or
 * null when they are not camp-mates (or the subject has no bio this edition).
 * The refusal is `campmateBioView`'s — this function adds none of its own.
 */
export async function getCampmateBioView(input: {
  viewerUserId: string;
  subjectUserId: string;
  editionId: string;
}): Promise<PublicBioView | null> {
  const ctx = await loadContext(input.viewerUserId, input.subjectUserId);
  // Refuse before reading the bio at all when there is no shared camp.
  if (!areCampMates(ctx)) return null;
  const row = await loadSafeBio(input.subjectUserId, input.editionId);
  if (!row) return null;
  return campmateBioView(ctx, {
    fields: safeFields(row),
    privacyFlags: flagsOf(row),
    extras: safeExtras(row),
    confirmed: isConfirmed(row),
  });
}

/**
 * The blob key of `subjectUserId`'s photo IF `viewerUserId` may see it, else
 * null. Null covers "no photo", "not allowed" and "deleted account" alike, so
 * the proxy can answer all three the same way (a 404) and leak nothing about
 * which it was.
 */
export async function resolveAvatarForViewer(input: {
  viewerUserId: string | null;
  subjectUserId: string;
  editionId: string;
}): Promise<string | null> {
  const [subject] = await db()
    .select({
      avatarKey: schema.users.avatarKey,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, input.subjectUserId))
    .limit(1);
  if (!subject?.avatarKey) return null;
  if (!input.viewerUserId) return null;

  const isSelf = input.viewerUserId === input.subjectUserId;
  const [ctx, bio] = await Promise.all([
    isSelf
      ? Promise.resolve<CampmateContext>({
          viewerUserId: input.viewerUserId,
          subjectUserId: input.subjectUserId,
          viewerMemberships: [],
          subjectMemberships: [],
        })
      : loadContext(input.viewerUserId, input.subjectUserId),
    loadSafeBio(input.subjectUserId, input.editionId),
  ]);
  const allowed = canViewAvatar({
    ctx,
    viewerSignedIn: true,
    privacyFlags: flagsOf(bio),
    subjectSanitized: subject.sanitizedAt != null,
    subjectConfirmed: isConfirmed(bio),
  });
  return allowed ? subject.avatarKey : null;
}

/**
 * May `viewerUserId` start contact with `subjectUserId`? The future
 * direct-message epic's read of the contactability setting — decided by
 * @quagga/core `canContact` over this edition's stored setting (default
 * `nobody` when the subject has no bio this edition).
 */
export async function canViewerContact(input: {
  viewerUserId: string;
  subjectUserId: string;
  editionId: string;
}): Promise<boolean> {
  const [subject] = await db()
    .select({ sanitizedAt: schema.users.sanitizedAt })
    .from(schema.users)
    .where(eq(schema.users.id, input.subjectUserId))
    .limit(1);
  if (!subject) return false;
  const [ctx, bio] = await Promise.all([
    loadContext(input.viewerUserId, input.subjectUserId),
    loadSafeBio(input.subjectUserId, input.editionId),
  ]);
  return canContact({
    ctx,
    contactable: bio?.contactable,
    subjectSanitized: subject.sanitizedAt != null,
    subjectConfirmed: isConfirmed(bio),
  });
}

/**
 * "People in my camp" for `viewerUserId`, or null when the viewer is not a
 * member of the group (the page renders that as not-found). Only members who
 * opted in this edition are listed, each as a camp-mate sees them.
 */
export async function listCampPeople(input: {
  viewerUserId: string;
  slug: string;
  editionId: string;
}): Promise<{ name: string; slug: string; people: CampPersonCard[] } | null> {
  const [group] = await db()
    .select({
      id: schema.groups.id,
      kind: schema.groups.kind,
      name: schema.groups.name,
      slug: schema.groups.slug,
    })
    .from(schema.groups)
    .where(eq(schema.groups.slug, input.slug))
    .limit(1);
  if (!group) return null;

  const viewerMemberships =
    (await loadCampmateMemberships([input.viewerUserId])).get(
      input.viewerUserId,
    ) ?? [];
  // Refused BEFORE any other member's row is read.
  if (
    buildCampPeopleView({
      viewerUserId: input.viewerUserId,
      viewerMemberships,
      groupId: group.id,
      groupKind: group.kind,
      members: [],
    }) === null
  ) {
    return null;
  }

  // Opted-in members of THIS group with a bio THIS edition. The opt-in filter
  // is in the query so non-listed members' bios are never loaded; the core
  // builder re-checks every condition regardless.
  const rows = await db()
    .select({
      ...SAFE_BIO_COLUMNS,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
      avatarKey: schema.users.avatarKey,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .innerJoin(
      schema.burnerBios,
      and(
        eq(schema.burnerBios.userId, schema.memberships.userId),
        eq(schema.burnerBios.editionId, input.editionId),
      ),
    )
    .where(
      and(
        eq(schema.memberships.groupId, group.id),
        activeMembership(),
        eq(schema.burnerBios.listedInCampPeople, true),
        // Confirmed this edition only — a carried, unconfirmed opt-in is inert.
        isNotNull(schema.burnerBios.completedAt),
      ),
    );

  const members: CampPersonInput[] = rows.map((row) => ({
    userId: row.userId,
    displayName: publicMemberName(row.username, {
      sanitizedAt: row.sanitizedAt,
    }),
    sanitized: row.sanitizedAt != null,
    hasAvatar: Boolean(row.avatarKey),
    // Loaded FROM this group's membership rows, so each is in it by
    // construction; core still re-checks.
    memberships: [{ groupId: group.id, groupKind: group.kind }],
    bio: {
      fields: safeFields(row),
      privacyFlags: flagsOf(row),
      extras: safeExtras(row),
      listedInCampPeople: row.listedInCampPeople,
      confirmed: isConfirmed(row),
    },
  }));

  const cards = buildCampPeopleView({
    viewerUserId: input.viewerUserId,
    viewerMemberships,
    groupId: group.id,
    groupKind: group.kind,
    members,
  });
  if (!cards) return null;
  cards.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { name: group.name, slug: group.slug, people: cards };
}
