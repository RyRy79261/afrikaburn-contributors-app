import { Card, CardContent } from "@quagga/ui/components/card";

// Route-group loading skeleton. Shown while a console page's server component
// suspends on its queries (every page is `force-dynamic`). It mirrors the
// standard page shape — a heading block over a grid of cards — so the layout
// doesn't jump when the real content arrives. Purely presentational; the
// `animate-pulse` bars stand in for the eventual heading, KPI row and list.

function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded-md bg-muted ${className}`} />;
}

export default function ConsoleLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-hidden>
      <span className="sr-only" aria-live="polite">
        Loading…
      </span>

      {/* Page heading */}
      <div className="flex flex-col gap-2">
        <Bar className="h-3 w-32" />
        <Bar className="h-7 w-64" />
        <Bar className="h-4 w-full max-w-xl" />
      </div>

      {/* KPI / summary row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex flex-col gap-3 p-5">
              <Bar className="h-3 w-24" />
              <Bar className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* List / table body */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Bar className="h-4 flex-1" />
              <Bar className="h-4 w-24" />
              <Bar className="h-4 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
