import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, ArrowRight, LayoutGrid, Monitor } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import {
  boundaryDimensions,
  canViewCampRegistration,
  formatPlotSize,
  getLayoutCatalog,
  layoutObjectName,
} from "@quagga/core";
import { getAuthenticatedUser } from "@/lib/auth";
import { enforceGate, getCurrentCampUser } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import {
  loadCampLayout,
  loadLayoutAccess,
  type CampLayoutView,
} from "@/lib/camp-layout-store";
import { PreviewNotice } from "@/components/preview-notice";
import { CampLayoutEditor } from "@/components/layout-editor/camp-layout-editor";
import { LayoutStartCard } from "@/components/layout-editor/layout-start-card";
import { WideOnly } from "@/components/layout-editor/wide-only";
import { LayoutReadOnly } from "@/components/layout-view/layout-read-only";
import { planArea } from "@quagga/ui/lib/layout-plan-model";
import { layoutPath, parseAreaParam } from "@/lib/layout-view";

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
// everyone below 768 px (decision 13: 360 is view-only — and so is starting
// a plan, frame t7aOZ3 state 4). Warnings reach the client only for editors
// — the loader returns null to anyone else, and the read-only plan is never
// given them.
//
// `?area=<id>` opens a shade structure's covered area in the read-only
// plan. It is looked up inside the camp's own document; an id that names no
// covered area there is the page's not-found.
//
// THE CANVAS LIBRARY LOADS HERE ONLY. Konva is imported dynamically, on the
// client, by the editor's stage component, and only once the viewport is wide
// enough to edit. No other page — and no phone — downloads it.

const ParamsSchema = z.object({ slug: z.string().min(1).max(200) });

/**
 * The camp's layout page: the editor for editors on a wide screen, the
 * read-only plan for everyone else, or a covered area when `?area=` names one.
 */
export default async function CampLayoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const areaId = parseAreaParam((await searchParams).area);

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

  /** The page heading with the back link to the camp. */
  const header = (subtitle: string) => (
    <div>
      {back}
      <h1 className="text-2xl font-semibold tracking-tight">Camp layout</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );

  // The registration is the leads' to start, not every layout editor's.
  const startsRegistration = canViewCampRegistration(
    access.membership.structuralRole,
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
            {startsRegistration
              ? `The layout belongs to your ${editionName} registration. Start that first.`
              : `Your camp hasn't started its ${editionName} registration yet, so there's no layout to show.`}
          </p>
          {startsRegistration && (
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

  if (!view.layout) {
    if (access.canEdit) {
      return (
        <div className="mx-auto flex max-w-6xl flex-col gap-5">
          {header(`${editionName} · your camp drawn to scale, in metres.`)}
          <div className="hidden md:block">
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
          {/* Frame t7aOZ3 state 4: a phone does not start a plan either. */}
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 md:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-primary">
              <LayoutGrid className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="text-lg font-semibold">
              No layout for {editionName} yet
            </h2>
            <p className="text-sm text-muted-foreground">
              Draw your camp to scale, in metres. AfrikaBurn sees the plan you
              send with your registration.
            </p>
            <p className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
              <Monitor
                className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                aria-hidden
              />
              {view.lastYear
                ? "Start from last year's layout, or from an empty plot, on a tablet or computer."
                : "Start from an empty plot on a tablet or computer."}
            </p>
          </section>
        </div>
      );
    }
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        {header(`${editionName} · read-only.`)}
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-primary">
            <LayoutGrid className="h-4 w-4" aria-hidden />
          </span>
          <h2 className="font-semibold">Layout</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Your camp&apos;s leads haven&apos;t drawn the layout for{" "}
            {editionName} yet.
          </p>
        </section>
      </div>
    );
  }

  const layout = view.layout;
  // A covered area that is not in this camp's document is not found.
  const area = areaId ? planArea(layout.document, areaId) : null;
  if (areaId && !area) notFound();

  // Inside a covered area the read-only page is titled by it, and its back
  // link goes to the whole camp (frame PGk6q).
  const areaParent = area?.parent ?? null;
  const areaHeader = areaParent?.child
    ? (() => {
        const n = areaParent.child.objects.length;
        return (
          <div>
            <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
              <Link href={layoutPath(camp.slug)}>
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Whole camp
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold tracking-tight">
              {layoutObjectName(areaParent, getLayoutCatalog(edition.year))}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {`Covered area ${formatPlotSize(
                boundaryDimensions(areaParent.child.boundary),
              )} · ${n} inside`}
            </p>
          </div>
        );
      })()
    : null;

  /** The read-only plan; `warnings` only ever passed for an editor. */
  const readOnly = (
    subtitle: string,
    warnings: CampLayoutView["warnings"] = null,
  ) => (
    <LayoutReadOnly
      slug={camp.slug}
      editionYear={edition.year}
      document={layout.document}
      updatedAt={layout.updatedAt}
      updatedByName={layout.updatedByName}
      areaId={areaId}
      editorOnPhone={access.canEdit}
      warnings={warnings}
      now={new Date()}
      header={areaHeader ?? header(subtitle)}
    />
  );

  if (!access.canEdit) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        {readOnly(
          `${editionName} · read-only. The camp's leads and layout editors make changes.`,
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="md:hidden">
        {readOnly(`${editionName} · view-only on a phone.`, view.warnings)}
      </div>
      {/* The editor needs more room than the shell's reading column: from
          lg it widens to the viewport (up to 76rem), centred on the column. */}
      <div className="hidden md:block lg:-mx-[max(0px,calc((min(100vw-4rem,76rem)-100%)/2))]">
        {/* Mounted only from 768 px: a phone never gets the editor's DOM —
            its palette, warnings or autosave — only the plan above. */}
        <WideOnly>
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
        </WideOnly>
      </div>
    </div>
  );
}
