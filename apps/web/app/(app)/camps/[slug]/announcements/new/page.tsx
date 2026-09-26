import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { PreviewNotice } from "@/components/preview-notice";
import { AnnouncementComposer } from "@/components/announcements/composer";
import { announcementSchedulingEnabled } from "@/lib/announcements-store";
import { composerData, loadAnnouncementsContext } from "../context";
import {
  deleteAnnouncementDraftAction,
  publishAnnouncementAction,
  saveAnnouncementDraftAction,
} from "../actions";

// /camps/[slug]/announcements/new — compose (epic #56). NEEDS DESIGN REVIEW.

export const dynamic = "force-dynamic";

export default async function NewCampAnnouncementPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await loadAnnouncementsContext(slug);
  if (ctx.kind === "preview") {
    return <PreviewNotice feature="Camp announcements" />;
  }
  const { camp, sender } = ctx;
  const data = await composerData(camp.id, sender, camp.members);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href={`/camps/${camp.slug}/announcements`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Announcements
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          New announcement
        </h1>
      </div>
      <AnnouncementComposer
        slug={camp.slug}
        roles={data.roles}
        members={data.members}
        scope={data.scope}
        schedulingEnabled={announcementSchedulingEnabled()}
        saveAction={saveAnnouncementDraftAction}
        publishAction={publishAnnouncementAction}
        deleteAction={deleteAnnouncementDraftAction}
      />
    </div>
  );
}
