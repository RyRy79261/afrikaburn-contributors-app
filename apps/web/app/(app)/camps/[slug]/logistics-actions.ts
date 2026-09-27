"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCampUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import { saveOwnLogistics, type SaveLogisticsResult } from "@/lib/roster-store";

// A member saving their OWN build/strike/arrival/departure (epic #55,
// CDB-011..014). THE BOUNDARY: Zod on the envelope here; whose record it is
// comes from the session and the slug inside `saveOwnLogistics` — never from
// the body, whose logistics shape @quagga/core parses STRICTLY, so a request
// naming a membership or a user is refused outright. A lead has no path to
// another member's row: `view_member_details` is a read grant, and the
// records are self-owned (Decision 008).

const SaveLogisticsEnvelope = z
  .object({
    slug: z.string().min(1).max(200),
    logistics: z.unknown(),
  })
  .strict();

export async function saveMyLogisticsAction(
  raw: unknown,
): Promise<SaveLogisticsResult> {
  const parsed = SaveLogisticsEnvelope.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "That didn't look like a travel plan." };
  }
  const user = await requireCampUser();
  const edition = await getActiveEdition();
  if (!edition) {
    return { ok: false, error: "There's no active edition to plan for yet." };
  }
  const result = await saveOwnLogistics({
    slug: parsed.data.slug,
    userId: user.id,
    edition,
    raw: parsed.data.logistics,
  });
  if (result.ok) {
    revalidatePath(`/camps/${parsed.data.slug}`);
    revalidatePath(`/camps/${parsed.data.slug}/roster`);
  }
  return result;
}
