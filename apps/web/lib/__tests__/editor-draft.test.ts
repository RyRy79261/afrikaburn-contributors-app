import { describe, expect, it } from "vitest";
import {
  clearAllDrafts,
  clearDraft,
  DRAFT_PREFIX,
  draftKey,
  readDraft,
  stableJson,
  writeDraft,
  type DraftStore,
  type DraftTarget,
} from "../editor-draft";

// The meeting notes' local draft (lib/editor-draft.ts, ported from Camp 404):
// restored when it is the one typed over the version the editor opens at,
// thrown away once the server version has moved on, cleared on save and on
// sign-out, and never offered to another user or another meeting.

/** An in-memory Web Storage, the subset the drafts use. */
function memoryStore(seed: Record<string, string> = {}): DraftStore & {
  map: Map<string, string>;
} {
  const map = new Map(Object.entries(seed));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

type Notes = { notesMd: string };
const parse = (raw: unknown): Notes | null =>
  raw && typeof raw === "object" && typeof (raw as Notes).notesMd === "string"
    ? { notesMd: (raw as Notes).notesMd }
    : null;

const ALICE: DraftTarget = {
  editor: "meeting-notes",
  userId: "user-alice",
  subject: "meeting-1",
};
const SAVED: Notes = { notesMd: "Saved notes" };

describe("editor drafts", () => {
  it("keys a draft by editor, user, subject and version", () => {
    expect(draftKey(ALICE, 3)).toBe(
      `${DRAFT_PREFIX}meeting-notes:user-alice:meeting-1:v3`,
    );
  });

  it("restores the draft typed over the version the editor opens at", () => {
    const store = memoryStore();
    expect(writeDraft(store, ALICE, 3, { notesMd: "Unsaved" })).toBe(true);
    expect(readDraft(store, ALICE, 3, parse, SAVED)).toEqual({
      notesMd: "Unsaved",
    });
    // Reading does not consume it: a second reopen restores it again.
    expect(readDraft(store, ALICE, 3, parse, SAVED)).toEqual({
      notesMd: "Unsaved",
    });
  });

  it("ignores, and removes, a draft once the server version has moved on", () => {
    const store = memoryStore();
    writeDraft(store, ALICE, 3, { notesMd: "Typed over v3" });
    expect(readDraft(store, ALICE, 4, parse, SAVED)).toBeNull();
    expect(store.map.has(draftKey(ALICE, 3))).toBe(false);
  });

  it("is cleared after a successful save", () => {
    const store = memoryStore();
    writeDraft(store, ALICE, 3, { notesMd: "Unsaved" });
    clearDraft(store, ALICE, 3);
    expect(readDraft(store, ALICE, 3, parse, SAVED)).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it("never offers one user's draft to another, or one meeting's to another", () => {
    const store = memoryStore();
    writeDraft(store, ALICE, 3, { notesMd: "Alice's unsaved notes" });
    const ren = { ...ALICE, userId: "user-ren" };
    const other = { ...ALICE, subject: "meeting-2" };
    expect(readDraft(store, ren, 3, parse, SAVED)).toBeNull();
    expect(readDraft(store, other, 3, parse, SAVED)).toBeNull();
    // ...and reading theirs does not throw Alice's away.
    expect(store.map.has(draftKey(ALICE, 3))).toBe(true);
  });

  it("drops a draft equal to what is saved, or one that fails its parse", () => {
    const store = memoryStore();
    writeDraft(store, ALICE, 3, SAVED);
    expect(readDraft(store, ALICE, 3, parse, SAVED)).toBeNull();
    expect(store.map.size).toBe(0);

    store.setItem(draftKey(ALICE, 3), JSON.stringify({ notesMd: 42 }));
    expect(readDraft(store, ALICE, 3, parse, SAVED)).toBeNull();
    store.setItem(draftKey(ALICE, 3), "{not json");
    expect(readDraft(store, ALICE, 3, parse, SAVED)).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it("survives a store that refuses to write or read", () => {
    const broken: DraftStore = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(writeDraft(broken, ALICE, 3, { notesMd: "x" })).toBe(false);
    expect(readDraft(broken, ALICE, 3, parse, SAVED)).toBeNull();
    expect(() => clearDraft(broken, ALICE, 3)).not.toThrow();
    expect(() => clearAllDrafts(broken)).not.toThrow();
  });

  it("clears every editor's draft on sign-out, and nothing else", () => {
    const store = memoryStore({ theme: "dark" });
    writeDraft(store, ALICE, 3, { notesMd: "a" });
    writeDraft(store, { ...ALICE, subject: "meeting-2" }, 1, { notesMd: "b" });
    clearAllDrafts(store);
    expect([...store.map.keys()]).toEqual(["theme"]);
  });

  it("writes keys in a stable order, so equal values compare equal", () => {
    expect(stableJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      stableJson({ a: [{ c: 3, d: 2 }], b: 1 }),
    );
  });
});
