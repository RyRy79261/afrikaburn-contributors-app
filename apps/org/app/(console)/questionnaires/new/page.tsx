import { guardConsole } from "@/lib/gate";
import { PageHeading } from "@/components/page-heading";
import { QuestionnaireBuilder } from "@/components/questionnaire/builder";

export const dynamic = "force-dynamic";

export default async function NewQuestionnairePage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  return (
    <div>
      <PageHeading
        eyebrow="Questionnaires / New"
        title="Build a questionnaire"
        description="Add the questions you need, then choose who receives it."
      />
      <QuestionnaireBuilder />
    </div>
  );
}
