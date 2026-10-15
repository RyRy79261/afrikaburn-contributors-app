import { describe, expect, it } from "vitest";
import {
  OfficerKey,
  OrgOutboundSelector,
  ProjectAudienceMode,
  type AudienceSpec,
} from "@quagga/types";
import { bulletinAudienceChip } from "../bulletin-audience-chip";

// The reader's audience chip on /bulletins/[id]. A by-team announcement names
// its teams (docs/team-audiences-spec.md §Surfaces), never a generic
// "Your team" — with two teams the reader could not tell which one reached them.

const CAMP = "11111111-0000-4000-8000-00000000000a";
const KITCHEN = "7e7e7e7e-0000-4000-8000-000000000001";
const BUILD = "7e7e7e7e-0000-4000-8000-000000000002";
const SOUND = "7e7e7e7e-0000-4000-8000-000000000003";
const GONE = "7e7e7e7e-0000-4000-8000-000000000009";
const TEAMS = [
  { id: KITCHEN, name: "Kitchen" },
  { id: BUILD, name: "Build crew" },
  { id: SOUND, name: "Sound" },
];

const byTeam = (teamIds: string[]): AudienceSpec => ({
  kind: "project",
  groupId: CAMP,
  mode: ProjectAudienceMode.enum.teams,
  roleIds: [],
  teamIds,
});

describe("bulletinAudienceChip", () => {
  it("names one team, and joins several with +, in the stored order", () => {
    expect(bulletinAudienceChip(byTeam([KITCHEN]), TEAMS)).toBe(
      "Kitchen team",
    );
    expect(bulletinAudienceChip(byTeam([KITCHEN, BUILD]), TEAMS)).toBe(
      "Kitchen + Build crew",
    );
  });

  it("leaves out a team deleted since, and says so when none is left", () => {
    expect(bulletinAudienceChip(byTeam([GONE, SOUND]), TEAMS)).toBe(
      "Sound team",
    );
    expect(bulletinAudienceChip(byTeam([GONE]), TEAMS)).toBe("Deleted team");
  });

  it("keeps the whole-camp and by-role chip as before", () => {
    for (const mode of [
      ProjectAudienceMode.enum.everyone,
      ProjectAudienceMode.enum.roles,
    ]) {
      expect(
        bulletinAudienceChip(
          { kind: "project", groupId: CAMP, mode, roleIds: [] },
          TEAMS,
        ),
      ).toBe("Your camp");
    }
  });

  it("labels the org shapes and hides org-internal", () => {
    expect(
      bulletinAudienceChip({
        kind: "org_outbound",
        selectors: [OrgOutboundSelector.enum.camp_leads],
      }),
    ).toBe("Theme camp leads");
    expect(
      bulletinAudienceChip({
        kind: "org_officer",
        officerKeys: [OfficerKey.enum.sound_officer],
      }),
    ).toBe("All registered Sound Officers");
    expect(bulletinAudienceChip({ kind: "org_suppliers" })).toBe("Suppliers");
    expect(bulletinAudienceChip({ kind: "org_internal" })).toBeNull();
    expect(bulletinAudienceChip(null)).toBeNull();
  });
});
