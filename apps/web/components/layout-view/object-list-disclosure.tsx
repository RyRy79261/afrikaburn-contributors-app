"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

// The object list folds away on a phone (frame t7aOZ3: "13 objects ⌄") and
// stands open beside the plan from 768 px (frame QZeG7). One native
// <details>, so the list exists once in the page: open on the server, and
// folded after hydration when the screen is narrow.

/** A <details> that is open on the server and wide screens, folded on a
 * phone. */
export function ObjectListDisclosure({
  summary,
  children,
}: {
  summary: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current && !window.matchMedia("(min-width: 768px)").matches) {
      ref.current.open = false;
    }
  }, []);
  return (
    <details ref={ref} open className="group">
      <summary
        onClick={(e) => {
          // Beside the plan the list is always open.
          if (window.matchMedia("(min-width: 768px)").matches)
            e.preventDefault();
        }}
        className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:cursor-default [&::-webkit-details-marker]:hidden"
      >
        {summary}
        <ChevronDown
          className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180 md:hidden"
          aria-hidden
        />
      </summary>
      {children}
    </details>
  );
}
