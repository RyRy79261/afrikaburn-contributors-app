import { Card, CardContent } from "@quagga/ui/components/card";

import { guardConsole } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import { getActiveEdition } from "@/lib/queries";
import { BulletinComposer } from "@/components/bulletins/bulletin-composer";

// Compose a new bulletin (canvas `U8CqE` · mobile `zW1uE`). The form itself is
// a client component; this page only clears the console gate and hands it the
// active edition the audience resolves against.

export const dynamic = "force-dynamic";

export default async function NewBulletinPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const edition = await getActiveEdition();

  return (
    <div>
      <PageHeading
        eyebrow="Console / Bulletins / New"
        title="New bulletin"
        description="Title, body, audience. That's it — bulletins never collect data."
      />

      {!edition ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No active edition is seeded yet — a bulletin can only be broadcast
            against an active edition.
          </CardContent>
        </Card>
      ) : (
        <BulletinComposer editionId={edition.id} editionName={edition.name} />
      )}
    </div>
  );
}
