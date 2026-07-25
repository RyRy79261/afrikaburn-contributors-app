import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@quagga/ui/lib/utils";

/**
 * Paginates the registrations table (canvas StJXH pagination row): a
 * "Showing X–Y of N" summary plus Previous / numbered pages / Next. Rendered
 * server-side as plain links that preserve the active status/sound/cohort
 * filters, so navigation needs no client JS.
 */
export function RegistrationsPagination({
  page,
  pageSize,
  total,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  /** Active filter params to carry across page links (status/sound/cohort). */
  params: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  function href(target: number): string {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v && v !== "all") next.set(k, v);
    }
    if (target > 1) next.set("page", String(target));
    const qs = next.toString();
    return qs ? `/registrations?${qs}` : "/registrations";
  }

  const cell =
    "inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-md border border-input px-3 text-sm font-medium transition-colors";
  const enabled = "hover:bg-muted hover:text-foreground";
  const disabled =
    "pointer-events-none border-transparent text-muted-foreground/50";

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground tabular-nums">
        Showing {first}–{last} of {total}
      </p>
      <nav className="flex items-center gap-1.5" aria-label="Pagination">
        <Link
          href={href(page - 1)}
          aria-disabled={page <= 1}
          tabIndex={page <= 1 ? -1 : undefined}
          className={cn(cell, page <= 1 ? disabled : enabled)}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Previous
        </Link>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
          <Link
            key={n}
            href={href(n)}
            aria-current={n === page ? "page" : undefined}
            className={cn(
              cell,
              "min-w-9 px-0",
              n === page
                ? "border-primary bg-primary/15 text-foreground"
                : enabled,
            )}
          >
            {n}
          </Link>
        ))}
        <Link
          href={href(page + 1)}
          aria-disabled={page >= totalPages}
          tabIndex={page >= totalPages ? -1 : undefined}
          className={cn(cell, page >= totalPages ? disabled : enabled)}
        >
          Next
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </nav>
    </div>
  );
}
