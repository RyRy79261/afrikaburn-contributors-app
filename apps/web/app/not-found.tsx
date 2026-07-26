import { NotFoundView } from "@/components/boundary/not-found-view";

// Root not-found boundary: renders for an unmatched URL or any `notFound()` call
// that no closer boundary handles.
export default function RootNotFound() {
  return <NotFoundView />;
}
