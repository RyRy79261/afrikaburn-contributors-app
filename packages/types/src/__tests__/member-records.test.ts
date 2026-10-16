import { describe, expect, it } from "vitest";
import {
  AddMemberNoteInput,
  DeleteMemberNoteInput,
  DismissDuplicateInput,
  EditMemberNoteInput,
  MEMBER_NOTE_MAX,
  PROJECT_PERMISSION_LABELS,
  ProjectPermissionKey,
  ProjectPermissions,
} from "../index";

const ID = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";

describe("member_notes privilege", () => {
  it("is a project permission with a label and a boolean value", () => {
    expect(ProjectPermissionKey.options).toContain("member_notes");
    expect(PROJECT_PERMISSION_LABELS.member_notes).toBe(
      "Keep private member notes",
    );
    expect(ProjectPermissions.safeParse({ member_notes: true }).success).toBe(
      true,
    );
    expect(ProjectPermissions.safeParse({ member_notes: "yes" }).success).toBe(
      false,
    );
  });
});

describe("note inputs", () => {
  it("trim the body and refuse an empty one", () => {
    const parsed = AddMemberNoteInput.parse({
      slug: "mad-hatters",
      subjectUserId: ID,
      body: "  Needs a lift from Cape Town.  ",
    });
    expect(parsed.body).toBe("Needs a lift from Cape Town.");
    expect(
      AddMemberNoteInput.safeParse({
        slug: "mad-hatters",
        subjectUserId: ID,
        body: "   ",
      }).success,
    ).toBe(false);
  });

  it("cap the body at 2 000 characters", () => {
    expect(MEMBER_NOTE_MAX).toBe(2000);
    const at = "x".repeat(MEMBER_NOTE_MAX);
    expect(
      EditMemberNoteInput.safeParse({ slug: "s", noteId: ID, body: at }).success,
    ).toBe(true);
    expect(
      EditMemberNoteInput.safeParse({ slug: "s", noteId: ID, body: `${at}x` })
        .success,
    ).toBe(false);
  });

  it("take ids, never an author or a camp id from the payload", () => {
    expect(
      AddMemberNoteInput.safeParse({
        slug: "s",
        subjectUserId: ID,
        body: "hi",
        authorUserId: ID2,
      }).success,
    ).toBe(false);
    expect(
      DeleteMemberNoteInput.safeParse({ slug: "s", noteId: "nope" }).success,
    ).toBe(false);
    expect(DeleteMemberNoteInput.safeParse({ slug: "s", noteId: ID }).success).toBe(
      true,
    );
  });
});

describe("dismissing a duplicate", () => {
  it("names two different people", () => {
    expect(
      DismissDuplicateInput.safeParse({ slug: "s", userIds: [ID, ID2] }).success,
    ).toBe(true);
    expect(
      DismissDuplicateInput.safeParse({ slug: "s", userIds: [ID, ID] }).success,
    ).toBe(false);
    expect(
      DismissDuplicateInput.safeParse({
        slug: "s",
        userIds: [ID, ID.toUpperCase()],
      }).success,
    ).toBe(false);
    expect(
      DismissDuplicateInput.safeParse({ slug: "s", userIds: [ID] }).success,
    ).toBe(false);
  });
});
