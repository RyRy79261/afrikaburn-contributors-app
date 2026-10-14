"use client";

import { useSyncExternalStore, type ReactNode } from "react";

// Editing needs 768 px (docs/camp-layout-spec.md decision 13: 360 is
// view-only). The server cannot know the width, so it renders nothing here;
// the browser mounts the children only once the viewport is wide enough.
// A phone therefore never mounts the editor at all: no palette, no
// warnings panel, no autosave, no Konva — not merely hidden by CSS.

const QUERY = "(min-width: 768px)";

export function useWideEnough(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

export function WideOnly({ children }: { children: ReactNode }) {
  return useWideEnough() ? children : null;
}
