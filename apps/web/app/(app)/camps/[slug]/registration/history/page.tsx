import Link from "next/link";
import { ChevronRight, History } from "lucide-react";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { StatusBadge } from "@quagga/ui/components/status-badge";
import { PreviewNotice } from "@/components/preview-notice";
import { RegistrationSubpageHeader } from "@/components/registration/registration-subpage-header";
import { listPastRegistrations } from "@/lib/registration-store";
import { requireRegistrationViewer } from "@/lib/registration-viewer";

export const dynamic = "force-dynamic";

// "Past registrations" (App Spec PREVYR-001, -011; epic #50): every earlier
// edition this camp SUBMITTED, newest first, each one a click away from a
// read-only view of what was sent. Nothing here can be edited or re-sent — a
// past registration is a record, and the only way to reuse its words is the
// carry-forward offer on this year's draft.
//
// AUDIENCE: exactly who can open the registration itself (the camp's leads and
// admins), enforced by `requireRegistrationViewer`.

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function PastRegistrationsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const viewer = await requireRegistrationViewer(slug);
  if (!viewer.configured) {
    return <PreviewNotice feature="Past registrations" />;
  }
  const { context } = viewer;

  const past = await listPastRegistrations(
    context.group.id,
    context.editionYear,
  );

  return (
    <>
      <RegistrationSubpageHeader
        backHref={`/camps/${slug}/registration`}
        backLabel={`Back to the ${context.editionYear} registration`}
        eyebrow={`${context.group.name} · Theme camp registration`}
        title="Past registrations"
      />

      {past.length === 0 ? (
        <EmptyState
          icon={<History className="h-6 w-6" />}
          title="No earlier registrations yet"
          description={`Registrations ${context.group.name} submitted for earlier editions will appear here once there are some.`}
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Past registrations">
          {past.map((p) => (
            <li key={p.registrationId}>
              <Link
                href={`/camps/${slug}/registration/history/${p.editionYear}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {p.editionName}
                  </p>
                  {p.submittedAt ? (
                    <p className="text-xs text-muted-foreground">
                      Last submitted {formatDate(p.submittedAt)}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={p.status} />
                  <ChevronRight
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
