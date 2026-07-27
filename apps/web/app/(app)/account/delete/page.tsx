import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { DELETION_GRACE_PERIOD_DAYS, DEPARTED_BURNER_NAME } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/config";
import { requireCampUser } from "@/lib/session";
import { buildDeletionView } from "@/lib/account";
import { PreviewNotice } from "@/components/preview-notice";
import { AccountShell } from "@/components/account/account-shell";
import {
  CancelDeletionButton,
  DeleteAccountForm,
} from "@/components/account/delete-account-form";
import { resolveBlockedProjects } from "./blocked-projects";

// /account/delete — Delete My Account (canvas frame Q3pQj6 + mobile Ur0rS).
//
// Calm and honest, not dark-patterned — and not accidental either. The two
// consequence columns are not marketing: they are the actual @quagga/core
// sanitization plan (`buildBioSanitizationPatch` + `SANITIZATION_PRESERVED_TABLES`)
// written out in words, so what the page promises and what the sweeper does are
// the same list.
//
// We never hard-delete. The Camp 404 "Lost Cat" precedent: erase the person,
// keep the shape, so a camp's roster, an edition's questionnaire responses and
// the audit trail all survive with a "Departed Burner" stub in place of a human.

export const dynamic = "force-dynamic";

const ERASED = [
  "Your email address and password",
  "Google and any other sign-in links",
  "Phone number and emergency contacts",
  "Your Burner Bio, ID document, skills and interests",
  "Every active session and device",
];

const ANONYMISED = [
  `Camp memberships, re-labelled “${DEPARTED_BURNER_NAME}”`,
  "Questionnaire answers, detached from you",
  "Registration and review history the camp still needs",
  "Audit history, to keep records intact",
];

export default async function AccountDeletePage() {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  if (!isDatabaseConfigured()) {
    return <PreviewNotice feature="Account deletion" />;
  }

  const user = await requireCampUser();
  const view = await buildDeletionView(user.id);
  const { eligibility } = view;

  const blockedGroupIds = eligibility.blocks.flatMap((b) => b.groupIds ?? []);
  const blockedProjects = await resolveBlockedProjects(blockedGroupIds);

  const scheduled = view.phase === "grace" || view.phase === "due";

  return (
    <AccountShell
      active="delete"
      title="Delete account"
      description={`Calm and honest — and reversible for ${DELETION_GRACE_PERIOD_DAYS} days. Here's exactly what happens before you decide.`}
    >
      {scheduled ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>This account is scheduled for deletion</CardTitle>
                <CardDescription className="mt-1.5">
                  {view.phase === "grace"
                    ? `${view.daysRemaining} day${
                        view.daysRemaining === 1 ? "" : "s"
                      } left to change your mind. Nothing has been erased yet.`
                    : "The grace period has elapsed and your account is being anonymised. It can no longer be cancelled here."}
                </CardDescription>
              </div>
              <Badge variant="destructive">Scheduled</Badge>
            </div>
          </CardHeader>
          {view.phase === "grace" ? (
            <CardContent>
              <CancelDeletionButton />
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>What happens when you leave</CardTitle>
          <CardDescription>
            We don&rsquo;t hard-delete. Your account is anonymised so the camps
            and conversations you were part of stay whole.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
              Erased for good
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {ERASED.map((item) => (
                <li key={item} className="text-sm text-foreground">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Kept, but anonymised
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {ANONYMISED.map((item) => (
                <li key={item} className="text-sm text-foreground">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Your name in every camp becomes &ldquo;{DEPARTED_BURNER_NAME}
            &rdquo;. The threads you were part of stay whole — your identity
            doesn&rsquo;t.
          </p>
        </CardContent>
      </Card>

      {eligibility.blocks.length > 0 ? (
        <Card className="border-warning/40">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
                  Sort this out first
                </CardTitle>
                <CardDescription className="mt-1.5">
                  Every blocker is listed at once — you shouldn&rsquo;t discover
                  the second one after fixing the first.
                </CardDescription>
              </div>
              <Badge variant="warning">Blocks deletion</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {eligibility.blocks.map((block) => {
              const projects = blockedProjects.filter((p) =>
                (block.groupIds ?? []).includes(p.id),
              );
              return (
                <div
                  key={block.code}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4"
                >
                  <p className="text-sm text-foreground">{block.message}</p>
                  {projects.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {projects.map((project) => (
                        <Button
                          key={project.id}
                          variant="outline"
                          size="sm"
                          asChild
                        >
                          <Link href={`/camps/${project.slug}`}>
                            Transfer leadership · {project.name}
                            <ArrowRight className="h-4 w-4" aria-hidden />
                          </Link>
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {eligibility.warnings.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Worth knowing</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {eligibility.warnings.map((warning) => (
              <p key={warning.code} className="text-sm text-muted-foreground">
                {warning.message}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {scheduled ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Confirm and request deletion</CardTitle>
            <CardDescription>
              We&rsquo;ll ask for your password, then start the{" "}
              {DELETION_GRACE_PERIOD_DAYS}-day countdown.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteAccountForm blocked={!eligibility.ok} />
          </CardContent>
        </Card>
      )}
    </AccountShell>
  );
}
