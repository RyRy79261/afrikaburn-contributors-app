import { Info, Lock } from "lucide-react";
import { orgCanInDomain, orgCapabilityRefusal } from "@quagga/core";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { guardConsole } from "@/lib/gate";
import { getActiveEdition, getCampCategories } from "@/lib/queries";
import { PageHeading } from "@/components/page-heading";
import { CategoriesManager } from "@/components/categories/categories-manager";

// Org camp-category management (build-spec §"Camp categories", canvas frame
// g4CzsM / X8RHa). Org-gated at the page (guardConsole) AND at every write
// (`update` in the `camp_categories` domain, inside lib/actions/categories.ts)
// — the UI is never the security boundary. Usage counts are real join-row
// tallies from the query.
//
// READ FOR EVERY RANK, WRITTEN BY THE DEPARTMENT THAT OWNS IT. The taxonomy is
// edition-wide reference data every camp's registration renders against, so
// write access follows the `camp_categories` domain rather than being open to
// anyone holding `update` somewhere. Everyone else gets the same table without
// the controls and a line saying why — a screen that explains its own limits
// beats one that silently lacks buttons.

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  // SCOPED TO THIS DOMAIN, matching the server. The write actions all guard
  // `requireOrgSession({ capability: "update", domain: "camp_categories" })`;
  // this used the unscoped `orgCan`, so anyone holding update in ANY department
  // — suppliers, say — was shown the edit controls here and then refused by the
  // action. The UI is not the boundary, but it should not lie about where the
  // boundary is.
  const canManage = orgCanInDomain(
    guard.session.actor,
    "update",
    "camp_categories",
  );
  const edition = await getActiveEdition();
  const categories = edition ? await getCampCategories(edition.id) : [];

  return (
    <div>
      <PageHeading
        eyebrow="Console / Categories"
        title="Camp categories"
        description={
          edition
            ? canManage
              ? `Theme topics that power the directory for ${edition.name}. Edit the catalog camps pick from.`
              : `Theme topics that power the directory for ${edition.name}. This is the catalog camps pick from.`
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
          {!canManage && (
            <p className="flex items-start gap-2 rounded-lg border border-border bg-card/40 px-3 py-2.5 text-xs text-muted-foreground">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {orgCapabilityRefusal(
                guard.session.actor,
                "update",
                "camp_categories",
              )}
            </p>
          )}

          <p className="flex items-start gap-2 rounded-lg border border-border bg-card/40 px-3 py-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            Categories are complementary to registration data — family-friendly,
            food gifting, operating hours and sound level already come from the
            registration itself, so the directory can filter on those for free.
          </p>

          <CategoriesManager
            editionId={edition.id}
            categories={categories}
            canManage={canManage}
          />
        </div>
      )}
    </div>
  );
}
