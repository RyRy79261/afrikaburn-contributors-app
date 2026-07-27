import { guardConsole } from "@/lib/gate";
import { getActiveEdition, getStatusBoard } from "@/lib/queries";
import {
  getRecentActivity,
  getSubmissionSeries,
  hasSeries,
} from "@/lib/status-board";
import { PageHeading } from "@/components/page-heading";
import { KpiCards } from "@/components/status-board/kpi-cards";
import { RegistrationFunnelCard } from "@/components/status-board/registration-funnel";
import {
  OfficerCoverageCard,
  QuestionnaireCompletionCard,
  SupplierOnboardingCard,
} from "@/components/status-board/coverage";
import { RegistrationsChart } from "@/components/status-board/registrations-chart";
import { RecentActivity } from "@/components/status-board/recent-activity";

// The status board (build-spec §"Org stats dashboard" + §"Status board KPI
// row", canvas frame RTfFF / w6X0wA): the same four KPI cards as the Overview,
// the registration funnel, registrations over time, the coverage rails and the
// activity feed. The time series comes from `registrations.submitted_at`; when
// there is less than two months of history the chart is omitted rather than
// drawn over invented points. No payment surface exists anywhere on this page.

export const dynamic = "force-dynamic";

export default async function StatusBoardPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const edition = await getActiveEdition();
  // Three independent reads off the same edition — issued together.
  const [board, series, activity] = await Promise.all([
    getStatusBoard(edition),
    getSubmissionSeries(edition?.id ?? null),
    getRecentActivity(guard.session.actor, 6),
  ]);

  const updatedAt = new Date().toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow={edition ? `${edition.name} · Console` : "Organiser console"}
        title="Status board"
        description="Everything you need to run the burn, at a glance."
        actions={
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-ab-sage" aria-hidden />
            Live · updated {updatedAt}
          </span>
        }
      />

      <KpiCards kpis={board.kpis} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <RegistrationFunnelCard funnel={board.funnel} />
          {hasSeries(series) && <RegistrationsChart points={series} />}
        </div>
        <div className="flex flex-col gap-4">
          <OfficerCoverageCard coverage={board.officerCoverage} />
          <QuestionnaireCompletionCard rollup={board.questionnaires} />
          <SupplierOnboardingCard
            onboarding={board.supplierOnboarding}
            standings={board.supplierStandings}
          />
        </div>
      </div>

      <RecentActivity rows={activity} />
    </div>
  );
}
