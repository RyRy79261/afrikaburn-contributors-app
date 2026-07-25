import { guardConsole } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import { QuestionnaireBuilderV2 } from "@/components/questionnaires/builder-v2";
import { getActiveEdition } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function NewQuestionnairePage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  // Only used for the send rail's live "resolves to ~N people" preview.
  const edition = await getActiveEdition();

  return (
    <div>
      <PageHeading
        eyebrow="Questionnaires / New"
        title="Build a questionnaire"
        description="Sections, questions, validation rules and branching — then choose who receives it."
      />
      <QuestionnaireBuilderV2 editionId={edition?.id ?? null} />
    </div>
  );
}
