import { z } from "zod";

/**
 * Joinable-group kinds (`groups.kind`). A **project** is any non-org group —
 * the kind that self-registers per edition and earns entitlements. Exactly one
 * `org` group is seeded (AfrikaBurn).
 *
 * Keep in sync with `groupKindEnum` in @quagga/db schema.ts.
 */
export const GroupKind = z.enum([
  "org",
  "theme_camp",
  "artwork",
  "mutant_vehicle",
]);
export type GroupKind = z.infer<typeof GroupKind>;

/** Whether a group is a registrable project (anything that isn't the org). */
export function isProjectKind(kind: GroupKind): boolean {
  return kind !== "org";
}

/**
 * How a group accepts new members (`groups.joinability`). Surfaced in the
 * directory as an "accepting members" vs "invite-only" badge.
 */
export const Joinability = z.enum(["open", "invite_only"]);
export type Joinability = z.infer<typeof Joinability>;

/**
 * Reserved visibility column (`groups.visibility`, default `default`).
 * Visibility is currently DERIVED (registered ⇒ public, unregistered ⇒
 * members-only); this column is reserved so explicit privacy settings can land
 * later without a migration. Keep in sync with `groupVisibilityEnum`.
 */
export const GroupVisibility = z.enum([
  "default",
  "public",
  "members_only",
  "private",
]);
export type GroupVisibility = z.infer<typeof GroupVisibility>;

/**
 * One-time invite kinds (`invites.kind`).
 * - `member`        — join the group as a member.
 * - `lead_transfer` — hand over the `lead` role to the redeemer.
 */
export const InviteKind = z.enum(["member", "lead_transfer"]);
export type InviteKind = z.infer<typeof InviteKind>;
