import "server-only";

import { listRoles } from "@/lib/roles-store";
import type { ShiftBoard } from "@/lib/shifts-store";
import type { ShiftFormRole } from "@/components/shifts/shift-form";

/** The camp roles a shift may require, with how many current members hold
 * each. Baseline is held by everyone, so "requiring" it would mean nothing. */
export async function shiftFormRoles(
  campId: string,
  board: ShiftBoard,
): Promise<ShiftFormRole[]> {
  const roles = await listRoles(campId);
  return roles
    .filter((r) => r.kind !== "baseline")
    .map((r) => ({
      id: r.id,
      name: r.name,
      holders: board.members.filter((m) => m.heldRoleIds.includes(r.id))
        .length,
    }));
}
