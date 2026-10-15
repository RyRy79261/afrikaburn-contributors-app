// The camp layout editor's autosave, as a plain controller so it can be tested
// without a browser (docs/camp-layout-spec.md §Surfaces, "save state").
//
// One save in flight at a time; each is a compare-and-set on the version the
// last save returned. A change waits `debounceMs` before it is sent.
//
// TWO WAYS AN EDIT USED TO BE LOST, and why this file exists:
//
// 1. LEAVING THE PAGE INSIDE THE DEBOUNCE. The timer lived in an effect whose
//    cleanup cleared it, so clicking the back link (or any in-app link) within
//    the pause unmounted the editor and the change was never sent. App Router
//    navigation fires no `beforeunload`, so nothing warned either. `leave()`
//    is called on unmount and on `pagehide`: it cancels the timer and sends
//    what is unsaved NOW, instead of dropping it.
//
// 2. A SAVE THAT COMMITTED BUT WHOSE RESPONSE WAS LOST. The retry went out with
//    the old expected version and the store refused it as stale — a conflict
//    with oneself, naming the user as the "someone" who saved first, and every
//    later edit stranded behind a Reload. Now the doc whose outcome is unknown
//    is remembered and retried FIRST, exactly as sent; the store treats a stale
//    save whose document already IS the current one as saved
//    (`saveCampLayout`), so the retry adopts the version it really made.

export type AutosaveState =
  | { kind: "saved" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "offline" }
  | { kind: "refused"; message: string }
  | { kind: "conflict"; byName: string | null; at: string | null };

export type AutosaveResult =
  | { ok: true; version: number }
  | {
      ok: false;
      error: string;
      conflict?: { byName: string | null; at: string | null };
    };

export interface LayoutAutosaveOptions<D> {
  initial: D;
  version: number;
  send: (doc: D, expectedVersion: number) => Promise<AutosaveResult>;
  onState: (state: AutosaveState) => void;
  onSaved: (version: number) => void;
  debounceMs: number;
  retryMs: number;
}

export interface LayoutAutosave<D> {
  /** The document changed: save it after the pause. */
  change(doc: D): void;
  /** Send now (joins nothing; a no-op while a save is in flight). */
  flush(): Promise<void>;
  /** "Try again" after an offline or refused save. */
  retry(): void;
  /** The editor is going away (unmount, pagehide): send what is unsaved now
   * rather than drop it, and stop retrying in the background. */
  leave(): void;
  /** Something the server does not hold yet. */
  hasUnsaved(): boolean;
  /**
   * Should leaving the page ask first? Only while there is something unsaved
   * that is still worth keeping. After a conflict the editor has already told
   * the user their last change wasn't kept and offers Reload — asking "Leave
   * site?" about that change would only put a second dialog in the way.
   */
  shouldWarnOnLeave(): boolean;
}

/**
 * The editor's autosave controller: one compare-and-set save in flight at a
 * time, debounced, retried while offline, and stopped for good by a conflict
 * or refusal until `retry()`.
 */
export function createLayoutAutosave<D>(
  opts: LayoutAutosaveOptions<D>,
): LayoutAutosave<D> {
  let latest = opts.initial;
  let saved = opts.initial;
  let version = opts.version;
  /** Sent, but we never heard back: it may or may not have committed. */
  let uncertain: D | null = null;
  let inFlight = false;
  let blocked = false;
  let leaving = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let state: AutosaveState = { kind: "saved" };

  /** Records the state and reports it to the editor. */
  const set = (s: AutosaveState) => {
    state = s;
    opts.onState(s);
  };
  /** Cancels a pending debounce or retry timer. */
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  /** A flush in `ms`, replacing any one already scheduled. */
  const schedule = (ms: number) => {
    clear();
    timer = setTimeout(() => void flush(), ms);
  };
  /** True while a save's outcome is unknown or the latest doc differs from the
   * saved one. */
  const hasUnsaved = () => uncertain !== null || latest !== saved;

  /**
   * Sends the uncertain doc first, else the latest; on success sends again if
   * more changed meanwhile. A thrown send is "offline" and retried; a refusal
   * or conflict blocks further saves.
   */
  async function flush(): Promise<void> {
    clear();
    if (inFlight || blocked) return;
    const toSend = uncertain ?? latest;
    if (toSend === saved) {
      set({ kind: "saved" });
      return;
    }
    inFlight = true;
    set({ kind: "saving" });
    let r: AutosaveResult;
    try {
      r = await opts.send(toSend, version);
    } catch {
      inFlight = false;
      uncertain = toSend;
      set({ kind: "offline" });
      if (!leaving) schedule(opts.retryMs);
      return;
    }
    inFlight = false;
    uncertain = null;
    if (r.ok) {
      version = r.version;
      saved = toSend;
      opts.onSaved(r.version);
      if (latest !== saved) await flush();
      else set({ kind: "saved" });
      return;
    }
    blocked = true;
    set(
      r.conflict
        ? { kind: "conflict", byName: r.conflict.byName, at: r.conflict.at }
        : { kind: "refused", message: r.error },
    );
  }

  return {
    /** A change undone back to the saved doc cancels the pending send. */
    change(doc) {
      latest = doc;
      leaving = false;
      if (blocked) return;
      if (!hasUnsaved()) {
        // Undone back to what is saved: nothing to send.
        clear();
        if (!inFlight) set({ kind: "saved" });
        return;
      }
      if (state.kind !== "saving") set({ kind: "pending" });
      schedule(opts.debounceMs);
    },
    flush,
    /** Unblocks after a refusal or conflict and sends straight away. */
    retry() {
      blocked = false;
      leaving = false;
      void flush();
    },
    /** Sends what is unsaved now; a save in flight sends the rest when it
     * lands. */
    leave() {
      leaving = true;
      clear();
      // In flight: its completion sends whatever came after it.
      if (!blocked && !inFlight && hasUnsaved()) void flush();
    },
    hasUnsaved,
    shouldWarnOnLeave: () => state.kind !== "conflict" && hasUnsaved(),
  };
}
