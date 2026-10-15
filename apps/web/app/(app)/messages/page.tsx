import Link from "next/link";
import { redirect } from "next/navigation";
import { Info, MessageCircle, Users } from "lucide-react";
import { teamInboxLine, unreadMessagesLine } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { requireOnboardedUser } from "@/lib/session";
import {
  listInbox,
  type DirectInboxEntry,
  type TeamInboxEntry,
} from "@/lib/messages-store";
import { PreviewNotice } from "@/components/preview-notice";
import { AvatarImage } from "@/components/avatar-image";

// /messages — the participant's inbox (epic #69): direct chats and the chats
// of the camp teams they are on, newest first (frame T4 p17kP / DwjfT).
//
// Scoped to the signed-in user inside lib/messages-store — this page never
// takes a user id from the request. The preview of each conversation is WHO
// and HOW MANY, never what: no message body is loaded for this page at all.

export const dynamic = "force-dynamic";

const TIME = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Johannesburg",
});

export default async function MessagesPage() {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  if (!isDatabaseConfigured()) return <PreviewNotice feature="Messages" />;

  const [user, edition] = await Promise.all([
    requireOnboardedUser(),
    getActiveEdition(),
  ]);
  if (!edition) return <PreviewNotice feature="Messages" />;

  // Team chats (docs/camp-teams-spec.md) sit beside direct chats: the store
  // lists only the teams the viewer is STILL on, counting only messages sent
  // after they joined and not from anyone a block stands between.
  const inbox = await listInbox({
    viewerUserId: user.id,
    editionId: edition.id,
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Private to the people in each chat
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Messages</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Only the people in a conversation can read it — not AfrikaBurn, not
          camp leads. Nobody needs a phone number. To start a chat, open
          someone&apos;s profile and press Message; you can only message people
          who chose to be contactable. Your teams&apos; chats are here too: join
          a team to get its chat.
        </p>
      </div>

      {inbox.length === 0 ? (
        <EmptyState
          icon={<MessageCircle className="h-6 w-6" aria-hidden />}
          title="No conversations yet"
          description="Being contactable is off for everyone until they turn it on, so an empty inbox is normal."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {inbox.map((entry) => (
            <li key={entry.conversationId}>
              {entry.kind === "team" ? (
                <TeamRow entry={entry} />
              ) : (
                <DirectRow entry={entry} />
              )}
            </li>
          ))}
        </ul>
      )}

      {inbox.some((e) => e.kind === "team") && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Team chats sit beside direct messages, newest first. Leave a team and
          its chat leaves this list.
        </p>
      )}
    </div>
  );
}

const ROW =
  "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40";

/** A 1:1 chat: who and how many, never what. */
function DirectRow({ entry }: { entry: DirectInboxEntry }) {
  return (
    <Link href={`/messages/${entry.conversationId}`} className={ROW}>
      <AvatarImage
        userId={entry.otherUserId}
        name={entry.otherName}
        showPhoto={entry.showAvatar}
        className="h-10 w-10 text-sm"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{entry.otherName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {entry.unread > 0
            ? unreadMessagesLine(entry.unread, entry.otherName)
            : entry.lastMessageAt
              ? `Last message ${TIME.format(entry.lastMessageAt)}`
              : "No messages yet"}
        </p>
      </div>
      <UnreadBadge n={entry.unread} />
    </Link>
  );
}

/** A team chat (frame T4): the team's name, a TEAM chip, and who sent the
 * last message — never what. */
function TeamRow({ entry }: { entry: TeamInboxEntry }) {
  const line =
    entry.unread === 0 && entry.lastMessageAt
      ? `Last message ${TIME.format(entry.lastMessageAt)}${entry.lastSenderName ? ` · from ${entry.lastSenderName}` : ""}`
      : teamInboxLine({
          unread: entry.unread,
          lastSenderName: entry.lastSenderName,
        });
  return (
    <Link href={`/messages/${entry.conversationId}`} className={ROW}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary/60 text-primary">
        <Users className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="truncate font-medium">{entry.teamName}</span>
          <Badge
            variant="outline"
            className="shrink-0 text-[10px] text-foreground"
          >
            Team
          </Badge>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          <span className="sr-only">{entry.campName} · </span>
          {line}
        </p>
      </div>
      <UnreadBadge n={entry.unread} />
    </Link>
  );
}

/** The unread count pill, or nothing. */
function UnreadBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return <Badge aria-label={`${n} unread`}>{n}</Badge>;
}
