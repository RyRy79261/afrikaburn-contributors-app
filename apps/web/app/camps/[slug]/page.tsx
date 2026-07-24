import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Boxes,
  Droplets,
  MapPin,
  CalendarClock,
  Wallet,
  LayoutGrid,
  FileCheck2,
} from "lucide-react";
import type { GroupKind, MembershipRole, RegistrationStatus } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { DisabledHintTile } from "@quagga/ui/components/disabled-hint-tile";
import { getAuthenticatedUser } from "@/lib/auth";
import { getCurrentCampUser } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getCampBySlug } from "@/lib/groups-store";
import { listInvites } from "@/lib/invites-store";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { CampInvites } from "@/components/camp-invites";
import { LeaveCampButton } from "@/components/leave-camp-button";
import {
  createInviteAction,
  leaveCampAction,
  revokeInviteAction,
} from "./actions";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<GroupKind, string> = {
  org: "AfrikaBurn",
  theme_camp: "Theme camp",
  artwork: "Artwork",
  mutant_vehicle: "Mutant vehicle",
};

const ROLE_LABEL: Record<MembershipRole, string> = {
  god: "God",
  org_staff: "Org staff",
  lead: "Lead",
  admin: "Co-lead",
  member: "Member",
};

const STATUS_LABEL: Record<RegistrationStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export default async function CampPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Camp dashboards" />
      </AppShell>
    );
  }

  const authUser = await getAuthenticatedUser();
  const campUser = authUser ? await getCurrentCampUser() : null;
  const edition = await getActiveEdition();
  if (!edition) {
    return (
      <AppShell>
        <PreviewNotice feature="Camp dashboards" />
      </AppShell>
    );
  }

  const camp = await getCampBySlug(slug, edition.id, campUser?.id ?? null);
  if (!camp) notFound();

  // Free (unregistered) camps are members-only.
  if (!camp.registered && !camp.viewerRole) {
    if (!authUser) redirect("/auth/sign-in");
    notFound();
  }

  const isAdmin = camp.viewerRole === "lead" || camp.viewerRole === "admin";
  const invites = isAdmin ? await listInvites(camp.id) : [];

  const statusLabel = camp.registrationStatus
    ? STATUS_LABEL[camp.registrationStatus as RegistrationStatus]
    : "Not started";

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {KIND_LABEL[camp.kind]}
              </p>
              {camp.registered ? (
                <Badge variant="success">Registered</Badge>
              ) : (
                <Badge variant="outline">Free camp</Badge>
              )}
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              {camp.name}
            </h1>
            {camp.description && (
              <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                {camp.description}
              </p>
            )}
          </div>
          {camp.viewerRole && (
            <LeaveCampButton slug={camp.slug} action={leaveCampAction} />
          )}
        </header>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Members */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">
                Members ({camp.members.length})
              </CardTitle>
              <CardDescription>
                {camp.joinability === "open"
                  ? "Accepting new members via invite link."
                  : "Invite-only — members join through a one-time link."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y divide-border">
                {camp.members.map((m) => (
                  <li
                    key={m.userId}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <span className="min-w-0 truncate text-sm">
                      <Link
                        href={`/burners/${m.userId}`}
                        className="rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {m.displayName}
                      </Link>
                      {m.isViewer && (
                        <span className="ml-1.5 text-xs text-accent">(you)</span>
                      )}
                    </span>
                    <Badge
                      variant={
                        m.role === "lead"
                          ? "default"
                          : m.role === "admin"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {ROLE_LABEL[m.role]}
                    </Badge>
                  </li>
                ))}
              </ul>

              {!camp.viewerRole && (
                <p className="mt-4 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                  Ask a camp lead for an invite link to join.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Registration status tile */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileCheck2 className="h-4 w-4 text-accent" aria-hidden />
                Registration
              </CardTitle>
              <CardDescription>
                Approval earns entitlements for {edition.name}.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant={camp.registered ? "success" : "secondary"}>
                  {statusLabel}
                </Badge>
              </div>
              {isAdmin && (
                <Button asChild size="sm" className="w-full">
                  <Link href={`/camps/${camp.slug}/registration`}>
                    {camp.registrationStatus
                      ? "Continue registration"
                      : "Begin registration"}
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Invites — lead/admin only */}
        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invite links</CardTitle>
              <CardDescription>
                One-time links. A member link adds a member; a lead-transfer link
                hands over the lead role to whoever redeems it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CampInvites
                slug={camp.slug}
                initialInvites={invites}
                canLeadTransfer={camp.viewerRole === "lead"}
                createAction={createInviteAction}
                revokeAction={revokeInviteAction}
              />
            </CardContent>
          </Card>
        )}

        {/* Entitlements + parked capabilities */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Entitlements & tools
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DisabledHintTile
              title="Placement & art grants"
              hint={
                camp.registered
                  ? "Entitlement — application process TBC with AfrikaBurn."
                  : "Unlocks once your registration is approved."
              }
              tag="Entitlement"
              icon={<MapPin className="h-4 w-4" />}
            />
            <DisabledHintTile
              title="Water / Ice / Gas"
              hint="Pending AfrikaBurn input — separate delivery apps."
              tag="Pending AB"
              icon={<Droplets className="h-4 w-4" />}
            />
            <DisabledHintTile
              title="Containers"
              hint="Separate app — for the large camps that use them."
              tag="Separate app"
              icon={<Boxes className="h-4 w-4" />}
            />
            <DisabledHintTile
              title="Shifts"
              hint="Topic under exploration."
              tag="Exploring"
              icon={<CalendarClock className="h-4 w-4" />}
            />
            <DisabledHintTile
              title="Budget"
              hint="Topic under exploration."
              tag="Exploring"
              icon={<Wallet className="h-4 w-4" />}
            />
            <DisabledHintTile
              title="Layout"
              hint="Topic under exploration."
              tag="Exploring"
              icon={<LayoutGrid className="h-4 w-4" />}
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
