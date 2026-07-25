import { Info } from "lucide-react";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { guardConsole } from "@/lib/gate";
import { getActiveEdition, getCampCategories } from "@/lib/queries";
import { PageHeading } from "@/components/page-heading";
import { CategoriesManager } from "@/components/categories/categories-manager";

// Org camp-category management (build-spec §"Camp categories", canvas frame
// g4CzsM / X8RHa). Org-gated at the page (guardConsole) AND at every write
// (requireOrgSession inside lib/actions/categories.ts) — the UI is never the
// security boundary. Usage counts are real join-row tallies from the query.

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  const edition = await getActiveEdition();
  const categories = edition ? await getCampCategories(edition.id) : [];

  return (
    <div>
      <PageHeading
        eyebrow="Console / Categories"
        title="Camp categories"
        description={
          edition
            ? `Theme topics that power the directory for ${edition.name}. Edit the catalog camps pick from.`
            : "Theme topics that power the directory. Categories are per-edition — seed an edition to manage them."
        }
      />

      {!edition ? (
        <EmptyState
          title="No active edition"
          description="Camp categories belong to an edition. Once an edition is seeded, its catalog appears here."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="flex items-start gap-2 rounded-lg border border-border bg-card/40 px-3 py-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            Categories are complementary to registration data — family-friendly,
            food gifting, operating hours and sound level already come from the
            registration itself, so the directory can filter on those for free.
          </p>

          <CategoriesManager editionId={edition.id} categories={categories} />
        </div>
      )}
    </div>
  );
}
