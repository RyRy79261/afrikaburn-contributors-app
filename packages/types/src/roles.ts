import { z } from "zod";

/**
 * Membership role ladder, recorded on `memberships.role` (one row per
 * user × group). Roles are scoped to a group — a burner can hold `member` on
 * one camp and `lead` on another, and `god` / `org_staff` on the single
 * seeded AfrikaBurn org group.
 *
 * - `god`       — system-wide admin; ONLY valid on the org group. Bootstrapped
 *                 from the `GOD_EMAILS` env list on first login.
 * - `org_staff` — AfrikaBurn reviewers/coordinators (org group only).
 * - `lead`      — a project's leader; can manage invites + registration.
 * - `admin`     — a project co-organiser below the lead.
 * - `member`    — a plain member of a group.
 *
 * Keep this tuple in sync with `membershipRoleEnum` in @quagga/db schema.ts —
 * the database is the storage authority; this is the validation authority.
 */
export const MembershipRole = z.enum([
  "god",
  "org_staff",
  "lead",
  "admin",
  "member",
]);
export type MembershipRole = z.infer<typeof MembershipRole>;

/** Roles that may enter the org/admin app (`apps/org`). */
export const ORG_APP_ROLES: readonly MembershipRole[] = ["god", "org_staff"];

/** Roles that may administer a project group (invites, registration, members). */
export const PROJECT_ADMIN_ROLES: readonly MembershipRole[] = ["lead", "admin"];
