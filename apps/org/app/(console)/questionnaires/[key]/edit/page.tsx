import { notFound } from "next/navigation";
import { guardConsole } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import {
  QuestionnaireBuilderV2,
  type BuilderV2Initial,
} from "@/components/questionnaires/builder-v2";
import { getActiveEdition } from "@/lib/queries";
import { getOrgDefinition } from "@/lib/questionnaires/queries";

export const dynamic = "force-dynamic";

export default async function EditQuestionnairePage({
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

  // The stored definition IS the editor state — sections, blocks and question
  // ids are handed over untouched so nothing drifts across a round trip.
  const initial: BuilderV2Initial = {
    key: definition.key,
    title: definition.title,
    description: definition.description ?? "",
    definition: definition.definition,
    status: definition.status,
  };

  return (
    <div>
      <PageHeading
        eyebrow="Questionnaires / Edit"
        title="Edit questionnaire"
        description="Editing saves a new version. Questionnaires already sent keep the version they went out with."
      />
      <QuestionnaireBuilderV2
        initial={initial}
        editionId={edition?.id ?? null}
      />
    </div>
  );
}
