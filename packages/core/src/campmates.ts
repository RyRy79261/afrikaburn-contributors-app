// Camp-mate profiles (epic #68). PURE predicates and projections only — no DB,
// no I/O. The apps load memberships and bios, pass them here, and render ONLY
// what comes back.
//
// ── WHO IS A CAMP-MATE ──────────────────────────────────────────────────────
//
// Two people are camp-mates when they both hold a membership of the same
// THEME CAMP. Membership is the live `memberships` row (the table is not
// edition-scoped — a membership is the current state of a person's camp), and
// the bio they share is the one for the CURRENT edition (`burner_bios` is one
// row per user × edition, and the app only ever loads the active edition's).
// So "camp-mates in the current edition" = a shared theme-camp membership now,
// read against this edition's privacy choices.
//
// Deliberately NOT camp-mates:
//   · members of the ORG group — AfrikaBurn staff are not anyone's camp-mates,
//     and the org's access to personal information is its own, separately
//     audited authority (./medical-access, ./org-permissions);
//   · artwork and mutant-vehicle crews — the epic scopes camp-mates to theme
//     camps. `CAMPMATE_GROUP_KINDS` is the ONE place to widen that, on purpose;
//   · a lead of camp A looking at a member of camp B. Being a lead grants
//     nothing here: a camp-mate view is a peer view, and seniority in a
//     different camp is not a shared camp.
//
// ── WHAT A CAMP-MATE SEES ───────────────────────────────────────────────────
//
// Exactly the fields the subject shared with camp-mates or with everyone
// (./privacy `isVisibleToCampMates`). Never the always-private classes: phone,
// both emergency contacts, SA ID / passport and medical notes are refused the
// camp_mates level by `canBeCampVisible`, and the projection's SHAPE has no
// slot for any of them. Medical keeps its own audience (camp leads + org safety
// staff), which is a detail-view resolver elsewhere and never a list.
//
// ── THE PEOPLE VIEW ─────────────────────────────────────────────────────────
//
// "People in my camp" is OPT-IN per member and OFF by default. It lists only
// members who opted in for this edition, shows each of them only as a
// camp-mate would see them, and is served only to a member of that same camp —
// never to a non-member, so a free camp's roster stays undiscoverable.
//
// ── ONLY A CONFIRMED BIO EXPOSES ANYTHING ───────────────────────────────────
//
// Every camp-mate exposure — the camp-mate view, the photo (to anyone but its
// owner), contactability and the people-view listing — requires the subject's
// bio for THIS edition to be CONFIRMED (`burner_bios.completed_at` set). A new
// edition's bio opens pre-filled from last year's (./bio-carry-forward), and
// the onboarding flow saves drafts as the member moves through it, so an
// unconfirmed row may hold last year's "list me / contact me / show my photo"
// choices that the member has not yet seen this year. Those are a DEFAULT the
// member confirms on the Privacy step; until they press the final button the
// row is inert here and they read as private to everyone else.

import type { GroupKind } from "@quagga/types";
import {
  AVATAR_PRIVACY_KEY,
  campMateProjection,
  emptyBioExtras,
  type BioExtras,
  type BurnerBioFields,
  type PublicBioView,
} from "./bio";
import { fieldVisibility, type FieldVisibility } from "./privacy";

/** The group kinds whose shared membership makes two people camp-mates. */
export const CAMPMATE_GROUP_KINDS: readonly GroupKind[] = ["theme_camp"];

/** A membership as the predicates need it: which group, and what kind it is.
 * The KIND is checked here, not trusted from the caller's query, so an org or
 * artwork membership can never make two people camp-mates by accident. */
export interface CampmateMembership {
  groupId: string;
  groupKind: GroupKind;
}

/** The facts a camp-mate decision needs. The caller resolves each server-side
 * from the database, never from the request. */
export interface CampmateContext {
  viewerUserId: string;
  subjectUserId: string;
  viewerMemberships: readonly CampmateMembership[];
  subjectMemberships: readonly CampmateMembership[];
}

function campIds(memberships: readonly CampmateMembership[]): Set<string> {
  const ids = new Set<string>();
  for (const m of memberships) {
    if (CAMPMATE_GROUP_KINDS.includes(m.groupKind)) ids.add(m.groupId);
  }
  return ids;
}

/** The theme camps viewer and subject share. Empty ⇒ not camp-mates. */
export function sharedCampIds(ctx: CampmateContext): string[] {
  const viewer = campIds(ctx.viewerMemberships);
  return [...campIds(ctx.subjectMemberships)].filter((id) => viewer.has(id));
}

/**
 * Are these two people camp-mates? Fail-closed: no shared theme camp ⇒ false.
 * A person is not their OWN camp-mate — self-access is the owner's own profile,
 * a separate and wider view, and a predicate that answered yes for self would
 * make "camp-mates can contact me" include messaging yourself.
 */
export function areCampMates(ctx: CampmateContext): boolean {
  if (ctx.viewerUserId === ctx.subjectUserId) return false;
  return sharedCampIds(ctx).length > 0;
}

/**
 * The camp-mate view of a bio, or `null` when the viewer is NOT the subject's
 * camp-mate — the refusal is the null, and a caller that renders the null as
 * "nothing shared" still shows nothing. Server-side only: the apps call this
 * after loading both people's memberships from the database.
 */
export function campmateBioView(
  ctx: CampmateContext,
  bio: {
    fields: BurnerBioFields;
    privacyFlags: Readonly<Record<string, unknown>>;
    extras?: BioExtras;
    /** This edition's bio was confirmed (completed_at set). Unconfirmed ⇒
     * refused: carried-forward levels are a default, not a choice yet. */
    confirmed: boolean;
  },
): PublicBioView | null {
  if (!bio.confirmed) return null;
  if (!areCampMates(ctx)) return null;
  return campMateProjection(
    bio.fields,
    bio.privacyFlags,
    bio.extras ?? emptyBioExtras(),
  );
}

// --- Profile photo --------------------------------------------------------

/** Who the photo is shared with. Reads the `avatar` privacy flag; absent ⇒
 * private (the default for every new setting). */
export function avatarVisibility(
  privacyFlags: Readonly<Record<string, unknown>>,
): FieldVisibility {
  return fieldVisibility(privacyFlags, AVATAR_PRIVACY_KEY);
}

/**
 * May this viewer see the subject's photo? The owner always; otherwise the
 * photo's OWN level decides — public ⇒ any signed-in viewer, camp_mates ⇒ a
 * camp-mate, private ⇒ nobody. `viewerSignedIn` is required rather than
 * assumed because the photo proxy is an HTTP route: an anonymous request is a
 * real input there, and it is refused even for a public photo (profiles are a
 * signed-in surface, and the photo is no more public than the page it sits on).
 */
export function canViewAvatar(input: {
  ctx: CampmateContext;
  viewerSignedIn: boolean;
  privacyFlags: Readonly<Record<string, unknown>>;
  /** A sanitized (deleted) account shows nobody anything. */
  subjectSanitized?: boolean;
  /** The subject's bio this edition is confirmed. The owner sees their own
   * photo regardless; everyone else only once the level is confirmed. */
  subjectConfirmed: boolean;
}): boolean {
  if (!input.viewerSignedIn) return false;
  if (input.subjectSanitized) return false;
  if (input.ctx.viewerUserId === input.ctx.subjectUserId) return true;
  if (!input.subjectConfirmed) return false;
  const level = avatarVisibility(input.privacyFlags);
  if (level === "public") return true;
  if (level === "camp_mates") return areCampMates(input.ctx);
  return false;
}

// --- Contactability -------------------------------------------------------

/**
 * Who may contact a burner (the future direct-message epic reads this; there is
 * no messaging UI yet). Default `nobody` — the privacy-preserving choice: being
 * reachable is something a member turns on, never something they discover was
 * on.
 */
export const CONTACTABILITY_LEVELS = [
  "nobody",
  "camp_mates",
  "anyone",
] as const;

export type Contactability = (typeof CONTACTABILITY_LEVELS)[number];

export const DEFAULT_CONTACTABILITY: Contactability = "nobody";

/** Decode a stored value, failing closed to `nobody`. */
export function readContactability(value: unknown): Contactability {
  return value === "camp_mates" || value === "anyone" ? value : "nobody";
}

/**
 * May the viewer start contact with the subject? Nobody contacts themselves, a
 * sanitized account, or anyone who has not opted in. `camp_mates` requires a
 * genuinely shared theme camp; `anyone` means any signed-in burner.
 */
export function canContact(input: {
  ctx: CampmateContext;
  contactable: unknown;
  subjectSanitized?: boolean;
  /** The subject's bio this edition is confirmed — see the module header. */
  subjectConfirmed: boolean;
}): boolean {
  if (input.ctx.viewerUserId === input.ctx.subjectUserId) return false;
  if (input.subjectSanitized) return false;
  if (!input.subjectConfirmed) return false;
  const level = readContactability(input.contactable);
  if (level === "anyone") return true;
  if (level === "camp_mates") return areCampMates(input.ctx);
  return false;
}

// --- Camp-mate settings (carried per edition) ------------------------------

/** The two per-edition camp-mate settings that are not per-field flags. */
export interface CampmateSettings {
  contactable: Contactability;
  /** Opted in to the camp's "people" view this edition. */
  listedInCampPeople: boolean;
}

/** Every new setting defaults to private: unreachable, and not listed. */
export function defaultCampmateSettings(): CampmateSettings {
  return { contactable: DEFAULT_CONTACTABILITY, listedInCampPeople: false };
}

/** Coerce whatever was stored/sent into safe settings (fail closed). */
export function readCampmateSettings(raw: {
  contactable?: unknown;
  listedInCampPeople?: unknown;
}): CampmateSettings {
  return {
    contactable: readContactability(raw.contactable),
    listedInCampPeople: raw.listedInCampPeople === true,
  };
}

// --- People in my camp ----------------------------------------------------

/**
 * May this viewer open the people view of this group? Only a member of it, and
 * only when it is a theme camp. A non-member is refused whatever the camp's
 * registration status — so a free camp's people stay undiscoverable, and a
 * registered camp's still belong to its members.
 */
export function canViewCampPeople(input: {
  viewerMemberships: readonly CampmateMembership[];
  groupId: string;
  groupKind: GroupKind;
}): boolean {
  if (!CAMPMATE_GROUP_KINDS.includes(input.groupKind)) return false;
  return campIds(input.viewerMemberships).has(input.groupId);
}

/** One row of the people view. A LIST shape: it has no slot for medical notes
 * or any always-private field, by construction — lists never carry them. */
export interface CampPersonCard {
  userId: string;
  displayName: string;
  isViewer: boolean;
  /** Whether the viewer may load this person's photo (the proxy re-checks). */
  showAvatar: boolean;
  fields: PublicBioView;
}

/** A camp member as the people view's loader hands them over. */
export interface CampPersonInput {
  userId: string;
  displayName: string;
  sanitized: boolean;
  hasAvatar: boolean;
  /** This edition's bio, or null when they have none yet. */
  bio: {
    fields: BurnerBioFields;
    privacyFlags: Readonly<Record<string, unknown>>;
    extras?: BioExtras;
    listedInCampPeople: boolean;
    /** completed_at set this edition. An unconfirmed opt-in lists nobody. */
    confirmed: boolean;
  } | null;
  memberships: readonly CampmateMembership[];
}

/**
 * Build the people view for a viewer. Returns `null` (refused) unless the
 * viewer is a member of the group; otherwise one card per member who opted in
 * this edition, each projected as a camp-mate sees them. The viewer's own card
 * is included when they opted in, projected the SAME way (so it previews what
 * their camp-mates see, not their private profile).
 */
export function buildCampPeopleView(input: {
  viewerUserId: string;
  viewerMemberships: readonly CampmateMembership[];
  groupId: string;
  groupKind: GroupKind;
  members: readonly CampPersonInput[];
}): CampPersonCard[] | null {
  if (
    !canViewCampPeople({
      viewerMemberships: input.viewerMemberships,
      groupId: input.groupId,
      groupKind: input.groupKind,
    })
  ) {
    return null;
  }
  const cards: CampPersonCard[] = [];
  for (const member of input.members) {
    if (member.sanitized || !member.bio?.listedInCampPeople) continue;
    // A carried-forward opt-in the member has not confirmed this edition.
    if (!member.bio.confirmed) continue;
    // The listed member must ALSO be in this group — a loader bug that handed
    // over someone else's row must not put a stranger on the list.
    const inGroup = member.memberships.some(
      (m) => m.groupId === input.groupId && m.groupKind === input.groupKind,
    );
    if (!inGroup) continue;

    const isViewer = member.userId === input.viewerUserId;
    const ctx: CampmateContext = {
      viewerUserId: input.viewerUserId,
      subjectUserId: member.userId,
      viewerMemberships: input.viewerMemberships,
      subjectMemberships: member.memberships,
    };
    const fields = isViewer
      ? campMateProjection(
          member.bio.fields,
          member.bio.privacyFlags,
          member.bio.extras ?? emptyBioExtras(),
        )
      : campmateBioView(ctx, member.bio);
    if (!fields) continue;
    cards.push({
      userId: member.userId,
      displayName: member.displayName,
      isViewer,
      // The viewer's own card previews what CAMP-MATES see, so their photo
      // shows there only if they shared it beyond themselves.
      showAvatar:
        member.hasAvatar &&
        (isViewer
          ? avatarVisibility(member.bio.privacyFlags) !== "private"
          : canViewAvatar({
              ctx,
              viewerSignedIn: true,
              privacyFlags: member.bio.privacyFlags,
              subjectSanitized: member.sanitized,
              subjectConfirmed: member.bio.confirmed,
            })),
      fields,
    });
  }
  return cards;
}
