import { describe, expect, it } from "vitest";
import { currentMeetingNotes } from "../meeting-notes-state";

// Reopening the notes editor before the post-"Done" refresh lands started it
// from the pre-edit text at the post-save version, so the first keystroke
// replaced the notes just saved. The page now prefers its own last save until
// a render at least that new arrives.

describe("currentMeetingNotes", () => {
  const rendered = { notesMd: "old notes", version: 3 };

  it("prefers the text saved here while the render is older than it", () => {
    expect(
      currentMeetingNotes(rendered, { notesMd: "new notes", version: 4 }),
    ).toBe("new notes");
  });

  it("takes the render once it is as new as the save, or newer", () => {
    expect(
      currentMeetingNotes(
        { notesMd: "new notes", version: 4 },
        { notesMd: "new notes", version: 4 },
      ),
    ).toBe("new notes");
    // Someone else saved after us and the refresh brought theirs.
    expect(
      currentMeetingNotes(
        { notesMd: "their notes", version: 6 },
        { notesMd: "new notes", version: 4 },
      ),
    ).toBe("their notes");
  });

  it("is the render when nothing was saved here", () => {
    expect(currentMeetingNotes(rendered, null)).toBe("old notes");
  });
});
