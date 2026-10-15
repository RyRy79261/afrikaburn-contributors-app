"use client";

import * as React from "react";

// The meeting page's one shared version. Notes saves, edits and cancels are
// all compare-and-set on the same `camp_meetings.version`, so each write on
// this page must move the version the others send — otherwise the
// organiser's own save would read to the server as someone else's. Both
// directions: a notes save moves the version Cancel sends (setVersion), and a
// cancel moves the version an OPEN notes editor holds (announceWrite, which
// the editor adopts through onWrite when it held `from`; its local draft
// follows).

/** A write on this page moved the version from `from` to `to`. */
type WriteListener = (from: number, to: number) => void;

interface VersionState {
  version: number;
  setVersion: (v: number) => void;
  /** A write that did not touch the notes (Cancel) moved the version: raise
   * it and tell an open notes editor, which adopts it if it held `from`. */
  announceWrite: (from: number, to: number) => void;
  /** Listen for announced writes; returns the unsubscribe. */
  onWrite: (listener: WriteListener) => () => void;
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
  const [listeners] = React.useState(() => new Set<WriteListener>());
  const version = Math.max(saved, rendered);
  const value = React.useMemo<VersionState>(
    () => ({
      version,
      setVersion: setSaved,
      announceWrite: (from, to) => {
        setSaved((v) => Math.max(v, to));
        for (const l of listeners) l(from, to);
      },
      onWrite: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    }),
    [version, listeners],
  );
  return (
    <VersionContext.Provider value={value}>{children}</VersionContext.Provider>
  );
}

/** The meeting's current version and its setters; throws outside a provider. */
export function useMeetingVersion(): VersionState {
  const v = React.useContext(VersionContext);
  if (!v) throw new Error("useMeetingVersion needs a MeetingVersionProvider");
  return v;
}
