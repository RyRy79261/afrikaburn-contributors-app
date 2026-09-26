"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  MESSAGE_MAX_LENGTH,
  MESSAGE_TIMERS,
  REPORT_MAX_MESSAGES,
  REPORT_REASON_MAX_LENGTH,
} from "@quagga/core";
import { requireOnboardedUser } from "@/lib/session";
import { getActiveEdition } from "@/lib/edition";
import {
  blockUser,
  reportMessages,
  saveDefaultMessageTimer,
  sendMessage,
  setConversationTimer,
  startConversation,
  unblockUser,
} from "@/lib/messages-store";

// Direct messaging server actions (epic #69). Every one: Zod at the boundary,
// the signed-in, onboarded user resolved server-side (never an id from the
// client), and the decision left to @quagga/core via lib/messages-store.

type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const Uuid = z.string().uuid();
const INVALID = { ok: false as const, error: "That request wasn't valid." };

const StartInput = z.object({ targetUserId: Uuid });

/** Open (or create) the chat with a burner, then go to it. Used as a form
 * action from the burner's profile. */
export async function startConversationAction(formData: FormData): Promise<void> {
  const parsed = StartInput.safeParse({
    targetUserId: formData.get("targetUserId"),
  });
  if (!parsed.success) redirect("/messages");
  const user = await requireOnboardedUser();
  const edition = await getActiveEdition();
  if (!edition) redirect("/messages");
  const result = await startConversation({
    viewerUserId: user.id,
    targetUserId: parsed.data.targetUserId,
    editionId: edition.id,
  });
  if (!result.ok) redirect(`/burners/${parsed.data.targetUserId}?message=unavailable`);
  redirect(`/messages/${result.conversationId}`);
}

const SendInput = z.object({
  conversationId: Uuid,
  body: z.string().min(1).max(MESSAGE_MAX_LENGTH * 2),
});

export async function sendMessageAction(
  input: unknown,
): Promise<ActionResult<{ phoneHint: boolean }>> {
  const parsed = SendInput.safeParse(input);
  if (!parsed.success) return INVALID;
  const user = await requireOnboardedUser();
  const result = await sendMessage({
    viewerUserId: user.id,
    conversationId: parsed.data.conversationId,
    body: parsed.data.body,
  });
  if (result.ok) revalidatePath(`/messages/${parsed.data.conversationId}`);
  return result;
}

const TimerInput = z.object({
  conversationId: Uuid,
  timer: z.enum(MESSAGE_TIMERS),
});

export async function setConversationTimerAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = TimerInput.safeParse(input);
  if (!parsed.success) return INVALID;
  const user = await requireOnboardedUser();
  const result = await setConversationTimer({
    viewerUserId: user.id,
    conversationId: parsed.data.conversationId,
    timer: parsed.data.timer,
  });
  if (result.ok) revalidatePath(`/messages/${parsed.data.conversationId}`);
  return result;
}

const BlockInput = z.object({ targetUserId: Uuid });

export async function blockUserAction(input: unknown): Promise<ActionResult> {
  const parsed = BlockInput.safeParse(input);
  if (!parsed.success) return INVALID;
  const user = await requireOnboardedUser();
  const result = await blockUser({
    viewerUserId: user.id,
    targetUserId: parsed.data.targetUserId,
  });
  if (result.ok) {
    revalidatePath("/messages");
    revalidatePath(`/burners/${parsed.data.targetUserId}`);
  }
  return result;
}

export async function unblockUserAction(input: unknown): Promise<ActionResult> {
  const parsed = BlockInput.safeParse(input);
  if (!parsed.success) return INVALID;
  const user = await requireOnboardedUser();
  const result = await unblockUser({
    viewerUserId: user.id,
    targetUserId: parsed.data.targetUserId,
  });
  if (result.ok) {
    revalidatePath("/messages");
    revalidatePath(`/burners/${parsed.data.targetUserId}`);
  }
  return result;
}

const ReportInput = z.object({
  conversationId: Uuid,
  messageIds: z.array(Uuid).min(1).max(REPORT_MAX_MESSAGES),
  reason: z.string().max(REPORT_REASON_MAX_LENGTH).nullable(),
});

export async function reportMessagesAction(
  input: unknown,
): Promise<ActionResult<{ reportId: string }>> {
  const parsed = ReportInput.safeParse(input);
  if (!parsed.success) return INVALID;
  const user = await requireOnboardedUser();
  return reportMessages({
    viewerUserId: user.id,
    conversationId: parsed.data.conversationId,
    messageIds: parsed.data.messageIds,
    reason: parsed.data.reason,
  });
}

const DefaultTimerInput = z.object({ timer: z.enum(MESSAGE_TIMERS) });

/** The personal default timer from /profile — applied to chats you start. */
export async function saveDefaultMessageTimerAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = DefaultTimerInput.safeParse(input);
  if (!parsed.success) return INVALID;
  const user = await requireOnboardedUser();
  await saveDefaultMessageTimer(user.id, parsed.data.timer);
  revalidatePath("/profile");
  return { ok: true };
}
