import "server-only";

import { revalidatePath } from "next/cache";
import { getInvitePreview, redeemInvite, type RedeemResult } from "./invites-store";
import { sendEmail } from "./email";
import type { CampUser } from "./session";

/**
 * Claim an invite for a signed-in camp user and send the welcome mail. THE one
 * place the join is completed, shared by the accept action (`/join/[token]`) and
 * the post-authentication resume endpoint (`/join/continue`) so a join minted by
 * either route is identical.
 *
 * Authorisation is not decided here: `redeemInvite` re-validates single-use,
 * expiry and membership server-side and claims the row atomically, so a stale
 * page, a replayed action and a lost race all converge on the same answer.
 */
export async function completeInviteJoin(
  token: string,
  user: CampUser,
): Promise<RedeemResult> {
  // Read the camp name BEFORE the claim — redemption stamps the row, and the
  // welcome mail still needs to say which camp they just joined.
  const preview = await getInvitePreview(token);
  const result = await redeemInvite(token, user.id);
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
  revalidatePath(`/camps/${result.slug}`);
  return result;
}
