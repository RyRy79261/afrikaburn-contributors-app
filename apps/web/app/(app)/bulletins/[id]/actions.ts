"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { acknowledgeAnnouncement } from "@/lib/announcement-gate";
import { requireCampUser } from "@/lib/session";

// The must-acknowledge gate's one action (epic #56). It stamps the CALLER's
// own delivery — the store keys the write on their session's user id, never on
// anything in the request — so nothing a client sends can acknowledge for
// another member.

const AcknowledgeInput = z.object({
  id: z.string().uuid(),
  /** The tick box. The server insists on it too: the acknowledgement is the
   * statement "I have read this", and it is only made by ticking. */
  confirmed: z.literal(true),
});

export type AcknowledgeResult = { ok: true } | { ok: false; error: string };

export async function acknowledgeAnnouncementAction(
  raw: unknown,
): Promise<AcknowledgeResult> {
  const parsed = AcknowledgeInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Tick the box to confirm you've read it." };
  }
  const user = await requireCampUser();
  const ok = await acknowledgeAnnouncement({
    userId: user.id,
    bulletinId: parsed.data.id,
  });
  if (!ok) return { ok: false, error: "That announcement isn't available." };
  revalidatePath(`/bulletins/${parsed.data.id}`);
  revalidatePath("/notifications");
  return { ok: true };
}
