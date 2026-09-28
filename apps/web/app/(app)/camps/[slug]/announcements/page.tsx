import Link from "next/link";
import { ArrowLeft, Megaphone, Plus } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { BulletinCard } from "@quagga/ui/components/bulletin-card";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { plainPreview } from "@quagga/core";
import { PreviewNotice } from "@/components/preview-notice";
import {
  listCampAnnouncementsForSender,
  type AuthorAnnouncement,
} from "@/lib/announcements-store";
import { loadAnnouncementsContext } from "./context";

// /camps/[slug]/announcements — the sender's view (epic #56). NEEDS DESIGN
// REVIEW: built from existing components (BulletinCard with its read-rate bar,
// EmptyState) with no canvas frame yet.
//
// Shows the viewer's OWN drafts (drafts are author-private) and this edition's
// published announcements they wrote or have posting authority over, with read
// and acknowledge counts. Nothing here names a recipient.

export const dynamic = "force-dynamic";

function fmt(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function audienceLabel(a: AuthorAnnouncement): string {
  if (a.audience.mode === "everyone") return "Everyone";
  const n = a.audience.roleIds.length;
  return `${n} ${n === 1 ? "role" : "roles"}`;
}

function publishedMeta(a: AuthorAnnouncement): string {
  const parts: string[] = [];
  if (!a.dispatchedAt && a.sendAt) parts.push(`Scheduled for ${fmt(a.sendAt)}`);
  else if (a.publishedAt)
    parts.push(`Sent ${fmt(a.dispatchedAt ?? a.publishedAt)}`);
  if (a.presentation === "acknowledge") {
    parts.push(`${a.tally.acknowledged} of ${a.tally.sent} acknowledged`);
  }
  if (!a.isMine) parts.push("by another sender");
  return parts.join(" · ");
}

export default async function CampAnnouncementsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await loadAnnouncementsContext(slug);
  if (ctx.kind === "preview") {
    return <PreviewNotice feature="Camp announcements" />;
  }
  const { camp, edition, user, sender } = ctx;

  const { drafts, published } = await listCampAnnouncementsForSender({
    groupId: camp.id,
    editionId: edition.id,
    viewerId: user.id,
    sender,
  });
  const base = `/camps/${camp.slug}/announcements`;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
          <Link href={`/camps/${camp.slug}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {camp.name}
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Announcements
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Messages to your camp&apos;s members. Only people in the audience
              ever see one.
            </p>
          </div>
          <Button asChild size="sm">
            <Link href={`${base}/new`}>
              <Plus className="h-4 w-4" aria-hidden />
              New announcement
            </Link>
          </Button>
        </div>
      </div>

      {drafts.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Your drafts
          </h2>
          {drafts.map((a) => (
            <Link key={a.id} href={`${base}/${a.id}`} className="block">
              <BulletinCard
                kicker="Announcement"
                title={a.title}
                preview={plainPreview(a.bodyMd, 160)}
                audience={audienceLabel(a)}
                meta={`Draft · last edited ${fmt(a.updatedAt)} · only you can see it`}
              />
            </Link>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Sent
        </h2>
        {published.length === 0 ? (
          <EmptyState
            icon={<Megaphone className="h-6 w-6" />}
            title="No announcements yet"
            description="When you publish one, you'll see here how many people have read it."
          />
        ) : (
          published.map((a) => (
            <Link key={a.id} href={`${base}/${a.id}`} className="block">
              <BulletinCard
                kicker="Announcement"
                title={a.title}
                preview={plainPreview(a.bodyMd, 160)}
                audience={audienceLabel(a)}
                meta={publishedMeta(a)}
                pinned={a.pinnedAt !== null}
                readRate={
                  a.dispatchedAt
                    ? { read: a.tally.read, of: a.tally.sent }
                    : undefined
                }
              />
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
