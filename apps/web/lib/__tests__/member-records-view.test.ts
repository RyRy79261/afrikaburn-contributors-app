import { describe, expect, it } from "vitest";
import {
  ACTION_FAILED,
  duplicateHintSentence,
  exportFilenameFrom,
  exportResponseOutcome,
  memberNotesExportHref,
  settleAction,
  memberNoteDateLabel,
  toPrivateNoteItems,
} from "../member-records-view";

// The member-records surfaces' wording and shaping (frames R1, R2).

describe("memberNoteDateLabel", () => {
  it("formats the day in South African time", () => {
    expect(memberNoteDateLabel(new Date("2026-10-12T09:00:00Z"))).toBe(
      "12 Oct 2026",
    );
  });

  it("rolls a late-UTC moment into the next SAST day", () => {
    // 23:30 UTC on the 11th is 01:30 SAST on the 12th.
    expect(memberNoteDateLabel(new Date("2026-10-11T23:30:00Z"))).toBe(
      "12 Oct 2026",
    );
  });
});

describe("toPrivateNoteItems", () => {
  it("keeps the order and the server's verdicts, and drops the dates", () => {
    const items = toPrivateNoteItems([
      {
        id: "n2",
        body: "Great on build week",
        unreadable: false,
        authorName: "Alice Hatter",
        createdAt: new Date("2026-10-12T09:00:00Z"),
        edited: true,
        canEdit: true,
        canDelete: true,
      },
      {
        id: "n1",
        body: "Asked not to be on night shifts",
        unreadable: false,
        authorName: "Ren Notfound",
        createdAt: new Date("2026-10-03T09:00:00Z"),
        edited: false,
        canEdit: false,
        canDelete: false,
      },
    ]);
    expect(items).toEqual([
      {
        id: "n2",
        body: "Great on build week",
        unreadable: false,
        authorName: "Alice Hatter",
        dateLabel: "12 Oct 2026",
        edited: true,
        canEdit: true,
        canDelete: true,
      },
      {
        id: "n1",
        body: "Asked not to be on night shifts",
        unreadable: false,
        authorName: "Ren Notfound",
        dateLabel: "3 Oct 2026",
        edited: false,
        canEdit: false,
        canDelete: false,
      },
    ]);
  });
});

describe("duplicateHintSentence", () => {
  it("names the other account first, as frame R2 reads", () => {
    expect(
      duplicateHintSentence("Thandi Mokoena-Dube", {
        userId: "u1",
        name: "Thandi Mokoena",
      }),
    ).toBe(
      "Thandi Mokoena and Thandi Mokoena-Dube have similar names. They may be one person with two accounts.",
    );
  });
});

// Regression (PR #108 review): the roster's "Not the same person" awaited the
// server action with no catch, so a rejected call (dropped connection, server
// crash) escaped the transition and the person who clicked was told nothing.
describe("settleAction", () => {
  it("turns a rejected call into a refusal the caller can toast", async () => {
    await expect(
      settleAction(() => Promise.reject(new Error("network down"))),
    ).resolves.toEqual({ ok: false, error: ACTION_FAILED });
  });

  it("passes a settled result through untouched", async () => {
    const ok = { ok: true as const };
    await expect(settleAction(() => Promise.resolve(ok))).resolves.toBe(ok);
    const refused = { ok: false as const, error: "Not similar." };
    await expect(settleAction(() => Promise.resolve(refused))).resolves.toBe(
      refused,
    );
  });
});

describe("the member-notes export link (#105)", () => {
  it("points at the camp's export route for one member, encoded", () => {
    expect(
      memberNotesExportHref("mad-hatters", "aaaaaaaa-0000-4000-8000-000000000003"),
    ).toBe(
      "/camps/mad-hatters/member-notes/aaaaaaaa-0000-4000-8000-000000000003/export",
    );
    expect(memberNotesExportHref("a/b?c", "x")).toBe(
      "/camps/a%2Fb%3Fc/member-notes/x/export",
    );
  });

  it("takes only the slugged filename shape the route sends; anything else falls back", () => {
    expect(
      exportFilenameFrom('attachment; filename="member-notes-mad-hatters-jabu-2026-10-18.txt"'),
    ).toBe("member-notes-mad-hatters-jabu-2026-10-18.txt");
    for (const header of [
      null,
      "attachment",
      'attachment; filename="../../evil.txt"',
      'attachment; filename="notes.exe"',
    ]) {
      expect(exportFilenameFrom(header)).toBe("member-notes.txt");
    }
  });
});

describe("exportResponseOutcome", () => {
  const FILE = 'attachment; filename="member-notes-c-m-2026-10-18.txt"';
  it("only a 200 attachment is the file", () => {
    expect(exportResponseOutcome({ status: 200, contentDisposition: FILE })).toBe("file");
  });

  // Regression (review): the questionnaire gate redirects; a followed
  // redirect is a 200 HTML page that was saved as the notes file and toasted
  // as "Notes exported".
  it("a redirect, or a 200 page that is not an attachment, is refused", () => {
    expect(exportResponseOutcome({ status: 0, contentDisposition: null })).toBe("refused");
    expect(exportResponseOutcome({ status: 307, contentDisposition: null })).toBe("refused");
    expect(exportResponseOutcome({ status: 200, contentDisposition: null })).toBe("refused");
    expect(exportResponseOutcome({ status: 200, contentDisposition: "inline" })).toBe("refused");
  });

  it("a 404 is refused; a 503 is unavailable (its sentence is shown)", () => {
    expect(exportResponseOutcome({ status: 404, contentDisposition: null })).toBe("refused");
    expect(exportResponseOutcome({ status: 503, contentDisposition: null })).toBe("unavailable");
  });
});
