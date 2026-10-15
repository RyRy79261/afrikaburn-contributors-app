// Local drafts for editors that save with an explicit button (ported from
// Camp 404's editor-draft, adapted: localStorage, no desktop windows).
//
// While someone types, the form is written to THIS BROWSER's storage, so a
// reload, a dropped signal or a closed tab does not lose it. Nothing reaches
// the server until they press Save. A draft is keyed by its editor, the
// signed-in user, what is being edited and the server version the editor
// opened at:
//
//   quagga:draft:<editor>:<userId>:<subject>:v<version>
//
// So a draft is only ever offered back to the person who typed it, on the
// thing they typed it over, at the version they typed it over. Once the
// server version has moved on (someone saved), the old draft is never read
// again and is removed the next time the editor opens. It is cleared after a
// successful save, on Discard, and for every editor on sign-out.
//
// What is stored is only what the user typed into a form they could already
// open; what is read back is never trusted — each editor checks it with its
// own `parse` and anything else is thrown away.

/** Every draft key starts with this; sign-out clears them all. */
export const DRAFT_PREFIX = "quagga:draft:";

/** How long typing must pause before the draft is written. */
export const DRAFT_AUTOSAVE_MS = 400;

/** The part of the Web Storage API the drafts use (a fake in tests). */
export type DraftStore = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

/** The browser's localStorage, or null where there is none or it is blocked. */
export function browserDraftStore(): DraftStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // A sandboxed frame or a blocked store throws on access.
    return null;
  }
}

/**
 * JSON with every object's keys sorted, so two equal values always give the
 * same string, whatever order their keys were written in.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      );
    }
    return v;
  });
}

/** Where one editor keeps its draft: everything but the version. */
export interface DraftTarget {
  /** Which editor, e.g. "meeting-notes". */
  editor: string;
  /** The signed-in user: a draft is only offered back to its writer. */
  userId: string;
  /** What is being edited, e.g. the meeting id. */
  subject: string;
}

/** The prefix every version of one target's draft shares. */
function targetPrefix({ editor, userId, subject }: DraftTarget): string {
  return `${DRAFT_PREFIX}${editor}:${userId}:${subject}:v`;
}

/** The storage key for a target's draft typed over `version`. */
export function draftKey(target: DraftTarget, version: number): string {
  return `${targetPrefix(target)}${version}`;
}

/** Every key in the store starting with `prefix`. */
function keysWithPrefix(store: DraftStore, prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

/** Removes a key, ignoring a store that refuses. */
function removeQuietly(store: DraftStore, key: string) {
  try {
    store.removeItem(key);
  } catch {
    // Nothing to remove, or the store is unavailable.
  }
}

/**
 * The draft to start the editor from, or null to start from what is saved.
 *
 * Reads the draft for `version` only: a draft typed over any other version of
 * the same target is removed, because the saved text has moved on under it.
 * A draft that fails `parse`, or that equals `baseline` (nothing unsaved), is
 * removed too and is not a restore.
 */
export function readDraft<T>(
  store: DraftStore,
  target: DraftTarget,
  version: number,
  parse: (raw: unknown) => T | null,
  baseline: T,
): T | null {
  const key = draftKey(target, version);
  try {
    for (const stale of keysWithPrefix(store, targetPrefix(target))) {
      if (stale !== key) removeQuietly(store, stale);
    }
    const raw = store.getItem(key);
    if (raw === null) return null;
    const draft = parse(JSON.parse(raw) as unknown);
    if (draft === null || stableJson(draft) === stableJson(baseline)) {
      removeQuietly(store, key);
      return null;
    }
    return draft;
  } catch {
    // A corrupt or unavailable draft is never fatal: start from the saved.
    removeQuietly(store, key);
    return null;
  }
}

/** Writes the draft; false when the store refused (full, private mode). */
export function writeDraft(
  store: DraftStore,
  target: DraftTarget,
  version: number,
  value: unknown,
): boolean {
  try {
    store.setItem(draftKey(target, version), stableJson(value));
    return true;
  } catch {
    return false;
  }
}

/** Removes the target's draft at `version` (after a save, on Discard). */
export function clearDraft(
  store: DraftStore,
  target: DraftTarget,
  version: number,
) {
  removeQuietly(store, draftKey(target, version));
}

/** Removes every editor's draft in this browser (on sign-out). */
export function clearAllDrafts(store: DraftStore) {
  try {
    for (const key of keysWithPrefix(store, DRAFT_PREFIX)) {
      removeQuietly(store, key);
    }
  } catch {
    // The store is unavailable: nothing was kept in it either.
  }
}
