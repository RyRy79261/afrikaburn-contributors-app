import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ClipboardList, Plus, ArrowLeft } from "lucide-react";
import { PROJECT_ADMIN_ROLES } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { getAuthenticatedUser } from "@/lib/auth";
import { requireCampUser, enforceGate } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { getCampBySlug } from "@/lib/groups-store";
import { listProjectQuestionnaires } from "@/lib/questionnaire-store";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";
import { BlockingBadge } from "@/components/questionnaire/blocking-badge";

export const dynamic = "force-dynamic";

export default async function CampQuestionnairesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="Camp questionnaires" />
      </AppShell>
    );
  }

  const user = await requireCampUser();
  await enforceGate(user.id);

  const edition = await getActiveEdition();
  if (!edition) {
    return (
      <AppShell>
        <PreviewNotice feature="Camp questionnaires" />
      </AppShell>
    );
  }

  const camp = await getCampBySlug(slug, edition.id, user.id);
  if (!camp) notFound();
  const isAdmin =
    camp.viewerRole !== null && PROJECT_ADMIN_ROLES.includes(camp.viewerRole);
  if (!isAdmin) notFound();

  const questionnaires = await listProjectQuestionnaires(camp.id);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link href={`/camps/${slug}`}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {camp.name}
            </Link>
          </Button>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Questionnaires
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Ask your members what you need — nothing more.
              </p>
            </div>
            <Button asChild>
              <Link href={`/camps/${slug}/questionnaires/new`}>
                <Plus className="h-4 w-4" aria-hidden />
                New questionnaire
              </Link>
            </Button>
          </header>
        </div>

        {questionnaires.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" />}
            title="No questionnaires yet"
            description="Create one to gather build-week preferences, dietary needs, shift availability — whatever your camp actually needs."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {questionnaires.map((q) => (
              <Card key={q.activationId}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">{q.title}</CardTitle>
                      {q.description && (
                        <CardDescription className="mt-1">
                          {q.description}
                        </CardDescription>
                      )}
                    </div>
                    <BlockingBadge blocking={q.blocking} />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="secondary">
                      {q.completed}/{q.sent} completed
                    </Badge>
                    <span>
                      {q.questionCount}{" "}
                      {q.questionCount === 1 ? "question" : "questions"}
                    </span>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={`/camps/${slug}/questionnaires/${q.activationId}`}
                    >
                      View responses
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
