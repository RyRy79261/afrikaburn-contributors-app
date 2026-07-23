import Link from "next/link";
import { Search, Users } from "lucide-react";
import type { GroupKind } from "@quagga/types";
import { Badge } from "@quagga/ui/components/badge";
import { Input } from "@quagga/ui/components/input";
import { Button } from "@quagga/ui/components/button";
import { getAuthenticatedUser } from "@/lib/auth";
import { getCurrentCampUser } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { listDirectory } from "@/lib/groups-store";
import { AppShell } from "@/components/app-shell";
import { PreviewNotice } from "@/components/preview-notice";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<GroupKind, string> = {
  org: "AfrikaBurn",
  theme_camp: "Theme camp",
  artwork: "Artwork",
  mutant_vehicle: "Mutant vehicle",
};

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  if (!isDatabaseConfigured()) {
    return (
      <AppShell>
        <PreviewNotice feature="The camp directory" />
      </AppShell>
    );
  }

  const authUser = await getAuthenticatedUser();
  const campUser = authUser ? await getCurrentCampUser() : null;
  const edition = await getActiveEdition();

  const entries = edition
    ? await listDirectory({
        editionId: edition.id,
        viewerId: campUser?.id ?? null,
        search: q,
      })
    : [];

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Directory</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Registered camps, artworks, and mutant vehicles heading to the
            Tankwa. Free camps you belong to show here too.
          </p>
        </header>

        <form method="get" className="flex gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search by name…"
              className="pl-9"
              aria-label="Search the directory"
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {entries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
            {q
              ? `No camps match "${q}".`
              : "No registered camps yet. Be the first — create one."}
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {entries.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`/camps/${entry.slug}`}
                  className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent/60"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{entry.name}</p>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {KIND_LABEL[entry.kind]}
                      </p>
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

                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <Badge
                      variant={
                        entry.joinability === "open" ? "default" : "secondary"
                      }
                    >
                      {entry.joinability === "open"
                        ? "Accepting members"
                        : "Invite-only"}
                    </Badge>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="h-3.5 w-3.5" aria-hidden />
                      {entry.memberCount}
                      {entry.viewerRole && (
                        <span className="ml-1 text-accent">· you</span>
                      )}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
