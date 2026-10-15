"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import {
  browserDraftStore,
  clearDraft,
  DRAFT_AUTOSAVE_MS,
  readDraft,
  stableJson,
  writeDraft,
  type DraftTarget,
} from "@/lib/editor-draft";

// The React side of lib/editor-draft.ts (ported from Camp 404's
// editor-draft): an editor that saves with an explicit button keeps what is
// typed in this browser's storage until it is saved, and on reopening starts
// from that draft with "Draft restored" and a Discard button. The storage
// rules — the key, the version check, what clears a draft — are in the lib.
//
// Usage: call useEditorDraft in a wrapper and key the form by `generation`,
// so a restore or a Discard starts the form again from `start`; inside the
// form, call useDraftAutosave with what is typed now.

export interface EditorDraft<T> {
  /** The values the form starts from: a restored draft, or the saved ones. */
  start: T;
  /** Changes when the form must start again (a restore, a Discard): its key. */
  generation: number;
  /** The form started from a draft that had not been saved. */
  restored: boolean;
  /** Throws the draft away and starts again from the saved values. */
  discard: () => void;
  /** Where the draft lives, and the version it is typed over. */
  target: DraftTarget;
  version: number;
  /** The saved values (stableJson), to tell whether anything is unsaved. */
  baselineJson: string;
}

/**
 * The start of an editor that keeps a local draft.
 *
 * `baseline` is what is saved now at `version`; `parse` checks a draft read
 * back and returns it, or null to throw it away. The draft is read after
 * mount, never while rendering, so the server's paint and the browser's first
 * render match; a draft found then starts the form again (`generation` + 1)
 * before anything is painted.
 */
export function useEditorDraft<T>({
  target,
  version,
  baseline,
  parse,
}: {
  target: DraftTarget;
  version: number;
  baseline: T;
  parse: (raw: unknown) => T | null;
}): EditorDraft<T> {
  const [state, setState] = React.useState({
    start: baseline,
    generation: 0,
    restored: false,
  });
  const latest = React.useRef({ baseline, parse, target, version });
  React.useEffect(() => {
    latest.current = { baseline, parse, target, version };
  });

  // Once, on mount: the draft for the version the editor opened, if any.
  React.useLayoutEffect(() => {
    const store = browserDraftStore();
    if (!store) return;
    const {
      baseline: saved,
      parse: check,
      target: t,
      version: v,
    } = latest.current;
    const draft = readDraft(store, t, v, check, saved);
    if (draft === null) return;
    // A restore is an event (the form starts again from the draft), not
    // state derived from props.
    setState((s) => ({
      start: draft,
      generation: s.generation + 1,
      restored: true,
    }));
  }, []);

  const discard = React.useCallback(() => {
    const store = browserDraftStore();
    const { baseline: saved, target: t, version: v } = latest.current;
    if (store) clearDraft(store, t, v);
    setState((s) => ({
      start: saved,
      generation: s.generation + 1,
      restored: false,
    }));
  }, []);

  return {
    start: state.start,
    generation: state.generation,
    restored: state.restored,
    discard,
    target,
    version,
    baselineJson: stableJson(baseline),
  };
}

/**
 * Inside the form: writes `values` to the draft a moment after typing stops
 * (and as the page goes away), removes it once the values are back to what is
 * saved, and moves it along if the version the editor holds moves (a write on
 * the same page that did not touch this form). Returns `dirty`, and `saved`
 * to call once the server has the values, which clears the draft.
 */
export function useDraftAutosave<T>(
  draft: EditorDraft<T>,
  values: T,
): { dirty: boolean; saved: () => void } {
  const json = stableJson(values);
  const dirty = json !== draft.baselineJson;
  const { target, version } = draft;
  const targetKey = stableJson(target);

  const latest = React.useRef({ json, dirty, target, version });
  React.useEffect(() => {
    latest.current = { json, dirty, target, version };
  });
  // The values last handed to the server: never written back as a draft by
  // a pause or a pagehide that lands after the save.
  const savedJson = React.useRef<string | null>(null);

  // The version moved under an open editor: the draft follows it.
  const heldVersion = React.useRef(version);
  React.useEffect(() => {
    if (heldVersion.current === version) return;
    const store = browserDraftStore();
    const now = latest.current;
    if (store) {
      clearDraft(store, now.target, heldVersion.current);
      if (now.dirty)
        writeDraft(store, now.target, version, JSON.parse(now.json));
    }
    heldVersion.current = version;
  }, [version]);

  // Written a moment after typing stops; removed once the input is back to
  // what is saved (never merely because the form opened clean).
  const wasDirty = React.useRef(false);
  React.useEffect(() => {
    const store = browserDraftStore();
    if (!store) return;
    const t = JSON.parse(targetKey) as DraftTarget;
    if (!dirty) {
      if (wasDirty.current) clearDraft(store, t, version);
      wasDirty.current = false;
      return;
    }
    wasDirty.current = true;
    const timer = window.setTimeout(() => {
      if (json !== savedJson.current) {
        writeDraft(store, t, version, JSON.parse(json) as unknown);
      }
    }, DRAFT_AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, json, targetKey, version]);

  // A tab closed or reloaded mid-pause: write what is there now.
  React.useEffect(() => {
    if (!dirty) return;
    const flush = () => {
      const store = browserDraftStore();
      const now = latest.current;
      if (store && now.dirty && now.json !== savedJson.current) {
        writeDraft(store, now.target, now.version, JSON.parse(now.json));
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [dirty]);

  const saved = React.useCallback(() => {
    const store = browserDraftStore();
    wasDirty.current = false;
    savedJson.current = latest.current.json;
    if (store) {
      clearDraft(store, latest.current.target, latest.current.version);
    }
  }, []);

  return { dirty, saved };
}

/** "Draft restored", with Discard, above a form that started from a draft;
 * nothing when it started from what is saved. */
export function DraftRestoredNote<T>({
  draft,
  disabled,
}: {
  draft: EditorDraft<T>;
  disabled?: boolean;
}) {
  if (!draft.restored) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm"
    >
      <span className="flex items-center gap-2">
        <RotateCcw aria-hidden className="h-4 w-4 shrink-0 text-primary" />
        Draft restored: your unsaved changes from this browser.
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={draft.discard}
        disabled={disabled}
      >
        Discard draft
      </Button>
    </div>
  );
}
