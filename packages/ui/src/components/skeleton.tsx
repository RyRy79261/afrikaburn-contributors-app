import * as React from "react";

import { cn } from "../lib/utils";

/**
 * The shared skeleton kit behind every app-router `loading.tsx`.
 *
 * Why a kit and not one big `<PageSkeleton>`: a route boundary only stops the
 * navigation feeling broken if it shows the DESTINATION's shape. A generic grey
 * page is honest about "something is happening" and dishonest about what — and
 * when the real content lands the layout jumps, which reads as a second load.
 * So each route composes these primitives with the SAME container classes its
 * page uses, and the swap is a fill, not a reflow.
 *
 * Everything here is server-safe: no hooks, no state, no data. That matters —
 * the boundary has to stream before any of the slow work has finished.
 *
 * Accessibility: the pulse blocks are decorative (`aria-hidden`), and the
 * wrapper (`SkeletonRegion`) carries the single polite live region. One
 * announcement per boundary, not one per bar.
 */

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * A single shimmering block. Size it with `className` (`h-4 w-32`); it has no
 * intrinsic size on purpose so a caller can match the real element it stands in
 * for. `bg-muted` is the same surface the design system already uses for
 * progress tracks and avatars, so the placeholder never invents a colour.
 */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

/**
 * The wrapper every loading boundary should render once, at its root. It owns
 * the live region and the `data-loading` hook that lets the E2E suite assert a
 * boundary actually appeared — "we added a skeleton" is only true if a browser
 * can see it.
 */
export function SkeletonRegion({
  className,
  children,
  label = "Loading…",
  ...props
}: SkeletonProps & { label?: string }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      data-loading="true"
      className={className}
      {...props}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** N lines of body copy. The last is short, the way a real paragraph ends. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

/**
 * The page-heading block: eyebrow, title, description. Every surface in all
 * three apps opens with some subset of these three, so the boundary and the
 * page agree on where the content starts.
 */
export function SkeletonHeading({
  eyebrow = true,
  description = true,
  className,
}: {
  eyebrow?: boolean;
  description?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {eyebrow && <Skeleton className="h-3 w-40" />}
      <Skeleton className="h-7 w-64 max-w-full" />
      {description && <Skeleton className="h-3.5 w-full max-w-xl" />}
    </div>
  );
}

/** A bordered card placeholder — matches the `Card` surface. */
export function SkeletonCard({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card/40 p-5",
        className,
      )}
    >
      <Skeleton className="h-4 w-1/3" />
      <SkeletonText lines={lines} className="mt-4" />
    </div>
  );
}

/** One row of a list or table: a wide primary column plus trailing metadata. */
export function SkeletonRow({
  columns = 3,
  className,
}: {
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-4", className)}>
      <Skeleton className="h-4 flex-1" />
      {Array.from({ length: Math.max(0, columns - 1) }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-4", i % 2 === 0 ? "w-24" : "w-16")}
        />
      ))}
    </div>
  );
}

/** A grid of cards — directories, catalogues, feature rows. */
export function SkeletonCardGrid({
  cards = 6,
  lines = 2,
  className = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
}: {
  cards?: number;
  lines?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: cards }).map((_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </div>
  );
}

/** A labelled field placeholder — the unit every form surface repeats. */
export function SkeletonField({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-9 w-full rounded-lg" />
    </div>
  );
}

/** N fields inside a card — the shape of every edit/registration form. */
export function SkeletonForm({
  fields = 4,
  className,
}: {
  fields?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card/40 p-5",
        className,
      )}
    >
      <div className="flex flex-col gap-5">
        {Array.from({ length: fields }).map((_, i) => (
          <SkeletonField key={i} />
        ))}
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
    </div>
  );
}
