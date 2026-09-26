import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { requireOnboardedUser } from "@/lib/session";
import { getConversation } from "@/lib/messages-store";
import { PreviewNotice } from "@/components/preview-notice";
import { AvatarImage } from "@/components/avatar-image";
import { ConversationThread } from "@/components/messages/conversation-thread";
import {
  blockUserAction,
  reportMessagesAction,
  sendMessageAction,
  setConversationTimerAction,
  unblockUserAction,
} from "../actions";

// /messages/[id] — one direct conversation (epic #69). NEEDS DESIGN REVIEW.
//
// THE BOUNDARY IS THE SERVER: `getConversation` → @quagga/core
// `canReadConversation` returns null for anyone who is not a participant —
// org staff, the System manager and camp leads included — and this page turns
// that into the SAME not-found as an id that does not exist. The other
// participant is shown by handle and (permission-checked) photo only; no bio
// field, phone number or medical note is loaded for this page.

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  if (!isDatabaseConfigured()) return <PreviewNotice feature="Messages" />;

  const [user, edition] = await Promise.all([
    requireOnboardedUser(),
    getActiveEdition(),
  ]);
  if (!edition) return <PreviewNotice feature="Messages" />;

  const convo = await getConversation({
    viewerUserId: user.id,
    conversationId: parsed.data.id,
    editionId: edition.id,
  });
  if (!convo) notFound();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href="/messages">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Messages
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <AvatarImage
            userId={convo.other.userId}
            name={convo.other.name}
            showPhoto={convo.other.showAvatar}
            className="h-11 w-11 text-sm"
          />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {convo.other.departed ? (
                convo.other.name
              ) : (
                <Link
                  href={`/burners/${convo.other.userId}`}
                  className="underline-offset-4 hover:underline"
                >
                  {convo.other.name}
                </Link>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              Only the two of you can read this conversation.
            </p>
          </div>
        </div>
      </div>

      <ConversationThread
        conversationId={convo.id}
        otherUserId={convo.other.userId}
        otherName={convo.other.name}
        timer={convo.timer}
        canSend={convo.canSend}
        blockedByViewer={convo.blockedByViewer}
        messages={convo.messages.map((m) => ({
          id: m.id,
          kind: m.kind,
          body: m.body,
          senderName: m.senderName,
          mine: m.mine,
          createdAt: m.createdAt.toISOString(),
          expiresAt: m.expiresAt ? m.expiresAt.toISOString() : null,
        }))}
        actions={{
          send: sendMessageAction,
          setTimer: setConversationTimerAction,
          block: blockUserAction,
          unblock: unblockUserAction,
          report: reportMessagesAction,
        }}
      />
    </div>
  );
}
