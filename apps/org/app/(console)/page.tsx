import Link from "next/link";
import {
  ArrowRight,
  ClipboardList,
  ListChecks,
  Package,
  Send,
  Tags,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@quagga/ui/components/card";
import { DisabledHintTile } from "@quagga/ui/components/disabled-hint-tile";
import { guardConsole } from "@/lib/gate";
import { getActiveEdition, getStatusBoard } from "@/lib/queries";
import { getRecentActivity } from "@/lib/status-board";
import { formatDate } from "@/lib/labels";
import { PageHeading } from "@/components/page-heading";
import { KpiCards } from "@/components/status-board/kpi-cards";
import { RegistrationPipelineStrip } from "@/components/status-board/registration-funnel";
import {
  OfficerCoverageCard,
  SupplierOnboardingCard,
} from "@/components/status-board/coverage";
import { RecentActivity } from "@/components/status-board/recent-activity";

// The console landing page (build-spec §"Org stats dashboard" — the 25 Jul
// overhaul, canvas frame obd4x / pKW7z): the four entity KPI cards, the
// registration pipeline, the coverage row, outbound questionnaires, quick links
// and the activity feed. Every number is a real query result run through the
// @quagga/core derivations — the Status Board shares the same components, so
// the two pages cannot disagree. Registration is free: no payment surface here.

export const dynamic = "force-dynamic";

/**
 * Console destinations that exist today (canvas quick-links grid). Supplier
 * sign-up management is a live tile here (frame node `cYXlB`) — the page ships
 * at /suppliers/signup-management; it is deliberately NOT in the header nav,
 * which is already eight items wide, so this tile and the Suppliers page link
 * are its two entry points.
 */
const QUICK_LINKS = [
  {
    href: "/registrations",
    icon: ClipboardList,
    title: "Registrations",
    desc: "Review & decide camp registrations",
  },
  {
    href: "/suppliers",
    icon: Package,
    title: "Suppliers",
    desc: "Track supplier onboarding & standing",
  },
  {
    href: "/questionnaires",
    icon: ListChecks,
    title: "Questionnaires",
    desc: "Send & track outbound forms",
  },
  {
    href: "/categories",
    icon: Tags,
    title: "Camp categories",
    desc: "Manage the camp category taxonomy",
  },
  {
    href: "/accounts",
    icon: Users,
    title: "Accounts",
    desc: "People, roles & access",
  },
  {
    href: "/suppliers/signup-management",
    icon: UserPlus,
    title: "Supplier sign-up management",
    desc: "Approve who joins the suppliers list",
  },
] as const;

export default async function OverviewPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const edition = await getActiveEdition();
  const board = await getStatusBoard(edition);
  const activity = await getRecentActivity(6);

  const updatedAt = new Date().toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const sends = board.questionnaires.sends.length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow={
          edition ? `${edition.name} · Console` : "Organiser console"
        }
        title="Overview"
        description={
          edition
            ? `${formatDate(edition.startDate)} – ${formatDate(edition.endDate)} — the whole console at a glance.`
            : "No active edition is seeded yet. Numbers appear once the database is seeded."
        }
        actions={
          <div className="flex flex-col items-end gap-1.5">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full bg-ab-sage"
                aria-hidden
              />
              Live · updated {updatedAt}
            </span>
            <Link
              href="/status"
              className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
            >
              Status board
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        }
      />

      <KpiCards kpis={board.kpis} />

      <RegistrationPipelineStrip funnel={board.funnel} />

      <section
        aria-label="Coverage"
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
      >
        {/* Wrangler assignment has no data model yet (no assignments exist to
            count), so the tile is honestly parked rather than faked. */}
        <DisabledHintTile
          title="Wranglers"
          hint="Wrangler assignment isn't built yet — there is no assignment data to report on."
          tag="Coming later"
          icon={<UserCog className="h-4 w-4" />}
          className="h-full"
        />
        <OfficerCoverageCard coverage={board.officerCoverage} />
        <SupplierOnboardingCard
          onboarding={board.supplierOnboarding}
          standings={board.supplierStandings}
        />
      </section>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-base font-semibold">
              <Send className="h-4 w-4 text-accent" aria-hidden />
              Outbound questionnaires
            </span>
            <p className="text-xs text-muted-foreground">
              {sends === 0
                ? "No questionnaires are open right now."
                : `${sends} active send${sends === 1 ? "" : "s"} · ${board.questionnaires.completionPct}% completion · ${board.questionnaires.totalCompleted} of ${board.questionnaires.totalSent} responses in`}
            </p>
          </div>
          <Link
            href="/questionnaires"
            className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
          >
            Questionnaires
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </CardContent>
      </Card>

      <section
        aria-label="Console sections"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {QUICK_LINKS.map(({ href, icon: Icon, title, desc }) => (
          <Link key={title} href={href} className="group">
            <Card className="h-full transition-colors group-hover:border-accent/60">
              <CardContent className="flex flex-col gap-1.5 p-5">
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-accent" aria-hidden />
                  <span className="text-sm font-semibold">{title}</span>
                </span>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>

      <RecentActivity rows={activity} />
    </div>
  );
}
