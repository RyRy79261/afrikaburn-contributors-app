import { describe, expect, it } from "vitest";
import {
  duplicateHintSentence,
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
