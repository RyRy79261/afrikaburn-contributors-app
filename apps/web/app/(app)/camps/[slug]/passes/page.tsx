import { ProjectPassesPage } from "@/app/(app)/_project-passes/passes-page";

// Thin route: the Work Access Passes page is shared by /camps, /artworks and
// /vehicles (app/(app)/_project-passes, epic #53). `routeKind` keeps a slug
// on the route of its own kind.

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ProjectPassesPage slug={slug} routeKind="theme_camp" />;
}
