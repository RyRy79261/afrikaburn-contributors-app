import { notFound } from "next/navigation";
import { Card, CardContent } from "@quagga/ui/components/card";

import { guardConsole } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import { getActiveEdition } from "@/lib/queries";
import { getBulletin } from "@/lib/bulletins";
import { formatDate } from "@/lib/labels";
import { BulletinComposer } from "@/components/bulletins/bulletin-composer";

// Edit a bulletin — the compose form seeded with the stored row. Drafts can be
// published from here (the same `saveBulletin` action fans out); a published
// bulletin can be corrected but never re-broadcast, so the action refuses to
// re-publish and the form hides the publish button.

export const dynamic = "force-dynamic";

export default async function EditBulletinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const { id } = await params;
  const [bulletin, edition] = await Promise.all([
    getBulletin(id),
    getActiveEdition(),
  ]);
  if (!bulletin) notFound();

  const published = bulletin.publishedAt !== null;

  return (
    <div>
      <PageHeading
        eyebrow={
          published
            ? "Console / Bulletins / Sent"
            : "Console / Bulletins / Draft"
        }
        title={published ? "Edit bulletin" : "Edit draft"}
        description={
          published
            ? `Published ${formatDate(bulletin.publishedAt)} · ${bulletin.readCount} of ${bulletin.sentCount} recipients have read it.`
            : "Title, body, audience. That's it — bulletins never collect data."
        }
      />

      {!edition ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No active edition is seeded yet — a bulletin can only be broadcast
            against an active edition.
          </CardContent>
        </Card>
      ) : (
        <BulletinComposer
          editionId={edition.id}
          editionName={edition.name}
          bulletin={{
            id: bulletin.id,
            title: bulletin.title,
            bodyMd: bulletin.bodyMd,
            audience: bulletin.audience,
            pinned: bulletin.pinned,
            published,
          }}
        />
      )}
    </div>
  );
}
