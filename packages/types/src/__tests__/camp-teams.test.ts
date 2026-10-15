import { describe, expect, it } from "vitest";
import {
  AddTeamMembersInput,
  CreateTeamInput,
  SetTeamChatTimerInput,
  TEAM_ADD_MAX,
  TEAM_NAME_MAX,
  TeamSelfInput,
  UpdateTeamInput,
} from "../camp-teams";
import { NotificationKind } from "../notifications";

// Camp teams inputs (docs/camp-teams-spec.md): every one names a camp by slug
// plus ids and text, and none can carry a role.

const ID = "77777777-0000-4000-8000-000000000001";

describe("camp team inputs", () => {
  it("creates with defaults: open, no description, no leads", () => {
    const parsed = CreateTeamInput.parse({
      slug: "mad-hatters",
      name: " Kitchen ",
    });
    expect(parsed).toEqual({
      slug: "mad-hatters",
      name: "Kitchen",
      description: null,
      joinMode: "open",
      leadUserIds: [],
    });
  });

  it("refuses an unknown join mode, a long name and a smuggled role", () => {
    expect(
      CreateTeamInput.safeParse({ slug: "s", name: "K", joinMode: "anyone" })
        .success,
    ).toBe(false);
    expect(
      CreateTeamInput.safeParse({
        slug: "s",
        name: "x".repeat(TEAM_NAME_MAX + 1),
      }).success,
    ).toBe(false);
    expect(
      TeamSelfInput.safeParse({ slug: "s", teamId: ID, role: "lead" }).success,
    ).toBe(false);
  });

  it("keeps a description as written, and blank as none", () => {
    const base = { slug: "s", teamId: ID, name: "K", joinMode: "leads_add" };
    expect(
      UpdateTeamInput.parse({ ...base, description: "## Before your shift" })
        .description,
    ).toBe("## Before your shift");
    expect(
      UpdateTeamInput.parse({ ...base, description: "   " }).description,
    ).toBeNull();
  });

  it("bounds an add and the timer vocabulary", () => {
    expect(
      AddTeamMembersInput.safeParse({ slug: "s", teamId: ID, userIds: [] })
        .success,
    ).toBe(false);
    expect(
      AddTeamMembersInput.safeParse({
        slug: "s",
        teamId: ID,
        userIds: Array.from({ length: TEAM_ADD_MAX + 1 }, () => ID),
      }).success,
    ).toBe(false);
    expect(
      SetTeamChatTimerInput.safeParse({ slug: "s", teamId: ID, timer: "1y" })
        .success,
    ).toBe(false);
  });

  it("`team` is a notification kind", () => {
    expect(NotificationKind.options).toContain("team");
  });
});
