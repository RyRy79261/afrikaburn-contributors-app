import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { CheckCircle2, Lock } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { INVITE_RESUME_PATH } from "@quagga/core";
import { getAuthenticatedUser } from "@/lib/auth";
import { readPendingInvite } from "@/lib/pending-invite";
import { requireCampUser, pendingBlockingRoute } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getFillView, type ActivationRow } from "@/lib/questionnaire-store";
import { db, schema } from "@/lib/db";
import { PreviewNotice } from "@/components/preview-notice";
import { BlockingBadge } from "@/components/questionnaire/blocking-badge";
import { QuestionnaireFill } from "@/components/questionnaire/fill";

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
    return <PreviewNotice feature="Questionnaires" />;
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
      <>
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
      </>
    );
  }

  // Blocking gate (questionnaire-spec §"Engine mechanics"): a HARD gate whose
  // ONLY reachable actions are filling it in and signing out.
  //
  // THE STRIPPED CHROME IS THE LAYOUT'S JOB NOW. This page used to draw its own
  // band + brand mark + sign-out, on the reasoning "no nav can leak an escape".
  // That was true when AppShell was rendered per page; once it was hoisted into
  // `(app)/layout.tsx` the layout wrapped this route too, so the gate rendered
  // the FULL participant nav — Directory, Create camp, Profile, Account — above
  // its own minimal header. Two headers, and precisely the nav the comment
  // promised was absent. The shell now reads `viewerIsGated()` and strips
  // itself, which is the only place that can decide it.
  if (activation.blocking) {
    const asker = await authorName(activation);
    // If an invite is waiting behind this gate, clearing the gate completes the
    // join and lands them on the camp — the same resume the Burner Bio does.
    const afterGate = (await readPendingInvite())
      ? INVITE_RESUME_PATH
      : "/directory";
    return (
      // NO full-screen wrapper. This used to own the whole viewport because it
      // drew its own header; the shell draws the chrome now, and a `min-h-svh`
      // column nested inside the shell's already-padded `flex-1` container just
      // overflows it and doubles the padding.
      <div className="mx-auto w-full max-w-xl">
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
                redirectTo={afterGate}
                submitLabel="Submit answers"
                gate
                respondentSeed={user.id}
                blobConfigured={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
              />
            </CardContent>
          </Card>

          <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            You can&apos;t use the portal until this is done — it only takes a
            couple of minutes.
          </p>
        </div>
      </div>
    );
  }

  // Non-blocking questionnaire: a normal, navigable fill page (reached from the
  // dashboard "Pending questionnaires" card) — keep the full app chrome.
  return (
    <>
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
          blobConfigured={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
        />
      </div>
    </>
  );
}
