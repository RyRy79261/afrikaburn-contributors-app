import { z } from "zod";

// Camp teams and team chat (docs/camp-teams-spec.md). This file is the
// VALIDATION authority for every team input crossing a server-action
// boundary; the storage authority is `shift_teams`, `team_members` and
// `conversations` (kind `team`) in @quagga/db schema.ts, and the rules live in
// @quagga/core camp-teams.ts.
//
// Every input names a camp by slug plus ids and text. Who may act — a camp
// lead, a team lead, a member joining an open team — is decided server-side
// from the session, never from the payload: nothing here carries a role.

/** Who may put people on a team. Mirrors `team_join_mode` in @quagga/db. */
export const TEAM_JOIN_MODES = ["open", "leads_add"] as const;
/** A team's join mode, validated. */
export const TeamJoinMode = z.enum(TEAM_JOIN_MODES);
export type TeamJoinMode = z.infer<typeof TeamJoinMode>;

/** Longest team name (the shifts team editor's limit — one list). */
export const TEAM_NAME_MAX = 40;
/** Longest team description (markdown). */
export const TEAM_DESCRIPTION_MAX = 5_000;
/** Most team leads one team may have. */
export const TEAM_MAX_LEADS = 10;
/** Most people one "Add people" may add at once. */
export const TEAM_ADD_MAX = 50;

/**
 * The team chat's disappearing-messages timers. The SAME vocabulary as direct
 * messages (@quagga/core `MESSAGE_TIMERS`; a core test pins the two equal).
 */
export const TEAM_CHAT_TIMERS = ["off", "24h", "7d", "90d"] as const;

const Slug = z.string().min(1).max(200);
const Id = z.string().uuid();

const TeamName = z
  .string()
  .trim()
  .min(1, "Give the team a name.")
  .max(TEAM_NAME_MAX, `Keep team names under ${TEAM_NAME_MAX} characters.`);

/** Empty means "no description". */
const TeamDescription = z
  .string()
  .max(TEAM_DESCRIPTION_MAX, "That description is too long.")
  .default("")
  .transform((v) => (v.trim() ? v : null));

/** Create a team (camp leads). Leads are optional; its chat is made with it. */
export const CreateTeamInput = z
  .object({
    slug: Slug,
    name: TeamName,
    description: TeamDescription,
    joinMode: TeamJoinMode.default("open"),
    leadUserIds: z
      .array(Id)
      .max(TEAM_MAX_LEADS, `A team can have up to ${TEAM_MAX_LEADS} leads.`)
      .default([]),
  })
  .strict();
export type CreateTeamInput = z.input<typeof CreateTeamInput>;

/** Edit a team's page (team leads and camp leads). */
export const UpdateTeamInput = z
  .object({
    slug: Slug,
    teamId: Id,
    name: TeamName,
    description: TeamDescription,
    joinMode: TeamJoinMode,
  })
  .strict();
export type UpdateTeamInput = z.input<typeof UpdateTeamInput>;

/** Archive or restore a team (camp leads). */
export const ArchiveTeamInput = z
  .object({ slug: Slug, teamId: Id, archived: z.boolean() })
  .strict();
export type ArchiveTeamInput = z.input<typeof ArchiveTeamInput>;

/** Join or leave a team yourself. */
export const TeamSelfInput = z.object({ slug: Slug, teamId: Id }).strict();
export type TeamSelfInput = z.input<typeof TeamSelfInput>;

/** Add camp members to a team (team leads and camp leads). */
export const AddTeamMembersInput = z
  .object({
    slug: Slug,
    teamId: Id,
    userIds: z
      .array(Id)
      .min(1, "Choose someone to add.")
      .max(TEAM_ADD_MAX, `Add up to ${TEAM_ADD_MAX} people at a time.`),
  })
  .strict();
export type AddTeamMembersInput = z.input<typeof AddTeamMembersInput>;

/** Remove one person from a team (team leads and camp leads). */
export const RemoveTeamMemberInput = z
  .object({ slug: Slug, teamId: Id, userId: Id })
  .strict();
export type RemoveTeamMemberInput = z.input<typeof RemoveTeamMemberInput>;

/** Make someone a team lead, or stop them being one. */
export const SetTeamLeadInput = z
  .object({ slug: Slug, teamId: Id, userId: Id, isLead: z.boolean() })
  .strict();
export type SetTeamLeadInput = z.input<typeof SetTeamLeadInput>;

/** Set the team chat's disappearing timer (team leads and camp leads who are
 * on the team). */
export const SetTeamChatTimerInput = z
  .object({ slug: Slug, teamId: Id, timer: z.enum(TEAM_CHAT_TIMERS) })
  .strict();
export type SetTeamChatTimerInput = z.input<typeof SetTeamChatTimerInput>;

/** Post into a team chat. Length is re-checked by the store. */
export const SendTeamMessageInput = z
  .object({ slug: Slug, teamId: Id, body: z.string().min(1).max(4_000) })
  .strict();
export type SendTeamMessageInput = z.input<typeof SendTeamMessageInput>;

/** Report selected team-chat messages to the org safety queue. */
export const ReportTeamMessagesInput = z
  .object({
    slug: Slug,
    teamId: Id,
    messageIds: z.array(Id).min(1).max(20),
    reason: z.string().max(1_000).nullable().default(null),
  })
  .strict();
export type ReportTeamMessagesInput = z.input<typeof ReportTeamMessagesInput>;
