import { Info, Lock } from "lucide-react";
import { isSystemManager, systemManagerRefusal } from "@quagga/core";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { guardConsole } from "@/lib/gate";
import { getActiveEdition, getCampCategories } from "@/lib/queries";
import { PageHeading } from "@/components/page-heading";
import { CategoriesManager } from "@/components/categories/categories-manager";

// Org camp-category management (build-spec §"Camp categories", canvas frame
// g4CzsM / X8RHa). Org-gated at the page (guardConsole) AND at every write
// (`requireSystemManager` inside lib/actions/categories.ts) — the UI is never
// the security boundary. Usage counts are real join-row tallies from the query.
//
// READ FOR EVERY RANK, WRITTEN BY ONE. The taxonomy is edition-wide reference
// data every camp's registration renders against, so Ryan put CRUD in the
// System manager's hands alone (27 Jul 2026). Everyone else gets the same table
// with the controls PRESENT BUT DISABLED, each naming the restriction and
// pointing at the sentence below — "transparent with restrictions rather than
// completely obfuscated, except for private personal information" (Ryan, 28 Jul
// 2026). A screen that explains its own limits beats one that silently lacks
// buttons, and a taxonomy is not personal information.

export const dynamic = "force-dynamic";

/** The one refusal sentence every disabled control on this page describes to. */
const MANAGE_REFUSAL_ID = "camp-category-manage-refusal";

export default async function CategoriesPage() {
  const guard = await guardConsole();
  if (!guard.ok) return guard.node;

  // THE RANK, asked directly — matching the write actions, which all guard
  // `requireSystemManager("change the camp categories")`.
  //
  // This screen briefly asked a department capability instead, and that quietly
  // handed the taxonomy to anyone holding `update`: the seeded `org_staff` and
  // `engineer` roles carry no department, and a department-less grant reaches
  // every domain. Ryan reserved category CRUD to the System manager on 27 Jul
  // 2026 — "The categories for example, These should only have CRUD operations
  // by a system manager" — and the CRUD rework must not relax a rule it was
  // never asked to touch. The e2e specs for both ranks caught it.
  const canManage = isSystemManager(guard.session.actor);
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
            <p
              id={MANAGE_REFUSAL_ID}
              className="flex items-start gap-2 rounded-lg border border-border bg-card/40 px-3 py-2.5 text-xs text-muted-foreground"
            >
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {systemManagerRefusal("change the camp categories")}
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
            refusalId={MANAGE_REFUSAL_ID}
          />
        </div>
      )}
    </div>
  );
}
