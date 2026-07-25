import { MapPin } from "lucide-react";
import { initialsFromName } from "@quagga/core";

// Third-party burner profile hero (canvas `mm31G` / `lYUEe`): eyebrow, avatar,
// name, and a meta row of city · burns count. Everything it renders has already
// passed `publicBioView` server-side — a null field here means the owner chose
// private (or the field is hard-locked and never eligible), so the component
// simply omits it. It performs NO privacy decisions of its own.

export function ProfileHero({
  displayName,
  homeCity,
  burnsCount,
  firstTime,
  action,
}: {
  displayName: string;
  /** Public home city, or null when withheld. */
  homeCity: string | null;
  /** Number of public attended years, or null when the years are withheld. */
  burnsCount: number | null;
  /** Public first-timer flag, or null when withheld. */
  firstTime: boolean | null;
  /** Optional trailing action (e.g. "Edit your bio" on your own profile). */
  action?: React.ReactNode;
}) {
  const burnsLabel =
    burnsCount != null && burnsCount > 0
      ? `${burnsCount} ${burnsCount === 1 ? "burn" : "burns"}`
      : firstTime === true
        ? "First AfrikaBurn"
        : null;

  return (
    <header className="flex flex-col gap-3">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
        Public profile
      </p>
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-card p-5">
        <div className="flex min-w-0 items-center gap-4">
          <span
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-foreground sm:h-[72px] sm:w-[72px]"
            aria-hidden
          >
            {initialsFromName(displayName)}
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {displayName}
            </h1>
            {(homeCity || burnsLabel) && (
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                {homeCity && (
                  <>
                    <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                    <span>{homeCity}</span>
                  </>
                )}
                {homeCity && burnsLabel && <span aria-hidden>·</span>}
                {burnsLabel && <span>{burnsLabel}</span>}
              </p>
            )}
          </div>
        </div>
        {action}
      </div>
    </header>
  );
}
