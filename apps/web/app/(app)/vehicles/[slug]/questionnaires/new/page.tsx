import { NewProjectQuestionnaire } from "@/app/(app)/_project-questionnaires/new";

// Thin route: the page body is shared by /camps, /artworks and /vehicles
// (app/(app)/_project-questionnaires). `routeKind` is what keeps a slug on the
// route of its own kind.

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <NewProjectQuestionnaire slug={slug} routeKind="mutant_vehicle" />;
}
