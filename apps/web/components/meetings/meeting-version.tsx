"use client";

import * as React from "react";

// The meeting page's one shared version. Notes saves, edits and cancels are
// all compare-and-set on the same `camp_meetings.version`, so a notes autosave
// on this page must move the version the Cancel button sends — otherwise the
// organiser's own save would read to the server as someone else's.

interface VersionState {
  version: number;
  setVersion: (v: number) => void;
}

const VersionContext = React.createContext<VersionState | null>(null);

/** Holds the version the page was rendered at, raised by every save here. A
 * fresh render (router.refresh) that brings a newer version wins too. */
export function MeetingVersionProvider({
  version: rendered,
  children,
}: {
  version: number;
  children: React.ReactNode;
}) {
  const [saved, setSaved] = React.useState(rendered);
  const version = Math.max(saved, rendered);
  const value = React.useMemo(
    () => ({ version, setVersion: setSaved }),
    [version],
  );
  return (
    <VersionContext.Provider value={value}>{children}</VersionContext.Provider>
  );
}

/** The meeting's current version and its setter; throws outside a provider. */
export function useMeetingVersion(): VersionState {
  const v = React.useContext(VersionContext);
  if (!v) throw new Error("useMeetingVersion needs a MeetingVersionProvider");
  return v;
}
