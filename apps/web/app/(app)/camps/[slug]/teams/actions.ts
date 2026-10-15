"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCampUser } from "@/lib/session";
import {
  addCampTeamMembers,
  createCampTeam,
  joinCampTeam,
  leaveCampTeam,
  removeCampTeamMember,
  setCampTeamArchived,
  setCampTeamLead,
  updateCampTeam,
  type TeamResult,
} from "@/lib/camp-teams-store";

// Camp team actions (docs/camp-teams-spec.md). Thin on purpose: WHO the
// caller is comes from the session, and everything else — the Zod parse of
// the whole input (@quagga/types camp-teams.ts), the caller's membership and
// account (locked FOR SHARE), whether they may manage the team, and the
// team-chat participant rows that follow the seat — happens inside the
// store's transaction over facts it reads itself. A stranger, a former
// member and an unknown id all get "That team doesn't exist.".

const Target = z.object({
  slug: z.string().min(1).max(200),
  teamId: z.string().uuid().optional(),
});

/** Refreshes the camp page tile, the team list, one team page and the inbox
 * (joining or leaving changes which team chats it lists). */
function revalidate(raw: unknown, teamId?: string) {
  const t = Target.safeParse(raw);
  if (!t.success) return;
  const { slug } = t.data;
  revalidatePath(`/camps/${slug}`);
  revalidatePath(`/camps/${slug}/teams`);
  const id = teamId ?? t.data.teamId;
  if (id) revalidatePath(`/camps/${slug}/teams/${id}`);
  revalidatePath("/messages");
}

/** Wraps a store write: session user in, revalidate on success. */
async function write<T extends object>(
  raw: unknown,
  run: (userId: string) => Promise<TeamResult<T>>,
): Promise<TeamResult<T>> {
  const user = await requireCampUser();
  const result = await run(user.id);
  if (result.ok) revalidate(raw);
  return result;
}

/** "Create team" (camp leads). Its chat is made with it. */
export async function createTeamAction(
  raw: unknown,
): Promise<TeamResult<{ id: string }>> {
  const user = await requireCampUser();
  const result = await createCampTeam(user.id, raw);
  if (result.ok) revalidate(raw, result.id);
  return result;
}

/** "Save" on Edit team (team leads and camp leads). */
export async function updateTeamAction(raw: unknown): Promise<TeamResult> {
  return write(raw, (userId) => updateCampTeam(userId, raw));
}

/** "Archive team" / "Restore team" (camp leads). */
export async function archiveTeamAction(raw: unknown): Promise<TeamResult> {
  return write(raw, (userId) => setCampTeamArchived(userId, raw));
}

/** "Join" — into the team and its chat, from now on. */
export async function joinTeamAction(raw: unknown): Promise<TeamResult> {
  return write(raw, (userId) => joinCampTeam(userId, raw));
}

/** "Leave team" — out of the team and its chat. */
export async function leaveTeamAction(raw: unknown): Promise<TeamResult> {
  return write(raw, (userId) => leaveCampTeam(userId, raw));
}

/** "Add people" (team leads and camp leads). Each person is told. */
export async function addTeamMembersAction(
  raw: unknown,
): Promise<TeamResult<{ added: number }>> {
  return write(raw, (userId) => addCampTeamMembers(userId, raw));
}

/** "Remove" one person (team leads and camp leads). Shifts are kept. */
export async function removeTeamMemberAction(
  raw: unknown,
): Promise<TeamResult> {
  return write(raw, (userId) => removeCampTeamMember(userId, raw));
}

/** Make someone on the team a team lead, or stop them being one. */
export async function setTeamLeadAction(raw: unknown): Promise<TeamResult> {
  return write(raw, (userId) => setCampTeamLead(userId, raw));
}
