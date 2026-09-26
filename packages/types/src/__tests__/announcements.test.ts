import { describe, it, expect } from "vitest";
import {
  CampAnnouncementDraftInput,
  MeetingUrl,
  PostAnnouncementsScope,
  ProjectPermissions,
} from "../index";

// Camp announcement boundary shapes (epic #56).

describe("MeetingUrl — just an https link", () => {
  it("accepts an https URL", () => {
    expect(
      MeetingUrl.safeParse("https://meet.example.com/abc-def").success,
    ).toBe(true);
  });

  it.each([
    ["plain http", "http://meet.example.com/abc"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["no scheme", "meet.example.com/abc"],
    ["not a url", "tomorrow at the dome"],
  ])("refuses %s", (_label, value) => {
    expect(MeetingUrl.safeParse(value).success).toBe(false);
  });
});

describe("CampAnnouncementDraftInput", () => {
  const base = {
    slug: "mad-hatters",
    title: "Build week starts Friday",
    bodyMd: "Bring gloves.",
    mode: "everyone" as const,
  };

  it("normalises the empty optional fields to null", () => {
    const parsed = CampAnnouncementDraftInput.parse({
      ...base,
      meetingUrl: "",
      sendAt: "",
    });
    expect(parsed.meetingUrl).toBeNull();
    expect(parsed.sendAt).toBeNull();
    expect(parsed.presentation).toBe("feed");
    expect(parsed.pinOnPublish).toBe(false);
  });

  it("refuses a non-https meeting link at the boundary", () => {
    expect(
      CampAnnouncementDraftInput.safeParse({
        ...base,
        meetingUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });

  it("refuses a presentation outside the enum", () => {
    expect(
      CampAnnouncementDraftInput.safeParse({ ...base, presentation: "popup" })
        .success,
    ).toBe(false);
  });

  it("keeps a valid ISO send time", () => {
    const parsed = CampAnnouncementDraftInput.parse({
      ...base,
      sendAt: "2027-04-20T08:00:00.000Z",
    });
    expect(parsed.sendAt).toBe("2027-04-20T08:00:00.000Z");
  });
});

describe("post_announcements in the stored permissions object", () => {
  it("round-trips its scope through ProjectPermissions", () => {
    const stored = ProjectPermissions.parse({
      post_announcements: { audienceRoles: ["r1"], mayRequireAck: true },
    });
    expect(stored.post_announcements).toEqual({
      audienceRoles: ["r1"],
      mayRequireAck: true,
    });
  });

  it("requires mayRequireAck to be stated", () => {
    expect(
      PostAnnouncementsScope.safeParse({ audienceRoles: "all" }).success,
    ).toBe(false);
  });
});
