import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2, Lock } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { getAuthenticatedUser } from "@/lib/auth";
import { requireCampUser, pendingBlockingRoute } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getFillView } from "@/lib/questionnaire-store";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { BlockingBadge } from "@/components/questionnaire/blocking-badge";
import { QuestionnaireFill } from "@/components/questionnaire/fill";

export const dynamic = "force-dynamic";

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
          {activation.blocking && (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <span>
                This one&apos;s required. Submitting it unlocks the rest of the
                app — until then it&apos;s the only thing you can do here.
              </span>
            </p>
          )}
        </div>
        <QuestionnaireFill
          activationId={activationId}
          questionnaire={activation.definition}
          initialResponses={initialResponses}
          redirectTo="/directory"
          submitLabel="Submit"
        />
      </div>
    </AppShell>
  );
}
