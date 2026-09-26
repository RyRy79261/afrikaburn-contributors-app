import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { unreadMessagesLine } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { requireOnboardedUser } from "@/lib/session";
import { listInbox } from "@/lib/messages-store";
import { PreviewNotice } from "@/components/preview-notice";
import { AvatarImage } from "@/components/avatar-image";

// /messages — the participant's direct-message inbox (epic #69). NEEDS DESIGN
// REVIEW: built from existing components without a canvas frame.
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

  const inbox = await listInbox({ viewerUserId: user.id, editionId: edition.id });

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
          who chose to be contactable.
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
              <Link
                href={`/messages/${entry.conversationId}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
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
                {entry.unread > 0 && (
                  <Badge aria-label={`${entry.unread} unread`}>
                    {entry.unread}
                  </Badge>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
