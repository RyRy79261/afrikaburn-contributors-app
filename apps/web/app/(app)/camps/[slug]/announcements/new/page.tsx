import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { PreviewNotice } from "@/components/preview-notice";
import { AnnouncementComposer } from "@/components/announcements/composer";
import { announcementSchedulingEnabled } from "@/lib/announcements-store";
import { preselectedTeamIds } from "@/lib/team-audience-view";
import { composerData, loadAnnouncementsContext } from "../context";
import {
  deleteAnnouncementDraftAction,
  publishAnnouncementAction,
  saveAnnouncementDraftAction,
} from "../actions";

// /camps/[slug]/announcements/new — compose (epic #56; team audience frame
// knWLt / y2O4gf). `?team=<id>` (the team page's "Post to the team") starts on
// "By team" with that team chosen, when the sender may address it.

export const dynamic = "force-dynamic";

/** The composer for a new camp announcement. */
export default async function NewCampAnnouncementPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ team?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
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
        teams={data.teams}
        members={data.members}
        scope={data.scope}
        initialTeamIds={preselectedTeamIds(
          query.team,
          data.teams.filter((t) => data.scope.targetableTeamIds.includes(t.id)),
        )}
        schedulingEnabled={announcementSchedulingEnabled()}
        saveAction={saveAnnouncementDraftAction}
        publishAction={publishAnnouncementAction}
        deleteAction={deleteAnnouncementDraftAction}
      />
    </div>
  );
}
