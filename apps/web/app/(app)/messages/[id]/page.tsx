import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, Lock, Users } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { requireOnboardedUser } from "@/lib/session";
import { getConversation } from "@/lib/messages-store";
import { PreviewNotice } from "@/components/preview-notice";
import { AvatarImage } from "@/components/avatar-image";
import { ConversationThread } from "@/components/messages/conversation-thread";
import { TeamChatThread } from "@/components/messages/team-chat-thread";
import {
  loadTeamChatByConversation,
  type TeamChatByConversation,
} from "@/lib/camp-teams-store";
import {
  blockUserAction,
  reportMessagesAction,
  reportTeamMessagesAction,
  sendMessageAction,
  sendTeamMessageAction,
  setConversationTimerAction,
  setTeamChatTimerAction,
  unblockUserAction,
} from "../actions";

// /messages/[id] — one direct conversation (epic #69), or one camp team's
// chat (frame T3 qsuL0 / fyZFW, docs/camp-teams-spec.md).
//
// A TEAM CHAT is served only by `loadTeamChatByConversation` → the messages
// store's `getTeamChat`, whose gate is @quagga/core `canReadTeamChat`: a
// participant row AND a current team seat with an active camp membership. A
// camp lead who is not on the team, org staff and the System manager get the
// same not-found as a stranger. The 1:1 read below refuses a team chat's id.
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
  if (!convo) {
    const team = await loadTeamChatByConversation({
      conversationId: parsed.data.id,
      viewerUserId: user.id,
    });
    if (!team) notFound();
    return <TeamChatPage team={team} />;
  }

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

/** A team chat (frame T3): the team header, then the thread. */
function TeamChatPage({ team }: { team: TeamChatByConversation }) {
  const { chat, campSlug } = team;
  const teamHref = `/camps/${campSlug}/teams/${chat.teamId}`;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href="/messages">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Messages
          </Link>
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-secondary/60 text-primary">
              <Users className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight">
                {chat.teamName}
              </h1>
              <p className="text-sm text-muted-foreground">
                Team chat · {chat.campName} · {chat.memberCount}{" "}
                {chat.memberCount === 1 ? "member" : "members"}
              </p>
            </div>
          </div>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
          >
            <Link href={teamHref}>
              <Users className="h-4 w-4" aria-hidden />
              Team page
            </Link>
          </Button>
        </div>
      </div>

      <TeamChatThread
        slug={campSlug}
        teamId={chat.teamId}
        conversationId={chat.conversationId}
        teamName={chat.teamName}
        timer={chat.timer}
        joinedAt={chat.joinedAt.toISOString()}
        canSend={chat.canSend}
        canSetTimer={chat.canSetTimer}
        archived={chat.archived}
        messages={chat.messages.map((m) => ({
          id: m.id,
          kind: m.kind,
          body: m.body,
          senderId: m.senderId,
          senderName: m.senderName,
          mine: m.mine,
          createdAt: m.createdAt.toISOString(),
          expiresAt: m.expiresAt ? m.expiresAt.toISOString() : null,
        }))}
        actions={{
          send: sendTeamMessageAction,
          setTimer: setTeamChatTimerAction,
          report: reportTeamMessagesAction,
        }}
      />

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Only the team&apos;s current members read this chat — not AfrikaBurn,
        and not camp leads unless they join the team. Leave the team and the
        chat goes with it. If you block someone, neither of you sees the
        other&apos;s messages here, and nobody leaves the team.
      </p>
    </div>
  );
}
