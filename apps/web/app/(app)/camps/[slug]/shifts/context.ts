import "server-only";

import { notFound, redirect } from "next/navigation";
import { canManageShifts, shiftDays, type ShiftDay } from "@quagga/core";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition, type Edition } from "@/lib/edition";
import { getCampBySlug, type CampDetail } from "@/lib/groups-store";
import { enforceGate, requireCampUser, type CampUser } from "@/lib/session";
import {
  ensureStarterTeams,
  loadShiftBoard,
  type ShiftBoard,
  type ShiftMemberView,
} from "@/lib/shifts-store";

// The shared guard for every /camps/[slug]/shifts page (epic #57). Shifts are
// for the camp's CURRENT members only: a stranger, a former member and a
// member of another camp all get the camp's ordinary 404 — the same answer as
// a camp that does not exist, so a free camp's shifts are as undiscoverable as
// the camp itself. Manager-only pages add their own `canManage` check.

export type ShiftsContext =
  | { kind: "preview" }
  | {
      kind: "ready";
      user: CampUser;
      edition: Edition;
      camp: CampDetail;
      board: ShiftBoard;
      days: ShiftDay[];
      /** The viewer's own membership, as the board sees it. */
      me: ShiftMemberView;
      canManage: boolean;
    };

export async function loadShiftsContext(slug: string): Promise<ShiftsContext> {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  if (!isDatabaseConfigured()) return { kind: "preview" };

  const user = await requireCampUser();
  await enforceGate(user.id);

  const edition = await getActiveEdition();
  if (!edition) return { kind: "preview" };

  const camp = await getCampBySlug(slug, edition.id, user.id);
  if (!camp || !camp.viewerRole) notFound();

  const canManage = canManageShifts({
    structuralRole: camp.viewerRole,
    rolePermissions: [],
  });
  // The starter team list is written the first time a LEAD opens Shifts.
  if (canManage) await ensureStarterTeams(camp.id);

  const board = await loadShiftBoard(camp.id, edition.id);
  const me = board.members.find((m) => m.userId === user.id);
  // Archived between the two reads: no membership, no page.
  if (!me) notFound();

  return {
    kind: "ready",
    user,
    edition,
    camp,
    board,
    days: shiftDays(edition),
    me,
    canManage,
  };
}

/** A manager-only page: everyone else gets the same 404. */
export async function loadManagerContext(
  slug: string,
): Promise<ShiftsContext> {
  const ctx = await loadShiftsContext(slug);
  if (ctx.kind === "ready" && !ctx.canManage) notFound();
  return ctx;
}
