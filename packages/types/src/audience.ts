import { z } from "zod";
import { Questionnaire } from "./questionnaire";
import { OfficerKey } from "./roles";

// Questionnaire audience targeting + activation inputs (questionnaire-spec
// §"Authoring levels & audiences"). The builder writes a
// `questionnaire_definitions` row (a `Questionnaire` — see ./questionnaire);
// an ACTIVATION pairs that definition with an edition, an audience spec, and
// options (blocking / due date). Resolving the audience at send time is the
// pure `resolveAudience` function in @quagga/core.
//
// This file is the VALIDATION authority for the audience shapes; the storage
// authority is `questionnaire_activations.audience` (jsonb) +
// `authored_scope` / `group_id` columns in @quagga/db schema.ts. The two must
// stay in sync.

/**
 * Where an activation was authored, mirrored on
 * `questionnaire_activations.authored_scope`. `org` = the Organiser Console
 * (org_staff/god); `group` = a project's own dashboard (its lead/admin). This
 * is the hard boundary results visibility never crosses.
 *
 * Keep in sync with `questionnaireAuthoredScopeEnum` in @quagga/db schema.ts.
 */
export const QuestionnaireAuthoredScope = z.enum(["org", "group"]);
export type QuestionnaireAuthoredScope = z.infer<
  typeof QuestionnaireAuthoredScope
>;

/**
 * Org-level OUTBOUND audience selectors (questionnaire-spec table). An outbound
 * activation targets one or more of these; each resolves to a set of user ids
 * in @quagga/core's `resolveAudience`. Grant-requester selectors resolve to
 * empty sets until the MV/art registration flows ship — that is expected.
 */
export const OrgOutboundSelector = z.enum([
  // every burner with a Burner Bio for the active edition
  "all_current_burners",
  // leads/admins of any theme_camp group
  "camp_leads",
  // leads/admins of camps with an approved registration this edition
  "registered_camp_leads",
  // leads/admins of mutant_vehicle groups
  "mv_leads",
  // MV groups whose current-edition registration has grants_interest = true
  "mv_grant_requesters",
  // leads/admins of artwork groups
  "art_leads",
  // artwork groups with grants_interest = true this edition
  "art_grant_requesters",
]);
export type OrgOutboundSelector = z.infer<typeof OrgOutboundSelector>;

/** All outbound selectors, for building a picker UI. */
export const ORG_OUTBOUND_SELECTORS = OrgOutboundSelector.options;

/** Human labels for the outbound selectors (audience picker copy). */
export const ORG_OUTBOUND_SELECTOR_LABELS: Record<OrgOutboundSelector, string> =
  {
    all_current_burners: "All current burners",
    camp_leads: "Theme camp leads",
    registered_camp_leads: "Registered camp leads",
    mv_leads: "Mutant vehicle leads",
    mv_grant_requesters: "MV grant requesters",
    art_leads: "Artwork leads",
    art_grant_requesters: "Art grant requesters",
  };

/**
 * Org INTERNAL audience — org members only. Appears solely in the Organiser
 * Console (never the participant app).
 */
export const OrgInternalAudience = z.object({
  kind: z.literal("org_internal"),
});
export type OrgInternalAudience = z.infer<typeof OrgInternalAudience>;

/** Org OUTBOUND audience — one or more outbound selectors. */
export const OrgOutboundAudience = z.object({
  kind: z.literal("org_outbound"),
  selectors: z.array(OrgOutboundSelector).min(1),
});
export type OrgOutboundAudience = z.infer<typeof OrgOutboundAudience>;

/**
 * Org OFFICER audience (questionnaire-spec §"Officer roles"): target the members
 * assigned a given officer role across every REGISTERED camp, regardless of
 * camp-level aliases (officers are never aliasable). E.g. "All registered Sound
 * Officers". Only ACCEPTED officer assignments in registered camps resolve.
 */
export const OrgOfficerAudience = z.object({
  kind: z.literal("org_officer"),
  officerKeys: z.array(OfficerKey).min(1),
});
export type OrgOfficerAudience = z.infer<typeof OrgOfficerAudience>;

/** Human labels for officer audience selectors ("All registered X"). */
export const OFFICER_AUDIENCE_LABELS: Record<z.infer<typeof OfficerKey>, string> =
  {
    lnt_officer: "All registered LNT Leads",
    safety_officer: "All registered Safety Officers",
    fire_safety_officer: "All registered Safety Barons",
    sound_officer: "All registered Sound Officers",
    safety_monitor: "All registered Safety Monitors",
  };

/**
 * Org SUPPLIERS audience (notifications-spec §"Audiences"; design frame `U8CqE`
 * "Suppliers"): broadcast to every supplier that has claimed a portal account.
 * Suppliers are a DIFFERENT account kind from burners — they are not in any
 * `memberships`/`bios` set — so this resolves through `suppliers.user_id`
 * (the account link established by claim-by-email). Accountless catalog rows
 * (`user_id` null) have nobody to notify and resolve to nothing.
 */
export const OrgSuppliersAudience = z.object({
  kind: z.literal("org_suppliers"),
});
export type OrgSuppliersAudience = z.infer<typeof OrgSuppliersAudience>;

/**
 * PROJECT audience — the project's own members, either everyone or a subset by
 * custom project role. `groupId` is the project group; `roleIds` are
 * `project_roles.id` values (ignored when `mode` is `everyone`).
 */
export const ProjectAudience = z.object({
  kind: z.literal("project"),
  groupId: z.string().min(1),
  /**
   * WHO IN THE CAMP.
   *
   * - `everyone` — every member.
   * - `roles` — holders of specific PROJECT roles (`roleIds`), the camp's own
   *   custom roles and officers.
   * - `leads` — the camp's decision-makers: `lead` and `admin` memberships.
   *   Distinct from `roles` because those two are STRUCTURAL — they are the
   *   membership row itself, not a grant on top of it, so they have no role id
   *   to name. Added for Form 2 (roadmap M4-20), which asks a camp how big it
   *   is and where it wants to be: questions only someone who can answer FOR
   *   the camp should be answering, and which every camp has someone for
   *   without anybody configuring a role first.
   */
  mode: z.enum(["everyone", "roles", "leads"]),
  roleIds: z.array(z.string().min(1)).default([]),
});
export type ProjectAudience = z.infer<typeof ProjectAudience>;

/** The audience spec stored on `questionnaire_activations.audience`. */
export const AudienceSpec = z.discriminatedUnion("kind", [
  OrgInternalAudience,
  OrgOutboundAudience,
  OrgOfficerAudience,
  OrgSuppliersAudience,
  ProjectAudience,
]);
export type AudienceSpec = z.infer<typeof AudienceSpec>;

/** The authored scope implied by an audience spec (org vs group). */
export function authoredScopeForAudience(
  spec: AudienceSpec,
): QuestionnaireAuthoredScope {
  return spec.kind === "project" ? "group" : "org";
}

/** The owning group id for a group-scoped audience, else null (org-scoped). */
export function groupIdForAudience(spec: AudienceSpec): string | null {
  return spec.kind === "project" ? spec.groupId : null;
}

// --- Builder + activation inputs ----------------------------------------
// Boundary schemas the builder/activation route handlers parse. Reuse the
// existing `Questionnaire` field types wholesale.

/**
 * Create/edit a questionnaire definition. `key` absent = create (the server
 * derives a slug key); present = edit an existing definition.
 */
export const QuestionnaireBuilderInput = z.object({
  key: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  definition: Questionnaire,
});
export type QuestionnaireBuilderInput = z.infer<
  typeof QuestionnaireBuilderInput
>;

/**
 * Activate a definition against an edition + audience with delivery options.
 * `dueAt` is an ISO-8601 string or null; the route converts it to a Date.
 */
export const QuestionnaireActivationInput = z.object({
  questionnaireKey: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  editionId: z.string().min(1),
  audience: AudienceSpec,
  blocking: z.boolean().default(true),
  dueAt: z.string().min(1).nullable().default(null),
});
export type QuestionnaireActivationInput = z.infer<
  typeof QuestionnaireActivationInput
>;
