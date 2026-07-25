import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { CheckCircle2, Lock, Flame } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import { getAuthenticatedUser } from "@/lib/auth";
import { requireCampUser, pendingBlockingRoute } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getFillView, type ActivationRow } from "@/lib/questionnaire-store";
import { db, schema } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { BlockingBadge } from "@/components/questionnaire/blocking-badge";
import { QuestionnaireFill } from "@/components/questionnaire/fill";
import { SignOutButton } from "@/components/sign-out-button";

export const dynamic = "force-dynamic";

/** Who's asking — the authoring camp's name, or "AfrikaBurn" for org sends. */
async function authorName(activation: ActivationRow): Promise<string> {
  if (activation.authoredScope === "org" || !activation.groupId) {
    return "AfrikaBurn";
  }
  const rows = await db()
    .select({ name: schema.groups.name })
    .from(schema.groups)
    .where(eq(schema.groups.id, activation.groupId))
    .limit(1);
  return rows[0]?.name ?? "Your camp";
}

export default async function QuestionnaireFillPage({
  params,
}: {
  params: Promise<{ activationId: string }>;
}) {
  const { activationId } = await params;

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Questionnaires" />
      </AppShell>
    );
  }

  const user = await requireCampUser();

  // Hard-gate ordering: if an EARLIER blocking action (the Burner Bio, or a
  // different questionnaire) is still pending, route there first. When THIS
  // page is the current blocker, the routes match and we fall through to render.
  const gate = await pendingBlockingRoute(user.id);
  if (gate && gate !== `/questionnaires/${activationId}`) redirect(gate);

  const view = await getFillView(activationId, user.id);
  if (!view) notFound();

  const { activation, actionStatus, initialResponses } = view;

  if (actionStatus === "completed") {
    return (
      <AppShell>
        <div className="mx-auto flex max-w-xl flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
                Already submitted
              </CardTitle>
              <CardDescription>
                Thanks — you&apos;ve completed &ldquo;{activation.title}&rdquo;.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="secondary">
                <Link href="/directory">Back to the directory</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  // Blocking gate (questionnaire-spec §"Engine mechanics"): a HARD gate whose
  // ONLY reachable actions are filling it in and signing out. The chrome is
  // stripped to a band + brand mark + sign-out — no nav can leak an escape.
  if (activation.blocking) {
    const asker = await authorName(activation);
    return (
      <div className="flex min-h-svh flex-col bg-background">
        <header className="border-b border-border">
          <QuiltBand />
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-3">
            <span className="flex items-center gap-2 font-semibold">
              <Flame className="h-5 w-5 text-primary" aria-hidden />
              <span className="tracking-tight">Contributors</span>
            </span>
            <SignOutButton />
          </div>
        </header>

        <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <BlockingBadge blocking />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  {activation.title}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {asker} asks:
                </p>
              </div>
              {activation.description && (
                <p className="text-sm text-muted-foreground">
                  {activation.description}
                </p>
              )}
            </div>

            <Card>
              <CardContent className="pt-6">
                <QuestionnaireFill
                  activationId={activationId}
                  questionnaire={activation.definition}
                  initialResponses={initialResponses}
                  redirectTo="/directory"
                  submitLabel="Submit answers"
                  gate
                  respondentSeed={user.id}
                />
              </CardContent>
            </Card>

            <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              You can&apos;t use the portal until this is done — it only takes a
              couple of minutes.
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Non-blocking questionnaire: a normal, navigable fill page (reached from the
  // dashboard "Pending questionnaires" card) — keep the full app chrome.
  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <BlockingBadge blocking={activation.blocking} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {activation.title}
          </h1>
          {activation.description && (
            <p className="text-sm text-muted-foreground">
              {activation.description}
            </p>
          )}
        </div>
        <QuestionnaireFill
          activationId={activationId}
          questionnaire={activation.definition}
          initialResponses={initialResponses}
          redirectTo="/directory"
          submitLabel="Submit"
          respondentSeed={user.id}
        />
      </div>
    </AppShell>
  );
}
