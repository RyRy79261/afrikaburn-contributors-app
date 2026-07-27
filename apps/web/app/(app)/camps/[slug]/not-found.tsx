import { NotFoundView } from "@/components/boundary/not-found-view";

// Camp-specific 404 (the dashboard calls `notFound()` for an unknown slug, or one
// a stranger isn't allowed to discover). Honest copy: a free camp stays invisible
// to non-members, so "we couldn't find it" is the correct thing to say either way.
export default function CampNotFound() {
  return (
    <NotFoundView
      frame="inline"
      title="We couldn't find that camp"
      description="This camp doesn't exist, or it's a free camp that's only visible to its own members. Check the link, or browse the directory."
    />
  );
}
