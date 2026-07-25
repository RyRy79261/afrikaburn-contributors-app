import type { ReactNode } from "react";
import Link from "next/link";
import {
  Building2,
  FileText,
  Pencil,
  Plus,
  Send,
  Users,
} from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Badge } from "@quagga/ui/components/badge";
import { Card, CardContent } from "@quagga/ui/components/card";
import { guardConsole } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import { BlockingBadge } from "@/components/questionnaire/blocking-badge";
import { formatDate } from "@/lib/labels";
import {
  listOrgQuestionnaires,
  type ActivationSummary,
  type OrgQuestionnaireSummary,
} from "@/lib/questionnaires/queries";

export const dynamic = "force-dynamic";

// The console questionnaire list, split by where the questionnaire GOES.
//
// Org-internal activations gate this console and never reach the participant
// app — that isolation is enforced in @quagga/core + the queries, not here.
// The split exists so an author can never mistake one for the other while
// choosing what to edit or send.

type Section = "internal" | "outbound";

function activationsFor(
  questionnaire: OrgQuestionnaireSummary,
  section: Section,
): ActivationSummary[] {
  return questionnaire.activations.filter((a) =>
    section === "internal"
      ? a.audienceKind === "org_internal"
      : a.audienceKind !== "org_internal",
  );
}

const DEFINITION_STATUS: Record<
  OrgQuestionnaireSummary["status"],
  { label: string; variant: "success" | "outline" | "secondary" }
> = {
  published: { label: "Published", variant: "success" },
  draft: { label: "Draft", variant: "outline" },
  unpublished: { label: "Unpublished", variant: "secondary" },
};

export default async function QuestionnairesPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const questionnaires = await listOrgQuestionnaires();

  const internal = questionnaires.filter(
    (q) => activationsFor(q, "internal").length > 0,
  );
  const outbound = questionnaires.filter(
    (q) => activationsFor(q, "outbound").length > 0,
  );
  const unsent = questionnaires.filter((q) => q.activations.length === 0);

  return (
    <div>
      <PageHeading
        eyebrow="Questionnaires"
        title="Questionnaires"
        description="Build questionnaires, send them to burners or org staff, and track who has answered. Keep them short — every question is one someone in the desert has to answer."
        actions={
          <Button asChild>
            <Link href="/questionnaires/new">
              <Plus aria-hidden />
              New questionnaire
            </Link>
          </Button>
        }
      />

      {questionnaires.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              No questionnaires yet. Build one to check in with camp leads or
              your own staff.
            </p>
            <Button asChild>
              <Link href="/questionnaires/new">
                <Plus aria-hidden />
                New questionnaire
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          <ListSection
            icon={<Users className="h-4 w-4" aria-hidden />}
            label="Outbound"
            caption="Delivered to burners in the participant app."
            questionnaires={outbound}
            section="outbound"
            emptyCopy="Nothing has been sent to burners yet."
          />
          <ListSection
            icon={<Building2 className="h-4 w-4" aria-hidden />}
            label="Org-internal"
            caption="Answered inside this console only — never delivered to the participant app."
            questionnaires={internal}
            section="internal"
            emptyCopy="No internal questionnaires are running."
          />
          {unsent.length > 0 ? (
            <ListSection
              icon={<FileText className="h-4 w-4" aria-hidden />}
              label="Not sent yet"
              caption="Saved definitions with no audience yet."
              questionnaires={unsent}
              section="outbound"
              emptyCopy=""
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function ListSection({
  icon,
  label,
  caption,
  questionnaires,
  section,
  emptyCopy,
}: {
  icon: ReactNode;
  label: string;
  caption: string;
  questionnaires: OrgQuestionnaireSummary[];
  section: Section;
  emptyCopy: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
          <Badge variant="outline">{questionnaires.length}</Badge>
        </h2>
        <p className="text-xs text-muted-foreground">{caption}</p>
      </div>

      {questionnaires.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {emptyCopy}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {questionnaires.map((q) => (
            <QuestionnaireCard key={q.key} questionnaire={q} section={section} />
          ))}
        </div>
      )}
    </section>
  );
}

function QuestionnaireCard({
  questionnaire,
  section,
}: {
  questionnaire: OrgQuestionnaireSummary;
  section: Section;
}) {
  const activations = activationsFor(questionnaire, section);
  const status = DEFINITION_STATUS[questionnaire.status];
  const hasOpen = activations.some((a) => a.status === "open");

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold">{questionnaire.title}</h3>
              <Badge variant={status.variant}>{status.label}</Badge>
              {hasOpen ? <Badge variant="success">Active</Badge> : null}
              <Badge variant="secondary">
                {questionnaire.fieldCount}{" "}
                {questionnaire.fieldCount === 1 ? "question" : "questions"}
              </Badge>
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              {questionnaire.key} · v{questionnaire.version ?? "1"} · updated{" "}
              {formatDate(questionnaire.updatedAt)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/questionnaires/${questionnaire.key}/edit`}>
                <Pencil aria-hidden />
                Edit
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/questionnaires/${questionnaire.key}/activate`}>
                <Send aria-hidden />
                Send
              </Link>
            </Button>
          </div>
        </div>

        {activations.length > 0 ? (
          <div className="flex flex-col divide-y divide-border rounded-md border border-border">
            {activations.map((a) => (
              <ActivationRow
                key={a.id}
                activation={a}
                qKey={questionnaire.key}
              />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ActivationRow({
  activation,
  qKey,
}: {
  activation: ActivationSummary;
  qKey: string;
}) {
  const { sent, completed } = activation.completion;
  const pct = sent === 0 ? 0 : Math.round((completed / sent) * 100);
  const internal = activation.audienceKind === "org_internal";

  return (
    <Link
      href={`/questionnaires/${qKey}/${activation.id}`}
      className="flex flex-col gap-2 p-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <BlockingBadge blocking={activation.blocking} />
          <Badge variant={activation.status === "open" ? "success" : "outline"}>
            {activation.status === "open"
              ? "Open"
              : activation.status === "closed"
                ? "Closed"
                : "Draft"}
          </Badge>
          <Badge variant={internal ? "default" : "secondary"}>
            {internal ? "Internal" : "Outbound"}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {activation.audienceLabel}
          </span>
        </div>
        {activation.dueAt && (
          <span className="text-xs text-muted-foreground">
            Due {formatDate(activation.dueAt)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 sm:w-64">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-success transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* The canvas prints the ratio AND the percentage (frame JY7dF) — the
            bar alone leaves the reader estimating the number it encodes. */}
        <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {completed}/{sent} · {pct}%
        </span>
      </div>
    </Link>
  );
}
