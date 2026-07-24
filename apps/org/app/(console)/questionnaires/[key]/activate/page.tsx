import { notFound } from "next/navigation";
import { Card, CardContent } from "@quagga/ui/components/card";
import { guardConsole } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import { ActivationForm } from "@/components/questionnaire/activation-form";
import { getActiveEdition } from "@/lib/queries";
import { getOrgDefinition } from "@/lib/questionnaires/queries";

export const dynamic = "force-dynamic";

export default async function ActivateQuestionnairePage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const { key } = await params;
  const [definition, edition] = await Promise.all([
    getOrgDefinition(key),
    getActiveEdition(),
  ]);
  if (!definition) notFound();

  return (
    <div>
      <PageHeading
        eyebrow="Questionnaires / Send"
        title={definition.title}
        description={
          definition.description ??
          "Choose an audience and delivery options, then send."
        }
      />

      {!edition ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No active edition is seeded yet — a questionnaire can only be sent
            against an active edition.
          </CardContent>
        </Card>
      ) : (
        <ActivationForm
          questionnaireKey={definition.key}
          version={definition.version ?? "1"}
          title={definition.title}
          description={definition.description}
          editionId={edition.id}
          editionName={edition.name}
        />
      )}
    </div>
  );
}
