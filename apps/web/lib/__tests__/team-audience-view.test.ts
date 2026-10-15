import { describe, expect, it } from "vitest";
import {
  chosenTeamNames,
  preselectedTeamIds,
  teamLeadNotice,
  teamMemberCount,
  teamIdsByUser,
  teamReachPhrase,
} from "../team-audience-view";

const KITCHEN = "11111111-1111-4111-8111-111111111111";
const BUILD = "22222222-2222-4222-8222-222222222222";
const SOUND = "33333333-3333-4333-8333-333333333333";
const teams = [
  { id: KITCHEN, name: "Kitchen" },
  { id: BUILD, name: "Build & strike" },
  { id: SOUND, name: "Sound" },
];

describe("teamReachPhrase", () => {
  it("names one team as 'the X team'", () => {
    expect(teamReachPhrase(["Kitchen"])).toBe("the Kitchen team");
  });
  it("does not double a name that already ends in team", () => {
    expect(teamReachPhrase(["Build team"])).toBe("the Build team");
  });
  it("joins two and three teams", () => {
    expect(teamReachPhrase(["Kitchen", "Build & strike"])).toBe(
      "Kitchen and Build & strike",
    );
    expect(teamReachPhrase(["Kitchen", "Sound", "Tea bar"])).toBe(
      "Kitchen, Sound and Tea bar",
    );
  });
  it("is empty with nothing chosen", () => {
    expect(teamReachPhrase([])).toBe("");
  });
});

describe("teamLeadNotice", () => {
  it("words the announcement form's notice (frame knWLt)", () => {
    expect(teamLeadNotice(["Kitchen"], "announcement")).toBe(
      "You lead Kitchen, so you can send to it. Everyone in this camp and By role need the “Post announcements” privilege.",
    );
  });
  it("words the meeting form's notice, plural (frame bIVG2)", () => {
    expect(teamLeadNotice(["Kitchen", "Sound"], "meeting")).toBe(
      "You lead Kitchen and Sound, so you can schedule for them. Whole camp and Chosen roles need the “Schedule meetings” privilege.",
    );
  });
});

describe("chosenTeamNames", () => {
  it("keeps the picker's order, not the click order", () => {
    expect(chosenTeamNames(teams, [SOUND, KITCHEN])).toEqual([
      "Kitchen",
      "Sound",
    ]);
  });
  it("skips an id the picker does not offer", () => {
    expect(chosenTeamNames(teams, ["nope", BUILD])).toEqual(["Build & strike"]);
  });
});

describe("teamMemberCount", () => {
  const members = [
    { teamIds: [KITCHEN] },
    { teamIds: [KITCHEN, BUILD] },
    { teamIds: [SOUND] },
    {},
  ];
  it("counts each member on any chosen team once", () => {
    expect(teamMemberCount(members, [KITCHEN, BUILD])).toBe(2);
  });
  it("counts members of the one chosen team only", () => {
    expect(teamMemberCount(members, [SOUND])).toBe(1);
  });
  it("is zero with no team chosen", () => {
    expect(teamMemberCount(members, [])).toBe(0);
  });
});

describe("preselectedTeamIds", () => {
  it("chooses an offered team", () => {
    expect(preselectedTeamIds(BUILD, teams)).toEqual([BUILD]);
  });
  it("ignores a team the viewer is not offered", () => {
    expect(
      preselectedTeamIds("44444444-4444-4444-8444-444444444444", teams),
    ).toEqual([]);
  });
  it("ignores a malformed, repeated or missing parameter", () => {
    expect(preselectedTeamIds("kitchen", teams)).toEqual([]);
    expect(preselectedTeamIds([KITCHEN, BUILD], teams)).toEqual([]);
    expect(preselectedTeamIds(undefined, teams)).toEqual([]);
  });
});

describe("teamIdsByUser", () => {
  it("groups each person's seats", () => {
    const map = teamIdsByUser([
      { teamId: KITCHEN, userId: "u1" },
      { teamId: BUILD, userId: "u1" },
      { teamId: SOUND, userId: "u2" },
    ]);
    expect(map.get("u1")).toEqual([KITCHEN, BUILD]);
    expect(map.get("u2")).toEqual([SOUND]);
    expect(map.get("u3")).toBeUndefined();
  });
});
