import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLayoutAutosave,
  type AutosaveResult,
  type AutosaveState,
} from "../layout-autosave";

// The editor's autosave controller. Two regressions are pinned here:
// leaving the page inside the debounce dropped the edit, and a save that
// committed but whose response was lost became a conflict with oneself.

interface Doc {
  n: number;
}

type Send = (doc: Doc, expectedVersion: number) => Promise<AutosaveResult>;

function setup(send: Send) {
  const states: AutosaveState[] = [];
  const saved: number[] = [];
  const initial: Doc = { n: 0 };
  const a = createLayoutAutosave<Doc>({
    initial,
    version: 1,
    send,
    onState: (s) => states.push(s),
    onSaved: (v) => saved.push(v),
    debounceMs: 800,
    retryMs: 10_000,
  });
  return { a, states, saved, initial, last: () => states.at(-1) };
}

/** A fake server holding one versioned document, compare-and-set like the
 * store, including "a stale save of the current document is saved". */
function fakeServer() {
  const server = { version: 1, doc: { n: 0 } as Doc, calls: 0 };
  const commit: Send = async (doc, expected) => {
    server.calls++;
    if (expected !== server.version) {
      if (doc.n === server.doc.n) return { ok: true, version: server.version };
      return {
        ok: false,
        error: "stale",
        conflict: { byName: "Someone", at: null },
      };
    }
    server.version++;
    server.doc = doc;
    return { ok: true, version: server.version };
  };
  return { server, commit };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("layout autosave", () => {
  it("saves a change after the pause, and not before", async () => {
    const { server, commit } = fakeServer();
    const { a, last } = setup(commit);
    a.change({ n: 1 });
    expect(last()).toEqual({ kind: "pending" });
    await vi.advanceTimersByTimeAsync(799);
    expect(server.calls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.doc).toEqual({ n: 1 });
    expect(last()).toEqual({ kind: "saved" });
    expect(a.hasUnsaved()).toBe(false);
  });

  it("undoing back to the saved document sends nothing", async () => {
    const { server, commit } = fakeServer();
    const { a, initial, last } = setup(commit);
    a.change({ n: 1 });
    a.change(initial);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.calls).toBe(0);
    expect(last()).toEqual({ kind: "saved" });
  });

  it("leaving inside the debounce sends the change instead of dropping it", async () => {
    const { server, commit } = fakeServer();
    const { a } = setup(commit);
    a.change({ n: 1 });
    // The back link is clicked 100 ms later: the editor unmounts.
    await vi.advanceTimersByTimeAsync(100);
    a.leave();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.doc).toEqual({ n: 1 });
    expect(server.version).toBe(2);
    expect(a.hasUnsaved()).toBe(false);
  });

  it("leaving while offline makes one more attempt, then stops retrying", async () => {
    const send = vi.fn<Send>().mockRejectedValue(new Error("offline"));
    const { a, last } = setup(send);
    a.change({ n: 1 });
    await vi.advanceTimersByTimeAsync(800);
    expect(last()).toEqual({ kind: "offline" });
    expect(send).toHaveBeenCalledTimes(1);
    a.leave();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("a change made while a save is in flight is sent after it", async () => {
    const { server, commit } = fakeServer();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const send: Send = async (doc, v) => {
      await gate;
      return commit(doc, v);
    };
    const { a } = setup(send);
    a.change({ n: 1 });
    await vi.advanceTimersByTimeAsync(800);
    a.change({ n: 2 });
    a.leave(); // in flight: its completion carries the rest
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.doc).toEqual({ n: 2 });
    expect(server.version).toBe(3);
  });

  it("a save that committed but whose response was lost is adopted, not a conflict", async () => {
    const { server, commit } = fakeServer();
    let dropNext = true;
    const send: Send = async (doc, v) => {
      const r = await commit(doc, v);
      if (dropNext) {
        dropNext = false;
        throw new Error("response lost after commit");
      }
      return r;
    };
    const { a, states, last } = setup(send);
    a.change({ n: 1 });
    await vi.advanceTimersByTimeAsync(800);
    expect(server.version).toBe(2); // it DID commit
    expect(last()).toEqual({ kind: "offline" });

    // More work while we think we're offline.
    a.change({ n: 2 });
    await vi.advanceTimersByTimeAsync(800);

    expect(states.some((s) => s.kind === "conflict")).toBe(false);
    expect(server.doc).toEqual({ n: 2 });
    expect(server.version).toBe(3);
    expect(last()).toEqual({ kind: "saved" });
    expect(a.hasUnsaved()).toBe(false);
  });

  it("someone else's newer save is still a conflict, and blocks", async () => {
    const { server, commit } = fakeServer();
    server.version = 5;
    server.doc = { n: 99 };
    const { a, last } = setup(commit);
    a.change({ n: 1 });
    await vi.advanceTimersByTimeAsync(800);
    expect(last()).toEqual({
      kind: "conflict",
      byName: "Someone",
      at: null,
    });
    a.change({ n: 2 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.calls).toBe(1);
  });

  it("asks before leaving with an unsaved change, but not after a conflict", async () => {
    const { server, commit } = fakeServer();
    const { a } = setup(commit);
    a.change({ n: 1 });
    // Pending, not sent yet: leaving would drop it, so ask.
    expect(a.shouldWarnOnLeave()).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(a.shouldWarnOnLeave()).toBe(false);

    // Someone else saves first: the editor says the change wasn't kept and
    // offers Reload. Reloading must not hit a second "Leave site?" dialog.
    server.version = 9;
    server.doc = { n: 42 };
    a.change({ n: 3 });
    await vi.advanceTimersByTimeAsync(800);
    expect(a.hasUnsaved()).toBe(true);
    expect(a.shouldWarnOnLeave()).toBe(false);

    // But an edit made AFTER the conflict cannot be saved either, and nothing
    // has told the user it is lost: leaving must ask again.
    a.change({ n: 4 });
    expect(a.shouldWarnOnLeave()).toBe(true);
  });

  it("adopts a same-page write (a cancel) made on top of its version", async () => {
    // Cancel on the meeting page moved v1 -> v2 while the notes editor was
    // open; the editor's next save must go out at v2, not be refused as
    // someone else's save.
    const { server, commit } = fakeServer();
    const { a, last, saved } = setup(commit);
    server.version = 2; // the cancel's compare-and-set
    a.rebase(1, 2);
    a.change({ n: 1 });
    await vi.advanceTimersByTimeAsync(800);
    expect(last()).toEqual({ kind: "saved" });
    expect(saved).toEqual([3]);
    expect(server.doc).toEqual({ n: 1 });
  });

  it("does not adopt a write made on top of a version it does not hold", async () => {
    // A rebase from a version this editor never held could skip over someone
    // else's save: it must stay a conflict.
    const { server, commit } = fakeServer();
    const { a, last } = setup(commit);
    server.version = 3;
    server.doc = { n: 42 };
    a.rebase(2, 3);
    a.change({ n: 1 });
    await vi.advanceTimersByTimeAsync(800);
    expect(last()?.kind).toBe("conflict");
    expect(server.doc).toEqual({ n: 42 });
  });

  it("a save refused because a same-page write won the race is sent again", async () => {
    const { server, commit } = fakeServer();
    let release: () => void = () => {};
    const send: Send = async (doc, expected) => {
      if (server.calls === 0) {
        // The cancel lands while this first save is in flight.
        await new Promise<void>((r) => (release = r));
      }
      return commit(doc, expected);
    };
    const { a, last } = setup(send);
    a.change({ n: 1 });
    await vi.advanceTimersByTimeAsync(800);
    server.version = 2;
    a.rebase(1, 2);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toEqual({ kind: "saved" });
    expect(server.doc).toEqual({ n: 1 });
    expect(server.version).toBe(3);
  });

  it("reports the document each save committed", async () => {
    const { commit } = fakeServer();
    const docs: Doc[] = [];
    const a = createLayoutAutosave<Doc>({
      initial: { n: 0 },
      version: 1,
      send: commit,
      onState: () => {},
      onSaved: (_v, doc) => docs.push(doc),
      debounceMs: 800,
      retryMs: 10_000,
    });
    a.change({ n: 7 });
    await vi.advanceTimersByTimeAsync(800);
    expect(docs).toEqual([{ n: 7 }]);
  });
});
