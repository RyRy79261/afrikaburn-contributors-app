"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCampUser } from "@/lib/session";
import { redeemInvite, getInvitePreview } from "@/lib/invites-store";
import { sendEmail } from "@/lib/email";

const RedeemInput = z.object({ token: z.string().min(1) });

export type RedeemActionResult =
  | { ok: true; slug: string }
  | { ok: false; error: string };

/** Redeem a one-time invite for the signed-in user, then send a welcome email
 * (console-logged when Resend is unconfigured). */
export async function redeemInviteAction(
  raw: unknown,
): Promise<RedeemActionResult> {
  const parsed = RedeemInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid invite." };
  const user = await requireCampUser();

  const preview = await getInvitePreview(parsed.data.token);
  const result = await redeemInvite(parsed.data.token, user.id);
  if (!result.ok) return result;

  if (user.email && preview) {
    await sendEmail({
      to: user.email,
      subject: `You've joined ${preview.groupName}`,
      text:
        `You're now a member of ${preview.groupName} for AfrikaBurn.\n\n` +
        `Open your camp: /camps/${preview.groupSlug}\n\n` +
        `See you in the dust.`,
    }).catch(() => undefined);
  }

  revalidatePath("/directory");
  return result;
}
