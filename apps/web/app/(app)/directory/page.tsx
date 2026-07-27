import Link from "next/link";
import {
  ArrowRight,
  Lock,
  Search,
  SlidersHorizontal,
  UserRoundCheck,
  Users,
} from "lucide-react";
import type { GroupKind } from "@quagga/types";
import { matchesCategoryFilter } from "@quagga/core";
import { Badge } from "@quagga/ui/components/badge";
import { Input } from "@quagga/ui/components/input";
import { Button } from "@quagga/ui/components/button";
import { getAuthenticatedUser } from "@/lib/auth";
import { getCurrentCampUser, enforceGate } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import {
  listDirectory,
  listCampCategories,
  type DirectoryEntry,
  type DirectoryCategory,
} from "@/lib/groups-store";
import { listPendingQuestionnaires } from "@/lib/questionnaire-store";
import { PreviewNotice } from "@/components/preview-notice";
import { PendingQuestionnaires } from "@/components/questionnaire/pending-questionnaires";

export const dynamic = "force-dynamic";

// Kind is surfaced only for the non-camp entries; theme camps are the directory
// default (canvas subhead) so their kind line would just be noise.
const KIND_LABEL: Partial<Record<GroupKind, string>> = {
  artwork: "Artwork",
  mutant_vehicle: "Mutant vehicle",
};

/** Build a /directory href that preserves the search term and sets the filter. */
function directoryHref(
  q: string | undefined,
  categoryId: string | null,
): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (categoryId) params.set("cat", categoryId);
  const qs = params.toString();
  return qs ? `/directory?${qs}` : "/directory";
}

function CampCard({ entry }: { entry: DirectoryEntry }) {
  const kindLabel = KIND_LABEL[entry.kind];
  return (
    <Link
      href={`/camps/${entry.slug}`}
      className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent/60"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{entry.name}</p>
          {kindLabel && (
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {kindLabel}
            </p>
          )}
        </div>
        {entry.registered ? (
          <Badge variant="success">Registered</Badge>
        ) : (
          <Badge variant="outline">Free camp</Badge>
        )}
      </div>

      {entry.description && (
        <p className="line-clamp-3 text-sm text-muted-foreground">
          {entry.description}
        </p>
      )}

      {entry.categories.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {entry.categories.map((cat) => (
            <li
              key={cat.id}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
            >
              {cat.emoji && <span aria-hidden>{cat.emoji}</span>}
              {cat.label}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <div className="flex min-w-0 items-center gap-2">
          {entry.registered &&
            (entry.joinability === "open" ? (
              <Badge variant="default">
                <UserRoundCheck className="h-3 w-3" aria-hidden />
                Accepting members
              </Badge>
            ) : (
              <Badge variant="outline">
                <Lock className="h-3 w-3" aria-hidden />
                Invite only
              </Badge>
            ))}
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" aria-hidden />
            {entry.memberCount} member{entry.memberCount === 1 ? "" : "s"}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-accent">
          {entry.registered ? "View camp" : "Open camp"}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      </div>
    </Link>
  );
}

/** Horizontally-scrollable category filter-chip row (canvas "Category Chips").
 * "All camps" clears the filter; the active category is highlighted. */
function CategoryFilterRow({
  categories,
  activeCategoryId,
  q,
}: {
  categories: DirectoryCategory[];
  activeCategoryId: string | null;
  q: string | undefined;
}) {
  const baseChip =
    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors";
  const inactive =
    "border-border bg-card text-foreground hover:border-accent/60";
  const active = "border-accent bg-accent/15 font-semibold text-accent";
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      <SlidersHorizontal
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <Link
        href={directoryHref(q, null)}
        className={`${baseChip} ${activeCategoryId === null ? active : inactive}`}
      >
        All camps
      </Link>
      {categories.map((cat) => {
        const isActive = cat.id === activeCategoryId;
        return (
          <Link
            key={cat.id}
            href={directoryHref(q, isActive ? null : cat.id)}
            aria-pressed={isActive}
            className={`${baseChip} ${isActive ? active : inactive}`}
          >
            {cat.emoji && <span aria-hidden>{cat.emoji}</span>}
            {cat.label}
          </Link>
        );
      })}
    </div>
  );
}

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string }>;
}) {
  const { q, cat } = await searchParams;

  if (!isDatabaseConfigured()) {
    return <PreviewNotice feature="The camp directory" />;
  }

  const authUser = await getAuthenticatedUser();
  const campUser = authUser ? await getCurrentCampUser() : null;
  // The signed-in landing: a pending blocking action gates the app here too.
  // Deliberately still awaited alone and BEFORE the reads below — a gated user
  // must be redirected, not served a directory in parallel with the check.
  if (campUser) await enforceGate(campUser.id);

  // Independent of each other: the edition row and the viewer's own pending
  // questionnaires. They were sequential for no reason.
  const [edition, pending] = await Promise.all([
    getActiveEdition(),
    campUser ? listPendingQuestionnaires(campUser.id) : [],
  ]);

  const [allEntries, categories] = edition
    ? await Promise.all([
        listDirectory({
          editionId: edition.id,
          viewerId: campUser?.id ?? null,
          search: q,
        }),
        listCampCategories(edition.id),
      ])
    : [[] as DirectoryEntry[], [] as DirectoryCategory[]];

  // The active category filter (URL param). Only honour ids that exist in the
  // edition's catalog so a stale/garbage `cat` collapses to "All camps".
  const activeCategoryId =
    cat && categories.some((c) => c.id === cat) ? cat : null;
  const entries = allEntries.filter((e) =>
    matchesCategoryFilter(e, activeCategoryId),
  );

  // Undiscoverability is enforced in listDirectory: free camps only ever appear
  // to their own members. Registered camps are public; the rest are the viewer's
  // own free camps — split into the two canvas sections.
  const registered = entries.filter((e) => e.registered);
  const yourFreeCamps = entries.filter((e) => !e.registered);

  return (
    <>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Directory</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Every registered theme camp for {edition?.name ?? "AfrikaBurn"}, in
            one place. Find your people, or start your own.
          </p>
        </header>

        {pending.length > 0 && <PendingQuestionnaires items={pending} />}

        <div className="flex flex-col gap-2 sm:flex-row">
          <form method="get" className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search camps by name, gift or vibe…"
              className="pl-9"
              aria-label="Search the directory"
            />
            {/* Preserve the active category filter across a text search. */}
            {activeCategoryId && (
              <input type="hidden" name="cat" value={activeCategoryId} />
            )}
            <button type="submit" className="sr-only">
              Search
            </button>
          </form>
          <Button asChild className="shrink-0">
            <Link href="/camps/new">Create a camp</Link>
          </Button>
        </div>

        {categories.length > 0 && (
          <CategoryFilterRow
            categories={categories}
            activeCategoryId={activeCategoryId}
            q={q}
          />
        )}

        {entries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
            {q || activeCategoryId
              ? "No camps match your filters."
              : "No registered camps yet. Be the first — create one."}
          </p>
        ) : (
          <div className="flex flex-col gap-8">
            {registered.length > 0 && (
              <section className="flex flex-col gap-4">
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Registered camps
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Public this edition — anyone can find and request to join.
                    </p>
                  </div>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {registered.length} camp{registered.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="grid gap-4 sm:grid-cols-2">
                  {registered.map((entry) => (
                    <li key={entry.id}>
                      <CampCard entry={entry} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {yourFreeCamps.length > 0 && (
              <section className="flex flex-col gap-4">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Your camps · members only
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Free camps you&rsquo;re part of. Not yet registered, so they
                    stay hidden from the public directory.
                  </p>
                </div>
                <ul className="grid gap-4 sm:grid-cols-2">
                  {yourFreeCamps.map((entry) => (
                    <li key={entry.id}>
                      <CampCard entry={entry} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}
