import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { BulletinCard } from "@quagga/ui/components/bulletin-card";
import { Button } from "@quagga/ui/components/button";
import { EmptyState } from "@quagga/ui/components/empty-state";

import { guardConsole } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import { formatDate } from "@/lib/labels";
import { listBulletins, type BulletinSummary } from "@/lib/bulletins";
import { plainPreview } from "@/components/bulletins/preview-text";

// Org Bulletins list (canvas `QqnNq` · mobile `laWqH`): everything the org has
// broadcast, sent first with its read-rate bar, then drafts (muted, never sent).
// Read-only surface — every mutation lives behind the compose form's actions.

export const dynamic = "force-dynamic";

export default async function BulletinsPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const bulletins = await listBulletins();
  const sent = bulletins.filter((b) => b.publishedAt !== null);
  const drafts = bulletins.filter((b) => b.publishedAt === null);

  return (
    <div>
      <PageHeading
        eyebrow="Console / Bulletins"
        title="Bulletins"
        description="Broadcasts to an audience — informational only. Anything that needs an answer is a questionnaire."
        actions={
          <Button asChild>
            <Link href="/bulletins/new">
              <Plus aria-hidden />
              New bulletin
            </Link>
          </Button>
        }
      />

      {bulletins.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-8 w-8" aria-hidden />}
          title="No bulletins yet"
          description="Write one when there is something every camp lead (or every burner) needs to know. Keep it to what they can act on."
          action={
            <Button asChild>
              <Link href="/bulletins/new">
                <Plus aria-hidden />
                New bulletin
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {sent.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Sent
              </h2>
              {sent.map((bulletin) => (
                <BulletinRow key={bulletin.id} bulletin={bulletin} />
              ))}
            </section>
          )}

          {drafts.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Drafts
              </h2>
              {drafts.map((bulletin) => (
                <BulletinRow key={bulletin.id} bulletin={bulletin} />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/** One list row: the shared BulletinCard, linked to its compose/edit view. */
function BulletinRow({ bulletin }: { bulletin: BulletinSummary }) {
  const isDraft = bulletin.publishedAt === null;
  return (
    <Link
      href={`/bulletins/${bulletin.id}/edit`}
      className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <BulletinCard
        title={bulletin.title}
        preview={plainPreview(bulletin.bodyMd)}
        audience={bulletin.audienceLabel}
        pinned={bulletin.pinned}
        meta={
          isDraft
            ? `Draft · not sent · last edited ${formatDate(bulletin.updatedAt)}`
            : `From AfrikaBurn · ${formatDate(bulletin.publishedAt)}`
        }
        readRate={
          isDraft
            ? undefined
            : { read: bulletin.readCount, of: bulletin.sentCount }
        }
        className={isDraft ? "opacity-70 transition-opacity hover:opacity-100" : undefined}
      />
    </Link>
  );
}
