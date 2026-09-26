import { ProjectQuestionnaireResults } from "@/app/(app)/_project-questionnaires/results";

// Thin route: the page body is shared by /camps, /artworks and /vehicles
// (app/(app)/_project-questionnaires). `routeKind` is what keeps a slug on the
// route of its own kind.

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; activationId: string }>;
}) {
  const { slug, activationId } = await params;
  return (
    <ProjectQuestionnaireResults
      slug={slug}
      activationId={activationId}
      routeKind="theme_camp"
    />
  );
}
