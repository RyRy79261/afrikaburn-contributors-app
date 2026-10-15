import { describe, expect, it } from "vitest";
import {
  AudienceSpecWithoutTeams,
  BulletinComposeInput,
  CampAnnouncementDraftInput,
  CreateMeetingInput,
  MeetingAudience,
  MembershipRole,
  QuestionnaireActivationInput,
  type ProjectAudience,
  type ProjectPermissions,
} from "@quagga/types";
import {
  canComposeCampAnnouncements,
  canPinCampAnnouncement,
  canSendCampAnnouncement,
  resolveCampAnnouncementRecipients,
  type AnnouncementTeamContext,
  type CampAnnouncementAudienceContext,
} from "../announcements";
import { resolveAudience, type AudienceContext } from "../audience";
import {
  canEditMeeting,
  canEditMeetingNotes,
  canScheduleAnyMeeting,
  canViewMeeting,
  decideMeetingAudience,
  isInMeetingAudience,
  meetingRefusalMessage,
  meetingTeamReach,
  resolveMeetingRecipients,
  type MeetingViewer,
} from "../camp-meetings";
import type { PermissionMembership } from "../project-permissions";
import {
  canAuthorAudience,
  canAuthorProjectQuestionnaire,
  projectAudienceTargetRoleIds,
} from "../questionnaire-authz";
import {
  audienceTeamIds,
  decideTeamAudienceTargets,
  hasCampWideAnnouncementReach,
  teamAudienceLabel,
  teamAudienceRefusalMessage,
  teamNamesFor,
  teamsWithinReach,
  type AudienceTeamMember,
} from "../team-audience";

// Team audiences (docs/team-audiences-spec.md, Ryan 15 Oct 2026) — the pure
// rules. Structural roles come from MembershipRole and privileges by their
// real keys (AGENTS.md "Verification"). The store tests and the persona suite
// cover the locked reads; nothing here proves a query.

const LEAD = MembershipRole.enum.lead;
const ADMIN = MembershipRole.enum.admin;
const MEMBER = MembershipRole.enum.member;

const CAMP = "11111111-0000-4000-8000-00000000000a";
const OTHER_CAMP = "11111111-0000-4000-8000-00000000000b";
const BASELINE = "0b0b0b0b-0000-4000-8000-000000000000";
const KITCHEN_ROLE = "0b0b0b0b-0000-4000-8000-000000000001";

const KITCHEN = "7e7e7e7e-0000-4000-8000-000000000001";
const BUILD = "7e7e7e7e-0000-4000-8000-000000000002";
const ARCHIVED = "7e7e7e7e-0000-4000-8000-000000000003";
const DELETED = "7e7e7e7e-0000-4000-8000-000000000004";
const FOREIGN = "7e7e7e7e-0000-4000-8000-000000000099";

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // camp lead
const THANDI = "aaaaaaaa-0000-4000-8000-000000000002"; // kitchen team lead
const JABU = "aaaaaaaa-0000-4000-8000-000000000003"; // kitchen member
const REN = "aaaaaaaa-0000-4000-8000-000000000004"; // build member
const ZOE = "aaaaaaaa-0000-4000-8000-000000000005"; // archived-team member
const SAM = "aaaaaaaa-0000-4000-8000-000000000006"; // no team
const GONE = "aaaaaaaa-0000-4000-8000-000000000007"; // former member

const LIVE = new Set([KITCHEN, BUILD]);

const perms = (
  role: MembershipRole,
  extra: ProjectPermissions = {},
): PermissionMembership => ({
  structuralRole: role,
  rolePermissions: [{}, extra],
});

const ALL_POSTER: ProjectPermissions = {
  post_announcements: { audienceRoles: "all", mayRequireAck: true },
};
const SCOPED_POSTER: ProjectPermissions = {
  post_announcements: { audienceRoles: [KITCHEN_ROLE], mayRequireAck: false },
};
const SCOPED_ACK_POSTER: ProjectPermissions = {
  post_announcements: { audienceRoles: [KITCHEN_ROLE], mayRequireAck: true },
};

function teams(...teamIds: string[]): ProjectAudience {
  return {
    kind: "project",
    groupId: CAMP,
    mode: "teams",
    roleIds: [],
    teamIds,
  };
}

const kitchenLead: AnnouncementTeamContext = {
  liveTeamIds: LIVE,
  ledTeamIds: new Set([KITCHEN]),
};
const leadsNothing: AnnouncementTeamContext = {
  liveTeamIds: LIVE,
  ledTeamIds: new Set(),
};

function send(
  m: PermissionMembership,
  audience: ProjectAudience,
  team: AnnouncementTeamContext | undefined,
  presentation: "feed" | "acknowledge" = "feed",
) {
  return canSendCampAnnouncement(m, {
    groupId: CAMP,
    audience,
    presentation,
    baselineRoleId: BASELINE,
    campRoleIds: new Set([BASELINE, KITCHEN_ROLE]),
    teams: team,
  });
}

// Every seat, the way the stores load them: by team, with the team's camp.
const SEATS: AudienceTeamMember[] = [
  { teamId: KITCHEN, groupId: CAMP, userId: THANDI },
  { teamId: KITCHEN, groupId: CAMP, userId: JABU },
  { teamId: BUILD, groupId: CAMP, userId: REN },
  { teamId: ARCHIVED, groupId: CAMP, userId: ZOE },
  // A former member's seat that survived (the resolver must still drop it).
  { teamId: KITCHEN, groupId: CAMP, userId: GONE },
  // Another camp's team with the same person on it.
  { teamId: FOREIGN, groupId: OTHER_CAMP, userId: SAM },
];

const MEMBERSHIPS = [
  { membershipId: "m-alice", userId: ALICE, groupId: CAMP, role: LEAD },
  { membershipId: "m-thandi", userId: THANDI, groupId: CAMP, role: MEMBER },
  { membershipId: "m-jabu", userId: JABU, groupId: CAMP, role: MEMBER },
  { membershipId: "m-ren", userId: REN, groupId: CAMP, role: MEMBER },
  { membershipId: "m-zoe", userId: ZOE, groupId: CAMP, role: MEMBER },
  { membershipId: "m-sam", userId: SAM, groupId: CAMP, role: MEMBER },
];

function ctx(over: Partial<AudienceContext> = {}): AudienceContext {
  return {
    editionId: "e",
    orgGroupId: "org",
    memberships: MEMBERSHIPS,
    groups: [],
    registrations: [],
    bios: [],
    roleAssignments: [],
    projectRoles: [],
    teamMembers: SEATS,
    ...over,
  };
}

describe("the shapes", () => {
  it("adds mode teams with teamIds; rows written before keep their meaning", () => {
    const old = { kind: "project", groupId: CAMP, mode: "roles", roleIds: [] };
    expect(MeetingAudience.safeParse(old).success).toBe(true);
    expect(
      MeetingAudience.safeParse({ ...old, mode: "teams", teamIds: [KITCHEN] })
        .success,
    ).toBe(true);
    expect(audienceTeamIds(old as ProjectAudience)).toEqual([]);
    // teamIds on a non-teams audience are ignored.
    expect(audienceTeamIds({ ...teams(KITCHEN), mode: "everyone" })).toEqual(
      [],
    );
  });

  it("the announcement and meeting inputs take teams", () => {
    const draft = CampAnnouncementDraftInput.parse({
      slug: "mad-hatters",
      title: "Monday prep",
      bodyMd: "10:00 at the kitchen tent.",
      mode: "teams",
      teamIds: [KITCHEN],
    });
    expect(draft.teamIds).toEqual([KITCHEN]);
    const meeting = CreateMeetingInput.parse({
      slug: "mad-hatters",
      title: "Kitchen team: menu",
      date: "2027-04-07",
      startMinute: 18 * 60 + 30,
      durationMinutes: 60,
      mode: "teams",
      teamIds: [KITCHEN],
    });
    expect(meeting.teamIds).toEqual([KITCHEN]);
  });

  it("questionnaires and org bulletins refuse a team audience at the boundary", () => {
    const spec = teams(KITCHEN);
    expect(AudienceSpecWithoutTeams.safeParse(spec).success).toBe(false);
    expect(
      AudienceSpecWithoutTeams.safeParse({ ...spec, mode: "roles" }).success,
    ).toBe(true);
    expect(
      QuestionnaireActivationInput.safeParse({
        questionnaireKey: "q",
        version: "1",
        title: "T",
        editionId: "e",
        audience: spec,
      }).success,
    ).toBe(false);
    expect(
      QuestionnaireActivationInput.safeParse({
        questionnaireKey: "q",
        version: "1",
        title: "T",
        editionId: "e",
        audience: { ...spec, mode: "everyone" },
      }).success,
    ).toBe(true);
    expect(
      BulletinComposeInput.safeParse({
        title: "T",
        bodyMd: "B",
        audience: spec,
      }).success,
    ).toBe(false);
  });

  it("the questionnaire predicates refuse teams — even for a camp lead", () => {
    expect(
      canAuthorProjectQuestionnaire(
        perms(LEAD),
        teams(KITCHEN),
        false,
        BASELINE,
      ),
    ).toBe(false);
    expect(
      canAuthorProjectQuestionnaire(
        perms(LEAD),
        { ...teams(KITCHEN), mode: "everyone" },
        false,
        BASELINE,
      ),
    ).toBe(true);
    expect(
      canAuthorAudience([{ groupId: CAMP, role: LEAD }], teams(KITCHEN), "org"),
    ).toBe(false);
    expect(
      canAuthorAudience(
        [{ groupId: CAMP, role: LEAD }],
        { ...teams(KITCHEN), mode: "everyone" },
        "org",
      ),
    ).toBe(true);
    // A team audience is never "the baseline" to a role scope.
    expect(projectAudienceTargetRoleIds(teams(KITCHEN), BASELINE)).toEqual([]);
  });
});

describe("who is reached", () => {
  it("current members on any chosen team, and nobody else", () => {
    expect(resolveAudience(teams(KITCHEN), ctx())).toEqual(
      [JABU, THANDI].sort(),
    );
    expect(resolveAudience(teams(KITCHEN, BUILD), ctx())).toEqual(
      [JABU, REN, THANDI].sort(),
    );
  });

  it("an archived team still resolves to its members; a deleted one to nobody", () => {
    expect(resolveAudience(teams(ARCHIVED), ctx())).toEqual([ZOE]);
    expect(resolveAudience(teams(DELETED), ctx())).toEqual([]);
  });

  it("never a former member, never another camp's team", () => {
    expect(resolveAudience(teams(KITCHEN), ctx())).not.toContain(GONE);
    // SAM is on OTHER_CAMP's team; naming that id from this camp reaches nobody.
    expect(resolveAudience(teams(FOREIGN), ctx())).toEqual([]);
  });

  it("a caller that loads no seats (questionnaires) reaches nobody, never everyone", () => {
    expect(
      resolveAudience(teams(KITCHEN), ctx({ teamMembers: undefined })),
    ).toEqual([]);
    expect(resolveAudience(teams(), ctx())).toEqual([]);
  });

  it("announcement recipients: the team, never the author", () => {
    const actx: CampAnnouncementAudienceContext = {
      groupId: CAMP,
      memberships: MEMBERSHIPS,
      roleAssignments: [],
      projectRoles: [],
      teamMembers: SEATS,
    };
    expect(
      resolveCampAnnouncementRecipients(teams(KITCHEN), actx, THANDI),
    ).toEqual([JABU]);
  });
});

describe("who may send an announcement to a team", () => {
  it("a camp lead or co-lead may pick any live team", () => {
    expect(send(perms(LEAD), teams(KITCHEN, BUILD), leadsNothing)).toBe(true);
    expect(send(perms(ADMIN), teams(BUILD), leadsNothing, "acknowledge")).toBe(
      true,
    );
  });

  it("a holder of camp-wide post_announcements may pick any live team", () => {
    expect(send(perms(MEMBER, ALL_POSTER), teams(BUILD), leadsNothing)).toBe(
      true,
    );
    expect(hasCampWideAnnouncementReach(perms(MEMBER, ALL_POSTER))).toBe(true);
  });

  it("a team lead without the permission: their own team only", () => {
    const m = perms(MEMBER);
    expect(send(m, teams(KITCHEN), kitchenLead)).toBe(true);
    expect(send(m, teams(BUILD), kitchenLead)).toBe(false);
    expect(send(m, teams(KITCHEN, BUILD), kitchenLead)).toBe(false);
  });

  it("a team lead cannot reach the whole camp or roles that way", () => {
    const m = perms(MEMBER);
    expect(send(m, { ...teams(), mode: "everyone" }, kitchenLead)).toBe(false);
    expect(
      send(
        m,
        {
          kind: "project",
          groupId: CAMP,
          mode: "roles",
          roleIds: [KITCHEN_ROLE],
        },
        kitchenLead,
      ),
    ).toBe(false);
  });

  it("a team lead may open the composer; a member who leads nothing may not", () => {
    expect(canComposeCampAnnouncements(perms(MEMBER), new Set([KITCHEN]))).toBe(
      true,
    );
    expect(canComposeCampAnnouncements(perms(MEMBER), new Set())).toBe(false);
    expect(
      canComposeCampAnnouncements(perms(MEMBER, SCOPED_POSTER), new Set()),
    ).toBe(true);
  });

  it("a member who leads nothing and holds nothing is refused", () => {
    expect(send(perms(MEMBER), teams(KITCHEN), leadsNothing)).toBe(false);
  });

  it("a role-scoped poster is not camp-wide: own teams only", () => {
    const m = perms(MEMBER, SCOPED_POSTER);
    expect(hasCampWideAnnouncementReach(m)).toBe(false);
    expect(send(m, teams(BUILD), kitchenLead)).toBe(false);
    expect(send(m, teams(KITCHEN), kitchenLead)).toBe(true);
  });

  it("must-acknowledge needs the backstop or mayRequireAck", () => {
    expect(
      send(perms(MEMBER), teams(KITCHEN), kitchenLead, "acknowledge"),
    ).toBe(false);
    expect(
      send(
        perms(MEMBER, SCOPED_ACK_POSTER),
        teams(KITCHEN),
        kitchenLead,
        "acknowledge",
      ),
    ).toBe(true);
  });

  it("an archived, deleted or another camp's team is refused for a new send", () => {
    for (const id of [ARCHIVED, DELETED, FOREIGN]) {
      expect(send(perms(LEAD), teams(id), leadsNothing)).toBe(false);
    }
  });

  it("no teams, or no team facts loaded, is refused", () => {
    expect(send(perms(LEAD), teams(), leadsNothing)).toBe(false);
    expect(send(perms(LEAD), teams(KITCHEN), undefined)).toBe(false);
  });

  it("pinning follows posting — and survives the team's archive or deletion", () => {
    const pin = (
      m: PermissionMembership,
      a: ProjectAudience,
      t = leadsNothing,
    ) =>
      canPinCampAnnouncement(m, {
        groupId: CAMP,
        audience: a,
        baselineRoleId: BASELINE,
        campRoleIds: new Set([BASELINE]),
        teams: t,
      });
    expect(pin(perms(LEAD), teams(DELETED))).toBe(true);
    expect(pin(perms(MEMBER), teams(KITCHEN), kitchenLead)).toBe(true);
    expect(pin(perms(MEMBER), teams(BUILD), kitchenLead)).toBe(false);
    expect(pin(perms(MEMBER, ALL_POSTER), teams(ARCHIVED))).toBe(true);
    expect(pin(perms(LEAD), { ...teams(KITCHEN), groupId: OTHER_CAMP })).toBe(
      false,
    );
    expect(pin(perms(LEAD), teams())).toBe(false);
  });
});

describe("deciding the teams picked", () => {
  const camp = { liveTeamIds: LIVE };
  const campWide = { campWide: true, ledTeamIds: new Set<string>() };

  it("de-duplicates and sorts", () => {
    expect(
      decideTeamAudienceTargets([KITCHEN, BUILD, KITCHEN], camp, campWide),
    ).toEqual({ ok: true, teamIds: [KITCHEN, BUILD].sort() });
  });

  it("refuses none, an unknown team, and another lead's team", () => {
    expect(decideTeamAudienceTargets([], camp, campWide)).toEqual({
      ok: false,
      reason: "no_teams",
    });
    expect(decideTeamAudienceTargets([ARCHIVED], camp, campWide)).toEqual({
      ok: false,
      reason: "unknown_team",
    });
    expect(
      decideTeamAudienceTargets([BUILD], camp, {
        campWide: false,
        ledTeamIds: new Set([KITCHEN]),
      }),
    ).toEqual({ ok: false, reason: "not_your_team" });
  });

  it("keeps an archived team already on the stored audience", () => {
    expect(
      decideTeamAudienceTargets(
        [ARCHIVED],
        { liveTeamIds: LIVE, keepTeamIds: new Set([ARCHIVED]) },
        campWide,
      ),
    ).toEqual({ ok: true, teamIds: [ARCHIVED] });
  });

  it("teamsWithinReach: empty is no", () => {
    expect(teamsWithinReach([], campWide)).toBe(false);
  });

  it("every refusal has a sentence", () => {
    for (const r of ["no_teams", "unknown_team", "not_your_team"] as const) {
      expect(teamAudienceRefusalMessage(r)).toMatch(/team/);
      expect(meetingRefusalMessage(r)).toMatch(/team/);
    }
  });
});

describe("the chip", () => {
  it("one team reads 'Kitchen team'; several join with +", () => {
    expect(teamAudienceLabel(["Kitchen"])).toBe("Kitchen team");
    expect(teamAudienceLabel(["Kitchen", "Build & strike"])).toBe(
      "Kitchen + Build & strike",
    );
  });

  it("does not double 'team', and names a deleted team", () => {
    expect(teamAudienceLabel(["Tea team"])).toBe("Tea team");
    expect(teamAudienceLabel([])).toBe("Deleted team");
    expect(teamAudienceLabel(["  "])).toBe("Deleted team");
  });

  it("teamNamesFor follows the camp's list order and skips deleted teams", () => {
    // Stored ids are uuid-sorted; the chip reads in the camp's own order.
    expect(
      teamNamesFor(
        [BUILD, DELETED, KITCHEN],
        [
          { id: KITCHEN, name: "Kitchen" },
          { id: "unchosen", name: "Sound" },
          { id: BUILD, name: "Build & strike" },
        ],
      ),
    ).toEqual(["Kitchen", "Build & strike"]);
  });
});

// --- Meetings ----------------------------------------------------------------

const meetingFor = (
  teamIds: string[],
  createdByUserId: string | null = ALICE,
) => ({
  groupId: CAMP,
  audience: {
    kind: "project" as const,
    groupId: CAMP,
    mode: "teams" as const,
    roleIds: [],
    teamIds,
  },
  createdByUserId,
});

function viewer(
  userId: string,
  membership: PermissionMembership | null,
  on: string[] = [],
  leads: string[] = [],
): MeetingViewer {
  return {
    userId,
    membership,
    heldRoleIds: new Set(),
    teamIds: new Set(on),
    ledTeamIds: new Set(leads),
  };
}

describe("who sees a meeting for teams", () => {
  it("its teams' members, the camp's leads and whoever scheduled it", () => {
    const m = meetingFor([KITCHEN], THANDI);
    expect(
      canViewMeeting(viewer(JABU, perms(MEMBER), [KITCHEN]), m, BASELINE),
    ).toBe(true);
    expect(canViewMeeting(viewer(ALICE, perms(LEAD)), m, BASELINE)).toBe(true);
    expect(canViewMeeting(viewer(THANDI, perms(MEMBER)), m, BASELINE)).toBe(
      true,
    );
    expect(
      canViewMeeting(viewer(REN, perms(MEMBER), [BUILD]), m, BASELINE),
    ).toBe(false);
    expect(canViewMeeting(viewer(SAM, perms(MEMBER)), m, BASELINE)).toBe(false);
    expect(canViewMeeting(viewer(GONE, null, [KITCHEN]), m, BASELINE)).toBe(
      false,
    );
  });

  it("an archived team's members still see it; a deleted team shows to nobody else", () => {
    expect(
      canViewMeeting(
        viewer(ZOE, perms(MEMBER), [ARCHIVED]),
        meetingFor([ARCHIVED]),
        BASELINE,
      ),
    ).toBe(true);
    expect(
      canViewMeeting(
        viewer(SAM, perms(MEMBER)),
        meetingFor([DELETED]),
        BASELINE,
      ),
    ).toBe(false);
    expect(
      canViewMeeting(
        viewer(ALICE, perms(LEAD)),
        meetingFor([DELETED]),
        BASELINE,
      ),
    ).toBe(true);
  });

  it("isInMeetingAudience: holding the role is not being on the team", () => {
    expect(
      isInMeetingAudience(
        meetingFor([KITCHEN]).audience,
        new Set([KITCHEN]),
        BASELINE,
      ),
    ).toBe(false);
    expect(
      isInMeetingAudience(
        meetingFor([KITCHEN]).audience,
        new Set(),
        BASELINE,
        new Set([KITCHEN]),
      ),
    ).toBe(true);
  });

  it("notices go to the team, the leads and the scheduler, never the actor", () => {
    const recipients = resolveMeetingRecipients(
      meetingFor([KITCHEN], THANDI),
      {
        groupId: CAMP,
        memberships: MEMBERSHIPS,
        roleAssignments: [],
        projectRoles: [],
        teamMembers: SEATS,
      },
      JABU,
    );
    expect(recipients).toEqual([ALICE, THANDI].sort());
  });
});

describe("who schedules and edits a meeting for teams", () => {
  const SCHEDULER: ProjectPermissions = { schedule_meetings: true };
  const camp = (keep: string[] = []) => ({
    groupId: CAMP,
    campRoleIds: new Set([BASELINE, KITCHEN_ROLE]),
    baselineRoleId: BASELINE,
    teams: { liveTeamIds: LIVE, keepTeamIds: new Set(keep) },
  });

  it("a team lead may open the form; a member who leads nothing may not", () => {
    expect(
      canScheduleAnyMeeting(
        viewer(THANDI, perms(MEMBER), [KITCHEN], [KITCHEN]),
      ),
    ).toBe(true);
    expect(canScheduleAnyMeeting(viewer(JABU, perms(MEMBER), [KITCHEN]))).toBe(
      false,
    );
    expect(canScheduleAnyMeeting(viewer(SAM, perms(MEMBER, SCHEDULER)))).toBe(
      true,
    );
    expect(canScheduleAnyMeeting(viewer(GONE, null, [], [KITCHEN]))).toBe(
      false,
    );
  });

  it("a team lead schedules for their teams only, never the camp or roles", () => {
    const reach = meetingTeamReach(
      viewer(THANDI, perms(MEMBER), [KITCHEN], [KITCHEN]),
    );
    expect(reach.campWide).toBe(false);
    expect(
      decideMeetingAudience(
        { mode: "teams", roleIds: [], teamIds: [KITCHEN] },
        camp(),
        reach,
      ),
    ).toEqual({
      ok: true,
      audience: {
        kind: "project",
        groupId: CAMP,
        mode: "teams",
        roleIds: [],
        teamIds: [KITCHEN],
      },
    });
    expect(
      decideMeetingAudience(
        { mode: "teams", roleIds: [], teamIds: [BUILD] },
        camp(),
        reach,
      ),
    ).toEqual({ ok: false, reason: "not_your_team" });
    expect(
      decideMeetingAudience({ mode: "everyone", roleIds: [] }, camp(), reach),
    ).toEqual({ ok: false, reason: "not_scheduler" });
    expect(
      decideMeetingAudience(
        { mode: "roles", roleIds: [KITCHEN_ROLE] },
        camp(),
        reach,
      ),
    ).toEqual({ ok: false, reason: "not_scheduler" });
  });

  it("a scheduler picks any live team; an archived one only if already chosen", () => {
    const reach = meetingTeamReach(viewer(SAM, perms(MEMBER, SCHEDULER)));
    expect(reach.campWide).toBe(true);
    expect(
      decideMeetingAudience(
        { mode: "teams", roleIds: [], teamIds: [BUILD, KITCHEN] },
        camp(),
        reach,
      ).ok,
    ).toBe(true);
    expect(
      decideMeetingAudience(
        { mode: "teams", roleIds: [], teamIds: [ARCHIVED] },
        camp(),
        reach,
      ),
    ).toEqual({ ok: false, reason: "unknown_team" });
    expect(
      decideMeetingAudience(
        { mode: "teams", roleIds: [], teamIds: [ARCHIVED] },
        camp([ARCHIVED]),
        reach,
      ).ok,
    ).toBe(true);
    expect(
      decideMeetingAudience({ mode: "teams", roleIds: [] }, camp(), reach),
    ).toEqual({ ok: false, reason: "no_teams" });
  });

  it("a team lead edits a meeting for their teams, not another or the camp's", () => {
    const thandi = viewer(THANDI, perms(MEMBER), [KITCHEN], [KITCHEN]);
    expect(canEditMeeting(thandi, meetingFor([KITCHEN]), BASELINE)).toBe(true);
    expect(canEditMeetingNotes(thandi, meetingFor([KITCHEN]), BASELINE)).toBe(
      true,
    );
    // Sees it as its scheduler, but BUILD is not hers.
    expect(
      canEditMeeting(thandi, meetingFor([KITCHEN, BUILD], THANDI), BASELINE),
    ).toBe(false);
    const wholeCamp = {
      groupId: CAMP,
      audience: {
        kind: "project" as const,
        groupId: CAMP,
        mode: "everyone" as const,
        roleIds: [],
      },
      createdByUserId: ALICE,
    };
    expect(canEditMeeting(thandi, wholeCamp, BASELINE)).toBe(false);
    // A plain team member edits nothing.
    expect(
      canEditMeeting(
        viewer(JABU, perms(MEMBER), [KITCHEN]),
        meetingFor([KITCHEN]),
        BASELINE,
      ),
    ).toBe(false);
    // Once the team is archived it is no longer one she leads.
    expect(
      canEditMeeting(
        viewer(THANDI, perms(MEMBER), [ARCHIVED], []),
        meetingFor([ARCHIVED]),
        BASELINE,
      ),
    ).toBe(false);
  });
});
