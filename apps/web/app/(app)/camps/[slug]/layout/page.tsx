import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, ArrowRight, LayoutGrid } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { formatPlotSize } from "@quagga/core";
import { getAuthenticatedUser } from "@/lib/auth";
import { enforceGate, getCurrentCampUser } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { loadCampLayout, loadLayoutAccess } from "@/lib/camp-layout-store";
import { PreviewNotice } from "@/components/preview-notice";
import { CampLayoutEditor } from "@/components/layout-editor/camp-layout-editor";
import { LayoutStartCard } from "@/components/layout-editor/layout-start-card";
import { LayoutReadOnlySeam } from "@/components/layout-editor/read-only-seam";

export const dynamic = "force-dynamic";

// /camps/[slug]/layout (docs/camp-layout-spec.md §Surfaces; frames L1 editor
// f3jmCq, L2 inside a Bedouin LcZsE, L3 read-only + empty states QZeG7).
//
// THE BOUNDARY IS THE SERVER. `loadLayoutAccess` resolves the viewer's
// CURRENT membership of this camp and asks @quagga/core; null — no such camp,
// not a theme camp, not a member, a former member — is the camp's ordinary
// 404, the same answer as a slug that does not exist. The layout is never
// public.
//
// WHO GETS WHAT. Editors (lead/admin, or `manage_layout`) get the editor at
// 768 px and wider. Plain members get the read-only plan, and so does
// everyone below 768 px (decision 13: 360 is view-only). Warnings reach the
// client only for editors — the loader returns null to anyone else.
//
// THE CANVAS LIBRARY LOADS HERE ONLY. Konva is imported dynamically, on the
// client, by the editor's stage component, and only once the viewport is wide
// enough to edit. No other page — and no phone — downloads it.

const ParamsSchema = z.object({ slug: z.string().min(1).max(200) });

export default async function CampLayoutPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  if (!isDatabaseConfigured()) return <PreviewNotice feature="Camp layout" />;

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  const [viewer, activeEdition] = await Promise.all([
    getCurrentCampUser(),
    getActiveEdition(),
  ]);
  if (!viewer) redirect("/auth/sign-in");
  if (!activeEdition) return <PreviewNotice feature="Camp layout" />;

  await enforceGate(viewer.id);

  const access = await loadLayoutAccess(parsed.data.slug, viewer.id);
  if (!access) notFound();
  const { camp } = access;
  const edition = { id: activeEdition.id, year: activeEdition.year };
  const view = await loadCampLayout(access, edition);
  const editionName = activeEdition.name;

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
      <Link href={`/camps/${camp.slug}`}>
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {camp.name}
      </Link>
    </Button>
  );

  // The read-only plan: plain members at every width, and editors below
  // 768 px. Built by the read-only stage; this is its seam.
  const readOnly = (
    <LayoutReadOnlySeam
      slug={camp.slug}
      editionName={editionName}
      editionYear={edition.year}
      canEdit={access.canEdit}
      view={
        view.layout
          ? {
              document: view.layout.document,
              updatedAt: view.layout.updatedAt.toISOString(),
              updatedByName: view.layout.updatedByName,
            }
          : null
      }
    />
  );

  if (!view.registration) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <div>
          {back}
          <h1 className="text-2xl font-semibold tracking-tight">Camp layout</h1>
        </div>
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-primary">
            <LayoutGrid className="h-4 w-4" aria-hidden />
          </span>
          <h2 className="font-semibold">Layout</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {access.canEdit
              ? `The layout belongs to your ${editionName} registration. Start that first.`
              : `Your camp hasn't started its ${editionName} registration yet, so there's no layout to show.`}
          </p>
          {access.canEdit && (
            <Link
              href={`/camps/${camp.slug}/registration`}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Start your registration
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
        </section>
      </div>
    );
  }

  if (!access.canEdit || !view.layout) {
    if (access.canEdit) {
      return (
        <div className="mx-auto flex max-w-6xl flex-col gap-5">
          <div>
            {back}
            <h1 className="text-2xl font-semibold tracking-tight">
              Camp layout
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {editionName} · your camp drawn to scale, in metres.
            </p>
          </div>
          <LayoutStartCard
            slug={camp.slug}
            editionName={editionName}
            lastYear={
              view.lastYear
                ? {
                    editionYear: view.lastYear.editionYear,
                    size: formatPlotSize(view.lastYear.summary),
                    objectCount: view.lastYear.summary.totalObjectCount,
                  }
                : null
            }
          />
        </div>
      );
    }
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <div>
          {back}
          <h1 className="text-2xl font-semibold tracking-tight">Camp layout</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {editionName} · read-only. The camp&apos;s leads and layout
            editors make changes.
          </p>
        </div>
        {readOnly}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="md:hidden">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight">Camp layout</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {editionName} · edit on a larger screen. On a phone the plan is
          view-only.
        </p>
        <div className="mt-5">{readOnly}</div>
      </div>
      {/* The editor needs more room than the shell's reading column: from
          lg it widens to the viewport (up to 76rem), centred on the column. */}
      <div className="hidden md:block lg:-mx-[max(0px,calc((min(100vw-4rem,76rem)-100%)/2))]">
        <CampLayoutEditor
          slug={camp.slug}
          campName={camp.name}
          editionName={editionName}
          editionYear={edition.year}
          initial={{
            document: view.layout.document,
            version: view.layout.version,
            updatedAt: view.layout.updatedAt.toISOString(),
            updatedByName: view.layout.updatedByName,
          }}
          snapshotPinnedAt={view.snapshot?.pinnedAt.toISOString() ?? null}
        />
      </div>
    </div>
  );
}
