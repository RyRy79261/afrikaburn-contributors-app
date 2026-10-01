"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  ShiftCreateInput,
  ShiftTeamName,
  ShiftUpdateInput,
} from "@quagga/core";

import { activeMembership } from "@quagga/db";

import { db, schema } from "@/lib/db";
import { getActiveEdition, type Edition } from "@/lib/edition";
import { requireCampUser } from "@/lib/session";
import {
  addShiftTeam,
  assignToShift,
  createShifts,
  deleteShift,
  handShiftTo,
  leaveShift,
  offerShift,
  removeShiftTeam,
  renameShiftTeam,
  respondToHandOn,
  signUpForShift,
  takeOfferedShift,
  unassignFromShift,
  updateShift,
  withdrawHandOn,
  type ShiftResult,
} from "@/lib/shifts-store";

// Camp shift actions (epic #57). Zod at the boundary; every request names the
// camp by slug and then only ids. WHO the caller is comes from the session;
// whether they may do it is decided by @quagga/core inside the store's
// transaction, over facts it reads itself. Nothing here is a permission check
// on its own — the store refuses a non-member, a former member and a
// non-manager whatever this file does.
//
// NEVER the org group: a participant-app action that resolved the org's slug
// would be one check away from editing AfrikaBurn's own membership.

export type ShiftActionResult<T = object> = ShiftResult<T>;

const Slug = z.string().min(1).max(200);
const Id = z.string().uuid();
const NOT_FOUND = "Camp not found.";

async function resolve(slug: string): Promise<
  | {
      ok: true;
      groupId: string;
      userId: string;
      edition: Edition;
    }
  | { ok: false; error: string }
> {
  const user = await requireCampUser();
  const [group] = await db()
    .select({ id: schema.groups.id, kind: schema.groups.kind })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  if (!group || group.kind === "org") return { ok: false, error: NOT_FOUND };
  // ONE answer for "no such camp" and "a camp you are not in" (M4): anything
  // else tells a stranger a free camp exists at that slug — the oracle the
  // directory, profiles and type-aheads all refuse to be. The store re-checks
  // the membership under a lock; this read only keeps the answers identical.
  const [member] = await db()
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.groupId, group.id),
        eq(schema.memberships.userId, user.id),
        activeMembership(),
      ),
    )
    .limit(1);
  if (!member) return { ok: false, error: NOT_FOUND };
  const edition = await getActiveEdition();
  if (!edition) return { ok: false, error: "No active edition is configured." };
  return { ok: true, groupId: group.id, userId: user.id, edition };
}

function firstIssue(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

function revalidate(slug: string) {
  revalidatePath(`/camps/${slug}`);
  revalidatePath(`/camps/${slug}/shifts`, "layout");
}

// --- Lead ---------------------------------------------------------------------

export async function createShiftsAction(
  raw: unknown,
): Promise<ShiftActionResult<{ created: number }>> {
  const parsed = ShiftCreateInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, "Check the shift.") };
  }
  const { slug, ...fields } = parsed.data;
  const r = await resolve(slug);
  if (!r.ok) return r;
  const result = await createShifts({
    actorUserId: r.userId,
    groupId: r.groupId,
    edition: r.edition,
    fields,
  });
  if (result.ok) revalidate(slug);
  return result;
}

export async function updateShiftAction(
  raw: unknown,
): Promise<ShiftActionResult> {
  const parsed = ShiftUpdateInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, "Check the shift.") };
  }
  const { slug, ...fields } = parsed.data;
  const r = await resolve(slug);
  if (!r.ok) return r;
  const result = await updateShift({
    actorUserId: r.userId,
    groupId: r.groupId,
    edition: r.edition,
    fields,
  });
  if (result.ok) revalidate(slug);
  return result;
}

const ShiftRef = z.object({ slug: Slug, shiftId: Id }).strict();

export async function deleteShiftAction(
  raw: unknown,
): Promise<ShiftActionResult> {
  const parsed = ShiftRef.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That shift doesn't exist." };
  const r = await resolve(parsed.data.slug);
  if (!r.ok) return r;
  const result = await deleteShift({
    actorUserId: r.userId,
    groupId: r.groupId,
    editionId: r.edition.id,
    shiftId: parsed.data.shiftId,
  });
  if (result.ok) revalidate(parsed.data.slug);
  return result;
}

const AssignInput = ShiftRef.extend({ membershipId: Id }).strict();

export async function assignToShiftAction(
  raw: unknown,
): Promise<ShiftActionResult> {
  const parsed = AssignInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Pick someone to assign." };
  const r = await resolve(parsed.data.slug);
  if (!r.ok) return r;
  const result = await assignToShift({
    actorUserId: r.userId,
    groupId: r.groupId,
    editionId: r.edition.id,
    shiftId: parsed.data.shiftId,
    membershipId: parsed.data.membershipId,
  });
  if (result.ok) revalidate(parsed.data.slug);
  return result;
}

const AssignmentRef = ShiftRef.extend({ assignmentId: Id }).strict();

export async function unassignFromShiftAction(
  raw: unknown,
): Promise<ShiftActionResult> {
  const parsed = AssignmentRef.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That person isn't on it." };
  const r = await resolve(parsed.data.slug);
  if (!r.ok) return r;
  const result = await unassignFromShift({
    actorUserId: r.userId,
    groupId: r.groupId,
    editionId: r.edition.id,
    shiftId: parsed.data.shiftId,
    assignmentId: parsed.data.assignmentId,
  });
  if (result.ok) revalidate(parsed.data.slug);
  return result;
}

const TeamAdd = z.object({ slug: Slug, name: ShiftTeamName }).strict();
const TeamRename = TeamAdd.extend({ teamId: Id }).strict();
const TeamRef = z.object({ slug: Slug, teamId: Id }).strict();

export async function addShiftTeamAction(
  raw: unknown,
): Promise<ShiftActionResult<{ id: string }>> {
  const parsed = TeamAdd.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, "Check the name.") };
  }
  const r = await resolve(parsed.data.slug);
  if (!r.ok) return r;
  const result = await addShiftTeam({
    actorUserId: r.userId,
    groupId: r.groupId,
    name: parsed.data.name,
  });
  if (result.ok) revalidate(parsed.data.slug);
  return result;
}

export async function renameShiftTeamAction(
  raw: unknown,
): Promise<ShiftActionResult> {
  const parsed = TeamRename.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, "Check the name.") };
  }
  const r = await resolve(parsed.data.slug);
  if (!r.ok) return r;
  const result = await renameShiftTeam({
    actorUserId: r.userId,
    groupId: r.groupId,
    teamId: parsed.data.teamId,
    name: parsed.data.name,
  });
  if (result.ok) revalidate(parsed.data.slug);
  return result;
}

export async function removeShiftTeamAction(
  raw: unknown,
): Promise<ShiftActionResult> {
  const parsed = TeamRef.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That team doesn't exist." };
  const r = await resolve(parsed.data.slug);
  if (!r.ok) return r;
  const result = await removeShiftTeam({
    actorUserId: r.userId,
    groupId: r.groupId,
    teamId: parsed.data.teamId,
  });
  if (result.ok) revalidate(parsed.data.slug);
  return result;
}

// --- Member -------------------------------------------------------------------

type MemberWrite = (input: {
  userId: string;
  groupId: string;
  editionId: string;
  shiftId: string;
}) => Promise<ShiftResult>;

async function memberWrite(
  raw: unknown,
  write: MemberWrite,
): Promise<ShiftActionResult> {
  const parsed = ShiftRef.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That shift doesn't exist." };
  const r = await resolve(parsed.data.slug);
  if (!r.ok) return r;
  const result = await write({
    userId: r.userId,
    groupId: r.groupId,
    editionId: r.edition.id,
    shiftId: parsed.data.shiftId,
  });
  if (result.ok) revalidate(parsed.data.slug);
  return result;
}

export async function signUpForShiftAction(
  raw: unknown,
): Promise<ShiftActionResult> {
  return memberWrite(raw, signUpForShift);
}

export async function leaveShiftAction(
  raw: unknown,
): Promise<ShiftActionResult> {
  return memberWrite(raw, leaveShift);
}

export async function offerShiftAction(
  raw: unknown,
): Promise<ShiftActionResult> {
  return memberWrite(raw, offerShift);
}

export async function withdrawHandOnAction(
  raw: unknown,
): Promise<ShiftActionResult> {
  return memberWrite(raw, withdrawHandOn);
}

const HandToInput = ShiftRef.extend({ toMembershipId: Id }).strict();

export async function handShiftToAction(
  raw: unknown,
): Promise<ShiftActionResult> {
  const parsed = HandToInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Pick a campmate." };
  const r = await resolve(parsed.data.slug);
  if (!r.ok) return r;
  const result = await handShiftTo({
    userId: r.userId,
    groupId: r.groupId,
    editionId: r.edition.id,
    shiftId: parsed.data.shiftId,
    toMembershipId: parsed.data.toMembershipId,
  });
  if (result.ok) revalidate(parsed.data.slug);
  return result;
}

const RespondInput = ShiftRef.extend({ accept: z.boolean() }).strict();

export async function respondToHandOnAction(
  raw: unknown,
): Promise<ShiftActionResult> {
  const parsed = RespondInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That request is gone." };
  const r = await resolve(parsed.data.slug);
  if (!r.ok) return r;
  const result = await respondToHandOn({
    userId: r.userId,
    groupId: r.groupId,
    editionId: r.edition.id,
    shiftId: parsed.data.shiftId,
    accept: parsed.data.accept,
  });
  if (result.ok) revalidate(parsed.data.slug);
  return result;
}

export async function takeOfferedShiftAction(
  raw: unknown,
): Promise<ShiftActionResult> {
  const parsed = AssignmentRef.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That spot is gone." };
  const r = await resolve(parsed.data.slug);
  if (!r.ok) return r;
  const result = await takeOfferedShift({
    userId: r.userId,
    groupId: r.groupId,
    editionId: r.edition.id,
    shiftId: parsed.data.shiftId,
    assignmentId: parsed.data.assignmentId,
  });
  if (result.ok) revalidate(parsed.data.slug);
  return result;
}
