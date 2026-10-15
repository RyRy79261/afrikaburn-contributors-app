import { describe, expect, it } from "vitest";
import {
  CancelMeetingInput,
  CreateMeetingInput,
  isMeetingDate,
  MeetingAudience,
  NotificationKind,
  PROJECT_PERMISSION_LABELS,
  ProjectPermissionKey,
  ProjectPermissions,
  SaveMeetingNotesInput,
  SetMeetingAttendanceInput,
  UpdateMeetingInput,
} from "../index";

const ID = "aaaaaaaa-0000-4000-8000-000000000001";
const CAMP = "11111111-0000-4000-8000-00000000000a";

const valid = {
  slug: "mad-hatters",
  title: "Camp call: transport and build crew",
  date: "2027-03-21",
  startMinute: 19 * 60,
  durationMinutes: 60,
  location: "",
  videoLink: "https://meet.example.com/mad-hatters",
  mode: "everyone" as const,
  roleIds: [],
  agendaMd: "1. Transport",
};

describe("CreateMeetingInput", () => {
  it("accepts the G3 form and turns empty strings into null", () => {
    const parsed = CreateMeetingInput.parse(valid);
    expect(parsed.location).toBeNull();
    expect(parsed.videoLink).toBe("https://meet.example.com/mad-hatters");
    expect(
      CreateMeetingInput.parse({ ...valid, videoLink: "" }).videoLink,
    ).toBeNull();
  });

  it("refuses every link that is not https", () => {
    for (const videoLink of [
      "http://meet.example.com/x",
      "javascript:alert(1)",
      "data:text/html,hi",
      "meet.example.com/x",
      "ftp://meet.example.com",
    ]) {
      expect(
        CreateMeetingInput.safeParse({ ...valid, videoLink }).success,
        videoLink,
      ).toBe(false);
    }
  });

  it("stores the scheme lower-case so the DB CHECK (like 'https://%') holds", () => {
    const parsed = CreateMeetingInput.safeParse({
      ...valid,
      videoLink: "HTTPS://Meet.Example.com/Mad",
    });
    // Zod's URL check accepts the upper-case scheme; the transform is what
    // keeps it out of the database.
    expect(parsed.success && parsed.data.videoLink).toBe(
      "https://Meet.Example.com/Mad",
    );
  });

  it("bounds the time and length like the DB CHECKs", () => {
    expect(
      CreateMeetingInput.safeParse({ ...valid, startMinute: 1440 }).success,
    ).toBe(false);
    expect(
      CreateMeetingInput.safeParse({ ...valid, startMinute: -1 }).success,
    ).toBe(false);
    expect(
      CreateMeetingInput.safeParse({ ...valid, startMinute: 1439 }).success,
    ).toBe(true);
    expect(
      CreateMeetingInput.safeParse({ ...valid, durationMinutes: 0 }).success,
    ).toBe(false);
    expect(
      CreateMeetingInput.safeParse({ ...valid, durationMinutes: 1441 }).success,
    ).toBe(false);
    expect(
      CreateMeetingInput.safeParse({ ...valid, durationMinutes: 1440 }).success,
    ).toBe(true);
  });

  it("refuses rolled-over and malformed dates", () => {
    expect(isMeetingDate("2027-02-29")).toBe(false);
    expect(isMeetingDate("2028-02-29")).toBe(true);
    expect(isMeetingDate("2027-13-01")).toBe(false);
    expect(isMeetingDate("21 March")).toBe(false);
    expect(isMeetingDate("1999-01-01")).toBe(false);
    expect(
      CreateMeetingInput.safeParse({ ...valid, date: "2027-04-31" }).success,
    ).toBe(false);
  });

  it("is strict: no camp id, author or audience object from the payload", () => {
    expect(
      CreateMeetingInput.safeParse({ ...valid, groupId: CAMP }).success,
    ).toBe(false);
    expect(
      CreateMeetingInput.safeParse({ ...valid, createdByUserId: ID }).success,
    ).toBe(false);
  });

  it("needs a title and role ids that are uuids", () => {
    expect(
      CreateMeetingInput.safeParse({ ...valid, title: "   " }).success,
    ).toBe(false);
    expect(
      CreateMeetingInput.safeParse({
        ...valid,
        mode: "roles",
        roleIds: ["kitchen"],
      }).success,
    ).toBe(false);
  });
});

describe("the other meeting inputs", () => {
  it("edits and cancels name the version they were read at", () => {
    expect(
      UpdateMeetingInput.safeParse({ ...valid, id: ID, expectedVersion: 3 })
        .success,
    ).toBe(true);
    expect(UpdateMeetingInput.safeParse({ ...valid, id: ID }).success).toBe(
      false,
    );
    expect(
      CancelMeetingInput.safeParse({ slug: "s", id: ID, expectedVersion: 0 })
        .success,
    ).toBe(false);
    expect(
      SaveMeetingNotesInput.safeParse({
        slug: "s",
        id: ID,
        expectedVersion: 1,
        notesMd: "",
      }).success,
    ).toBe(true);
    expect(
      SetMeetingAttendanceInput.safeParse({
        slug: "s",
        id: ID,
        userId: ID,
        came: true,
      }).success,
    ).toBe(true);
    expect(
      SetMeetingAttendanceInput.safeParse({
        slug: "s",
        id: ID,
        userId: "me",
        came: true,
      }).success,
    ).toBe(false);
  });

  it("the stored audience has no narrowing filters", () => {
    const base = {
      kind: "project",
      groupId: CAMP,
      mode: "everyone",
      roleIds: [],
    };
    expect(MeetingAudience.safeParse(base).success).toBe(true);
    expect(
      MeetingAudience.safeParse({ ...base, tenure: ["new"] }).success,
    ).toBe(false);
    expect(
      MeetingAudience.safeParse({ ...base, kind: "org_internal" }).success,
    ).toBe(false);
  });
});

describe("schedule_meetings and the meeting notice kind", () => {
  it("is a boolean project permission with a label", () => {
    expect(ProjectPermissionKey.options).toContain("schedule_meetings");
    expect(PROJECT_PERMISSION_LABELS.schedule_meetings).toBe(
      "Schedule meetings",
    );
    expect(
      ProjectPermissions.safeParse({ schedule_meetings: true }).success,
    ).toBe(true);
    expect(
      ProjectPermissions.safeParse({ schedule_meetings: "yes" }).success,
    ).toBe(false);
  });

  it("meeting is a notification kind", () => {
    expect(NotificationKind.options).toContain("meeting");
  });
});
