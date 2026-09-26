import { notFound } from "next/navigation";
import { z } from "zod";
import { holdsSubmittedVersion } from "@quagga/core";
import { SECTION_KEYS, SECTION_LABELS } from "@quagga/types";
import { StatusBadge } from "@quagga/ui/components/status-badge";
import { PreviewNotice } from "@/components/preview-notice";
import {
  RegistrationAnswerList,
  registrationFieldsBySection,
} from "@/components/registration/registration-answers";
import { RegistrationSubpageHeader } from "@/components/registration/registration-subpage-header";
import {
  getDeclaredSuppliers,
  getPastRegistration,
} from "@/lib/registration-store";
import { requireRegistrationViewer } from "@/lib/registration-viewer";

export const dynamic = "force-dynamic";

// One past registration, read-only (PREVYR-001, -011; epic #50).
//
// WHAT IT SHOWS is the registration row for that edition as it stands. There is
// no version history table, so that is the last SUBMITTED version only when the
// row's status says the wizard could not have written it since
// (@quagga/core `holdsSubmittedVersion`). A row sent back for changes, withdrawn,
// or reopened to a draft may hold edits the camp made during that edition and
// never sent — `submitted_at` is never cleared, so the timestamp cannot tell.
// The copy below says which one the reader is looking at rather than calling
// unsent words "what was submitted".
//
// WHAT IT OMITS: the camp description (it lives on the camp, so it is TODAY's
// text, not what was submitted then) and the reviewer threads (they belong to
// that year's review, and replying to them now would be talking to nobody).

const ParamsSchema = z.object({
  slug: z.string().min(1),
  year: z.coerce.number().int().min(2000).max(9999),
});

export default async function PastRegistrationPage({
  params,
}: {
  params: Promise<{ slug: string; year: string }>;
}) {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const { slug, year } = parsed.data;

  const viewer = await requireRegistrationViewer(slug);
  if (!viewer.configured) {
    return <PreviewNotice feature="Past registrations" />;
  }
  const { context } = viewer;

  // `getPastRegistration` only ever returns this camp's own, SUBMITTED, EARLIER
  // edition — a later year, this year, or someone else's row finds nothing.
  const past = await getPastRegistration(
    context.group.id,
    context.editionYear,
    year,
  );
  if (!past) notFound();

  const declaredSuppliers = await getDeclaredSuppliers(past.registrationId);
  const fieldsBySection = registrationFieldsBySection({
    registration: past.row,
    campName: context.group.name,
    description: undefined,
    declaredSuppliers,
  });

  return (
    <>
      <RegistrationSubpageHeader
        backHref={`/camps/${slug}/registration/history`}
        backLabel="Back to past registrations"
        eyebrow={`${context.group.name} · Past registration`}
        title={past.editionName}
      >
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={past.status} />
          <span
            className="text-xs text-muted-foreground"
            data-testid="past-registration-provenance"
          >
            {holdsSubmittedVersion(past)
              ? `Read-only — this is what was submitted for ${past.editionYear}.`
              : `Read-only — this may include edits made after it was last submitted for ${past.editionYear}. The version AfrikaBurn last received was not kept.`}
          </span>
        </div>
      </RegistrationSubpageHeader>

      <div className="flex flex-col gap-3">
        {SECTION_KEYS.map((key) => (
          <section
            key={key}
            aria-labelledby={`past-${key}`}
            className="rounded-xl border border-border bg-card p-4"
          >
            <h2
              id={`past-${key}`}
              className="mb-3 text-sm font-medium text-foreground"
            >
              {SECTION_LABELS[key]}
            </h2>
            <RegistrationAnswerList fields={fieldsBySection[key]} />
          </section>
        ))}
      </div>
    </>
  );
}
