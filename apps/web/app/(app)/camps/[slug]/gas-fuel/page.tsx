import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, ArrowRight, Fuel } from "lucide-react";
import { canViewCampRegistration, describeGasFuelRecord } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { getAuthenticatedUser } from "@/lib/auth";
import { enforceGate, getCurrentCampUser } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { loadGasFuelAccess, loadGasFuelPage } from "@/lib/gas-fuel-store";
import { PreviewNotice } from "@/components/preview-notice";
import { GasFuelForm } from "@/components/gas-fuel/gas-fuel-form";

export const dynamic = "force-dynamic";

// /camps/[slug]/gas-fuel (docs/registration-safety-spec.md §"The gas & fuel
// record"; frames T7rUD / qjdpW). An OPTIONAL camp record: never required,
// never in the registration's completeness, never public.
//
// THE BOUNDARY IS THE SERVER. `loadGasFuelAccess` resolves the viewer's
// CURRENT membership; null is the camp's ordinary 404. Every current member
// reads; leads, co-leads and `manage_layout` holders edit (@quagga/core
// `canEditGasFuelRecord`), and the save action decides that again.

const ParamsSchema = z.object({ slug: z.string().min(1).max(200) });

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Johannesburg",
});

export default async function GasFuelPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  if (!isDatabaseConfigured()) {
    return <PreviewNotice feature="Gas & fuel record" />;
  }
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  const [viewer, activeEdition] = await Promise.all([
    getCurrentCampUser(),
    getActiveEdition(),
  ]);
  if (!viewer) redirect("/auth/sign-in");
  if (!activeEdition) return <PreviewNotice feature="Gas & fuel record" />;
  await enforceGate(viewer.id);

  const access = await loadGasFuelAccess(parsed.data.slug, viewer.id);
  if (!access) notFound();
  const { camp } = access;
  const edition = { id: activeEdition.id, year: activeEdition.year };
  const view = await loadGasFuelPage(access, edition);

  const header = (
    <header className="flex flex-col gap-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href={`/camps/${camp.slug}`}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {camp.name}
        </Link>
      </Button>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {activeEdition.name} · Camp record
      </p>
      <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
        Gas &amp; fuel record
        <Badge variant="outline">Optional</Badge>
      </h1>
      <p className="max-w-prose text-sm text-muted-foreground">
        What your camp is bringing that burns: gas bottles, jerry cans, barrels
        and fuel trailers. It isn&apos;t part of registration — fill it in
        whenever you know, before the burn. Your wrangler uses it to plan the
        fuel depot. Nobody signs it off here; the Safety Officer checks on
        site.
      </p>
      {view.stored && !view.stored.isDraft && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Fuel className="h-3.5 w-3.5" aria-hidden />
          Saved {dateFmt.format(view.stored.updatedAt)}
          {view.stored.updatedByName ? ` by ${view.stored.updatedByName}` : ""}
        </p>
      )}
    </header>
  );

  if (!view.registrationId) {
    const startsRegistration = canViewCampRegistration(
      access.membership.structuralRole,
    );
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {header}
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            {startsRegistration
              ? `The gas & fuel record belongs to your ${activeEdition.name} registration. Start that first.`
              : `Your camp hasn't started its ${activeEdition.name} registration yet.`}
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      {header}
      <GasFuelForm
        // A new row (carried forward, or saved) remounts the form with it.
        key={`${view.stored?.isDraft ?? "none"}-${view.stored?.updatedAt.getTime() ?? 0}`}
        slug={camp.slug}
        canEdit={access.canEditRecord}
        stored={
          view.stored
            ? { record: view.stored.record, isDraft: view.stored.isDraft }
            : null
        }
        lastYear={
          view.lastYear
            ? {
                editionYear: view.lastYear.editionYear,
                summary: describeGasFuelRecord(view.lastYear.record),
              }
            : null
        }
        wranglerName={view.wranglerName}
      />
    </div>
  );
}
