import Link from "next/link";
import { ClipboardList, Package, CreditCard, Tent } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { Badge } from "@quagga/ui/components/badge";
import type { RegistrationStatus } from "@quagga/types";
import { guardConsole } from "@/lib/gate";
import { getOverviewCounts } from "@/lib/queries";
import { PageHeading } from "@/components/page-heading";
import { RegistrationStatusBadge } from "@/components/status-badges";

export const dynamic = "force-dynamic";

const STATUS_ORDER: RegistrationStatus[] = [
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
  "rejected",
  "draft",
  "withdrawn",
];

const NEEDS_ATTENTION: RegistrationStatus[] = ["submitted", "under_review"];

export default async function OverviewPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const counts = await getOverviewCounts();
  const needsAttention = NEEDS_ATTENTION.reduce(
    (sum, s) => sum + counts.registrationsByStatus[s],
    0,
  );

  const tiles = [
    {
      href: "/registrations",
      icon: ClipboardList,
      label: "Registrations",
      value: counts.registrationsTotal,
      sub: `${needsAttention} awaiting review`,
    },
    {
      href: "/registrations",
      icon: Tent,
      label: "Camps & projects",
      value: counts.camps,
      sub: "Free + registered groups",
    },
    {
      href: "/suppliers",
      icon: Package,
      label: "Suppliers",
      value: counts.suppliers,
      sub: "In the vetting repository",
    },
    {
      href: "/payments",
      icon: CreditCard,
      label: "Payments",
      value: counts.pendingPayments,
      sub: "Parked — camps never pay to register",
    },
  ] as const;

  return (
    <div>
      <PageHeading
        eyebrow="Overview"
        title={
          counts.edition
            ? `${counts.edition.name} at a glance`
            : "Organiser overview"
        }
        description={
          counts.edition
            ? `Reviewing contributions for ${counts.edition.startDate} to ${counts.edition.endDate}. Approving a registration is what makes a camp "registered" and lights up its entitlements.`
            : "No active edition is seeded yet. Counts appear once the database is seeded."
        }
        actions={
          counts.edition ? (
            <Badge variant="secondary">Edition {counts.edition.year}</Badge>
          ) : undefined
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(({ href, icon: Icon, label, value, sub }) => (
          <Link key={label} href={href} className="group">
            <Card className="h-full transition-colors group-hover:border-accent/60">
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardDescription>{label}</CardDescription>
                <Icon className="h-4 w-4 text-accent" aria-hidden />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold tabular-nums">{value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>

      <section className="mt-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registrations by status</CardTitle>
            <CardDescription>
              The review pipeline for the active edition.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {counts.registrationsTotal === 0 ? (
              <p className="text-sm text-muted-foreground">
                No registrations yet for this edition.
              </p>
            ) : (
              STATUS_ORDER.map((status) => {
                const n = counts.registrationsByStatus[status];
                if (n === 0) return null;
                return (
                  <div
                    key={status}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <RegistrationStatusBadge status={status} />
                    <span className="text-lg font-semibold tabular-nums">
                      {n}
                    </span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
