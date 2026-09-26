import Link from "next/link";
import { GitCompare } from "lucide-react";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { RegistrationChanges } from "@quagga/ui/components/registration-changes";
import { PreviewNotice } from "@/components/preview-notice";
import { RegistrationSubpageHeader } from "@/components/registration/registration-subpage-header";
import {
  getRegistration,
  getRegistrationComparison,
} from "@/lib/registration-store";
import { requireRegistrationViewer } from "@/lib/registration-viewer";

export const dynamic = "force-dynamic";

// "What changed since last year", camp-side (App Spec PREVYR-010; epic #50).
//
// THE SAME DIFF THE REVIEWER READS. `getRegistrationComparison` runs
// @quagga/core `selectComparisonPrior` + `changedFields` — the functions behind
// the org console's comparison — and renders through the same
// `RegistrationChanges` component. A camp checking its draft before submitting
// sees what AfrikaBurn will see after.
//
// A SEPARATE PAGE, NOT A PANEL IN THE WIZARD. The wizard autosaves as the camp
// types; a diff rendered beside it at page load would be stale after the first
// keystroke and would say "unchanged" about a field just rewritten. Opened from
// the workspace, this page is computed fresh from what is saved.
//
// READ-ONLY. Nothing here writes, and in particular nothing marks a section
// complete — the rollover rule (docs/roadmap.md R1) is untouched.

export default async function RegistrationChangesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const viewer = await requireRegistrationViewer(slug);
  if (!viewer.configured) {
    return <PreviewNotice feature="Registration changes" />;
  }
  const { context } = viewer;

  const current = await getRegistration(context.group.id, context.editionId);
  const comparison = await getRegistrationComparison({
    groupId: context.group.id,
    editionYear: context.editionYear,
    current,
  });

  return (
    <>
      <RegistrationSubpageHeader
        backHref={`/camps/${slug}/registration`}
        backLabel={`Back to the ${context.editionYear} registration`}
        eyebrow={`${context.group.name} · ${context.editionName}`}
        title={
          comparison
            ? `What changed since ${comparison.priorYear}`
            : "What changed since last year"
        }
      />

      {comparison ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Your saved {context.editionYear} answers compared with{" "}
            {comparison.basis === "carried_forward"
              ? `the ${comparison.priorYear} registration you brought across`
              : `your ${comparison.priorYear} registration`}
            . This is what AfrikaBurn&apos;s reviewer sees above your
            registration.{" "}
            {comparison.priorSubmitted ? (
              <Link
                href={`/camps/${slug}/registration/history/${comparison.priorYear}`}
                className="text-accent hover:underline"
              >
                Read the {comparison.priorYear} registration
              </Link>
            ) : null}
          </p>
          <RegistrationChanges
            priorYear={comparison.priorYear}
            currentYear={context.editionYear}
            changes={comparison.changes}
            basis={comparison.basis}
            audience="camp"
          />
        </div>
      ) : (
        <EmptyState
          icon={<GitCompare className="h-6 w-6" />}
          title="Nothing to compare with yet"
          description={`${context.group.name} has no submitted registration from an earlier edition, so there is no "last year" to compare against.`}
        />
      )}
    </>
  );
}
