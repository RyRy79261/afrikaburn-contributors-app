import { notFound } from "next/navigation";
import { flattenQuestions } from "@quagga/types";
import { guardConsole } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import {
  QuestionnaireBuilder,
  questionToField,
  type BuilderInitial,
} from "@/components/questionnaire/builder";
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
  const definition = await getOrgDefinition(key);
  if (!definition) notFound();

  const initial: BuilderInitial = {
    key: definition.key,
    title: definition.title,
    description: definition.description ?? "",
    fields: flattenQuestions(definition.definition).map(questionToField),
  };

  return (
    <div>
      <PageHeading
        eyebrow="Questionnaires / Edit"
        title="Edit questionnaire"
        description="Editing saves a new version. Questionnaires already sent keep the version they went out with."
      />
      <QuestionnaireBuilder initial={initial} />
    </div>
  );
}
