import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { getAuthenticatedUser } from "@/lib/auth";
import { enforceGate, getCurrentCampUser } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { loadCampStats } from "@/lib/camp-stats-store";
import { PreviewNotice } from "@/components/preview-notice";
import { CampStatsSections } from "@/components/stats/camp-stats-sections";

export const dynamic = "force-dynamic";

// Camp statistics (docs/camp-stats-spec.md; frame C1 — desktop b7zfxq,
// mobile oaV8b).
//
// THE BOUNDARY IS THE SERVER, and it is the roster's: `loadCampStats` resolves
// the viewer's membership of THIS camp and asks @quagga/core
// `canViewCampStats` (= `canViewCampRoster`, theme camps only) before a single
// member row is read. A refusal is a not-found — the same outcome as a slug
// that does not exist, exactly as the roster answers — so the page is no
// oracle for which camps exist or who leads them.
//
// COUNTS ONLY. The figures link to the lists behind them, and only to lists
// this viewer may already open (`links`, each page's own predicate).

const ParamsSchema = z.object({ slug: z.string().min(1).max(200) });

export default async function CampStatsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  if (!isDatabaseConfigured()) {
    return <PreviewNotice feature="Camp statistics" />;
  }

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  const [viewer, edition] = await Promise.all([
    getCurrentCampUser(),
    getActiveEdition(),
  ]);
  if (!viewer) redirect("/auth/sign-in");
  if (!edition) return <PreviewNotice feature="Camp statistics" />;

  await enforceGate(viewer.id);

  const page = await loadCampStats({
    slug: parsed.data.slug,
    viewerUserId: viewer.id,
    edition,
  });
  if (!page) notFound();
  const { camp, stats, links } = page;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href={`/camps/${camp.slug}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {camp.name}
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          Camp statistics
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {camp.name} in {edition.name}, counted from what the camp already
          holds. Counts only — open a figure to see the list behind it.
        </p>
      </div>

      <CampStatsSections
        slug={camp.slug}
        stats={stats}
        links={links}
        editionName={edition.name}
        eventStart={edition.startDate}
      />

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Counts only, never names. Deleted accounts are not counted anywhere.
      </p>
    </div>
  );
}
