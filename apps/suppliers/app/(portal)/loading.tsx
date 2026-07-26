import { PortalPageSkeleton } from "@/components/route-skeleton";

// Loading boundary for the gated portal pages. Renders inside the portal shell
// (header + nav persist) while a page streams its data — a heading block plus a
// couple of card placeholders, matching the shape every portal page renders.

export default function PortalLoading() {
  return <PortalPageSkeleton cards={2} />;
}
