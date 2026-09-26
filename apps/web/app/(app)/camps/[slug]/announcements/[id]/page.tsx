import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { z } from "zod";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import { MarkdownView } from "@quagga/ui/components/markdown-editor/markdown-view";
import { PreviewNotice } from "@/components/preview-notice";
import { AnnouncementComposer } from "@/components/announcements/composer";
import { AnnouncementPinToggle } from "@/components/announcements/pin-toggle";
import { getCampAnnouncementForSender } from "@/lib/announcements-store";
import { composerData, loadAnnouncementsContext } from "../context";
import {
  deleteAnnouncementDraftAction,
  publishAnnouncementAction,
  saveAnnouncementDraftAction,
  setAnnouncementPinnedAction,
} from "../actions";

// /camps/[slug]/announcements/[id] — the sender's detail (epic #56). NEEDS
// DESIGN REVIEW. A draft opens in the composer (author only — anyone else's
// draft is a 404, the same as an id that never existed). A published one is
// read-only — announcements are immutable once sent — with its read and
// acknowledge counts and the pin control. The counts are numbers only: this
// page never lists who has or hasn't read it.

export const dynamic = "force-dynamic";

const Id = z.string().uuid();

function fmt(d: Date): string {
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border p-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export default async function CampAnnouncementPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const ctx = await loadAnnouncementsContext(slug);
  if (ctx.kind === "preview") {
    return <PreviewNotice feature="Camp announcements" />;
  }
  const parsed = Id.safeParse(id);
  if (!parsed.success) notFound();
  const { camp, user, sender } = ctx;

  const announcement = await getCampAnnouncementForSender({
    groupId: camp.id,
    id: parsed.data,
    viewerId: user.id,
    sender,
  });
  if (!announcement) notFound();
  const base = `/camps/${camp.slug}/announcements`;

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
      <Link href={base}>
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Announcements
      </Link>
    </Button>
  );

  if (announcement.publishedAt === null) {
    const data = await composerData(camp.id, sender, camp.members);
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div>
          {back}
          <h1 className="text-2xl font-semibold tracking-tight">Edit draft</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Only you can see this draft until you publish it.
          </p>
        </div>
        <AnnouncementComposer
          slug={camp.slug}
          roles={data.roles}
          members={data.members}
          scope={data.scope}
          draft={{
            id: announcement.id,
            title: announcement.title,
            bodyMd: announcement.bodyMd,
            mode: announcement.audience.mode,
            roleIds: announcement.audience.roleIds,
            presentation: announcement.presentation,
            pinOnPublish: announcement.pinOnPublish,
            meetingUrl: announcement.meetingUrl,
            sendAt: announcement.sendAt?.toISOString() ?? null,
          }}
          saveAction={saveAnnouncementDraftAction}
          publishAction={publishAnnouncementAction}
          deleteAction={deleteAnnouncementDraftAction}
        />
      </div>
    );
  }

  const { tally } = announcement;
  const dispatchedAt = announcement.dispatchedAt;
  const delivered = dispatchedAt !== null;
  const mustAcknowledge = announcement.presentation === "acknowledge";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        {back}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {announcement.audience.mode === "everyone"
              ? "Everyone"
              : `${announcement.audience.roleIds.length} role(s)`}
          </Badge>
          {mustAcknowledge && <Badge variant="outline">Must acknowledge</Badge>}
          {announcement.pinnedAt && <Badge>Pinned</Badge>}
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {announcement.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {dispatchedAt
            ? `Sent ${fmt(dispatchedAt)}`
            : announcement.sendAt
              ? `Scheduled for ${fmt(announcement.sendAt)} — it goes out on the next dispatch run after that time.`
              : "Published"}
        </p>
      </div>

      {delivered && (
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3"
          aria-label="Delivery counts"
        >
          <Stat label="Sent to" value={String(tally.sent)} />
          <Stat label="Read" value={`${tally.read} of ${tally.sent}`} />
          {mustAcknowledge && (
            <Stat
              label="Acknowledged"
              value={`${tally.acknowledged} of ${tally.sent}`}
            />
          )}
        </div>
      )}

      {delivered && announcement.canPin && (
        <div className="flex flex-wrap items-center gap-3">
          <AnnouncementPinToggle
            slug={camp.slug}
            id={announcement.id}
            pinned={announcement.pinnedAt !== null}
            action={setAnnouncementPinnedAction}
          />
          <p className="text-xs text-muted-foreground">
            A pin shows as a banner on the camp dashboard for the people who
            received it. They can&apos;t dismiss it.
          </p>
        </div>
      )}

      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <MarkdownView value={announcement.bodyMd} />
          {announcement.meetingUrl && (
            <Button asChild variant="secondary" className="self-start">
              <a
                href={announcement.meetingUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                Meeting link
              </a>
            </Button>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Published announcements can&apos;t be edited or deleted. To correct one,
        post a new announcement.
      </p>
    </div>
  );
}
