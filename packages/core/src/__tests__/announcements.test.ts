import { describe, it, expect } from "vitest";
import type {
  MembershipRole,
  ProjectAudience,
  ProjectPermissions,
  ProjectRoleKind,
} from "@quagga/types";
import { MembershipRole as MembershipRoleEnum } from "@quagga/types";
import {
  ANNOUNCEMENT_MESSAGES,
  campAnnouncementEmail,
  campAnnouncementNotification,
  canPinCampAnnouncement,
  canSendCampAnnouncement,
  comparePinned,
  decideDispatch,
  explainDraftRefusal,
  explainPinRefusal,
  isAnnouncementSchedulingEnabled,
  isDueForDispatch,
  resolveCampAnnouncementRecipients,
  sortPinned,
  validateSendAt,
  type CampAnnouncementAudienceContext,
  type PinnedOrder,
} from "../announcements";
import {
  allProjectPermissions,
  hasProjectPermission,
  type PermissionMembership,
} from "../project-permissions";
import {
  notificationMentionsAny,
  shouldSendImmediateEmail,
} from "../notifications";

// Camp announcements (epic #56), ported from Camp 404's behaviour tests
// (team-announcements, announcement-drafts, announcement-pins,
// broadcast-dispatch, audience) to this codebase's pure predicates. The SQL
// halves — the compare-and-set claims, the locked re-read — are
// covered by the store tests' recorded WHERE clauses and, end to end, by the
// camp-announcements persona spec. Nothing here proves a query.

const CAMP = "11111111-1111-4111-8111-111111111111";
const OTHER_CAMP = "22222222-2222-4222-8222-222222222222";
const BASELINE = "b0000000-0000-4000-8000-000000000000";
const KITCHEN = "c0000000-0000-4000-8000-000000000001";
const BUILD = "c0000000-0000-4000-8000-000000000002";
const FOREIGN_ROLE = "c0000000-0000-4000-8000-000000000099";
const CAMP_ROLES = new Set([BASELINE, KITCHEN, BUILD]);

function member(
  structuralRole: MembershipRole,
  ...rolePermissions: ProjectPermissions[]
): PermissionMembership {
  return { structuralRole, rolePermissions };
}

function everyone(groupId = CAMP): ProjectAudience {
  return { kind: "project", groupId, mode: "everyone", roleIds: [] };
}

function roles(...roleIds: string[]): ProjectAudience {
  return { kind: "project", groupId: CAMP, mode: "roles", roleIds };
}

function send(
  m: PermissionMembership,
  audience: ProjectAudience,
  presentation: "feed" | "acknowledge" = "feed",
) {
  return canSendCampAnnouncement(m, {
    groupId: CAMP,
    audience,
    presentation,
    baselineRoleId: BASELINE,
    campRoleIds: CAMP_ROLES,
  });
}

const KITCHEN_POSTER: ProjectPermissions = {
  post_announcements: { audienceRoles: [KITCHEN], mayRequireAck: false },
};

describe("post_announcements permission", () => {
  it("structural lead and admin hold it with no grant at all", () => {
    for (const role of ["lead", "admin"] as const) {
      expect(hasProjectPermission(member(role), "post_announcements")).toBe(
        true,
      );
    }
  });

  it("a plain member holds it only through a granting role", () => {
    expect(
      hasProjectPermission(member("member", {}), "post_announcements"),
    ).toBe(false);
    expect(
      hasProjectPermission(
        member("member", KITCHEN_POSTER),
        "post_announcements",
      ),
    ).toBe(true);
  });

  it("the captain's full-permissions object includes it, unscoped, with ack", () => {
    expect(allProjectPermissions().post_announcements).toEqual({
      audienceRoles: "all",
      mayRequireAck: true,
    });
  });
});

describe("canSendCampAnnouncement — who may send to what", () => {
  it("a lead may send anything to their own camp, including must-acknowledge", () => {
    const lead = member("lead");
    expect(send(lead, everyone())).toBe(true);
    expect(send(lead, roles(KITCHEN), "acknowledge")).toBe(true);
  });

  it("a scoped poster reaches their own roles and nothing wider", () => {
    const poster = member("member", KITCHEN_POSTER);
    expect(send(poster, roles(KITCHEN))).toBe(true);
    // The whole camp is the baseline — outside a kitchen-only scope.
    expect(send(poster, everyone())).toBe(false);
    // A role outside the scope, alone or smuggled in beside an allowed one.
    expect(send(poster, roles(BUILD))).toBe(false);
    expect(send(poster, roles(KITCHEN, BUILD))).toBe(false);
  });

  it("must-acknowledge needs mayRequireAck, exactly as blocking needs mayBlock", () => {
    const poster = member("member", KITCHEN_POSTER);
    expect(send(poster, roles(KITCHEN), "acknowledge")).toBe(false);
    const acker = member("member", {
      post_announcements: { audienceRoles: [KITCHEN], mayRequireAck: true },
    });
    expect(send(acker, roles(KITCHEN), "acknowledge")).toBe(true);
  });

  it("a DEMOTED sender — the grant gone — is refused (the in-transaction re-check's rule)", () => {
    // Camp 404 team-announcements: "a lead removed between draft and publish
    // cannot publish". The store re-reads the member's roles inside the
    // publish transaction and asks THIS function; with the grant removed, the
    // same audience the draft was saved against is refused.
    const before = member("member", KITCHEN_POSTER);
    const after = member("member", {});
    expect(send(before, roles(KITCHEN))).toBe(true);
    expect(send(after, roles(KITCHEN))).toBe(false);
    // And an admin demoted to member loses the backstop the same way.
    expect(send(member("admin"), everyone())).toBe(true);
    expect(send(member("member"), everyone())).toBe(false);
  });

  it("never lets any sender — even a lead — address another camp", () => {
    const lead = member("lead");
    expect(send(lead, everyone(OTHER_CAMP))).toBe(false);
    // A role id that is not one of this camp's is refused, not resolved to nobody.
    expect(send(lead, roles(FOREIGN_ROLE))).toBe(false);
    expect(send(lead, roles(KITCHEN, FOREIGN_ROLE))).toBe(false);
  });

  it("an empty by-role audience is refused for everyone", () => {
    expect(send(member("lead"), roles())).toBe(false);
    const all = member("member", {
      post_announcements: { audienceRoles: "all", mayRequireAck: true },
    });
    expect(send(all, roles())).toBe(false);
  });

  it("a camp with no baseline role refuses 'everyone' to a scoped poster", () => {
    const all = member("member", {
      post_announcements: { audienceRoles: "all", mayRequireAck: false },
    });
    expect(
      canSendCampAnnouncement(all, {
        groupId: CAMP,
        audience: everyone(),
        presentation: "feed",
        baselineRoleId: null,
        campRoleIds: CAMP_ROLES,
      }),
    ).toBe(false);
  });

  it("the union of granting roles decides — one ack-capable role is enough", () => {
    const m = member("member", KITCHEN_POSTER, {
      post_announcements: { audienceRoles: [BUILD], mayRequireAck: true },
    });
    expect(send(m, roles(KITCHEN, BUILD), "acknowledge")).toBe(true);
  });

  it("pin authority follows posting authority, whatever the presentation", () => {
    const poster = member("member", KITCHEN_POSTER);
    const req = {
      groupId: CAMP,
      baselineRoleId: BASELINE,
      campRoleIds: CAMP_ROLES,
    };
    // May not SEND must-acknowledge, but may pin what went to their roles.
    expect(
      canPinCampAnnouncement(poster, { ...req, audience: roles(KITCHEN) }),
    ).toBe(true);
    expect(
      canPinCampAnnouncement(poster, { ...req, audience: everyone() }),
    ).toBe(false);
  });

  it("is only ever reachable by structural roles through the enum", () => {
    // Fixture hygiene: every structural role is from the real enum.
    for (const role of MembershipRoleEnum.options) {
      expect(typeof send(member(role), everyone())).toBe("boolean");
    }
  });
});

describe("resolveCampAnnouncementRecipients — who receives", () => {
  const ctx = (
    overrides: Partial<CampAnnouncementAudienceContext> = {},
  ): CampAnnouncementAudienceContext => ({
    groupId: CAMP,
    memberships: [
      { membershipId: "m-lead", userId: "u-lead", groupId: CAMP, role: "lead" },
      {
        membershipId: "m-cook",
        userId: "u-cook",
        groupId: CAMP,
        role: "member",
      },
      {
        membershipId: "m-build",
        userId: "u-build",
        groupId: CAMP,
        role: "member",
      },
      {
        membershipId: "m-gone",
        userId: "u-gone",
        groupId: CAMP,
        role: "member",
      },
      // Another camp's member — must never be reached.
      {
        membershipId: "m-x",
        userId: "u-other",
        groupId: OTHER_CAMP,
        role: "member",
      },
    ],
    roleAssignments: [
      { membershipId: "m-cook", projectRoleId: KITCHEN, consent: "accepted" },
      { membershipId: "m-build", projectRoleId: BUILD, consent: "accepted" },
      // A pending (unconsented) assignment does not make a target.
      { membershipId: "m-lead", projectRoleId: KITCHEN, consent: "pending" },
    ],
    projectRoles: (
      [
        [BASELINE, "baseline"],
        [KITCHEN, "custom"],
        [BUILD, "custom"],
      ] as [string, ProjectRoleKind][]
    ).map(([id, kind]) => ({ id, groupId: CAMP, kind, officerKey: null })),
    excludedUserIds: new Set(["u-gone"]),
    ...overrides,
  });

  it("everyone = this camp's members, minus the author and sanitized accounts", () => {
    expect(
      resolveCampAnnouncementRecipients(everyone(), ctx(), "u-lead"),
    ).toEqual(["u-build", "u-cook"]);
  });

  it("by role reaches only accepted holders of that role", () => {
    expect(
      resolveCampAnnouncementRecipients(roles(KITCHEN), ctx(), "u-build"),
    ).toEqual(["u-cook"]);
  });

  it("an audience naming another camp reaches nobody", () => {
    expect(
      resolveCampAnnouncementRecipients(everyone(OTHER_CAMP), ctx(), "u-lead"),
    ).toEqual([]);
  });

  it("the fixture moves the number — removing the exclusion reaches the stub", () => {
    // Guard against a vacuous exclusion test: with no excluded set the
    // sanitized account IS reached, so the assertion above is load-bearing.
    expect(
      resolveCampAnnouncementRecipients(
        everyone(),
        ctx({ excludedUserIds: new Set() }),
        "u-lead",
      ),
    ).toContain("u-gone");
  });
});

describe("explainDraftRefusal — draft privacy", () => {
  const row = {
    groupId: CAMP,
    createdByUserId: "u-author",
    publishedAt: null,
  };

  it("another member's draft answers exactly like a missing one", () => {
    const theirs = explainDraftRefusal(row, {
      actorId: "u-someone-else",
      groupId: CAMP,
      allowed: true,
    });
    const missing = explainDraftRefusal(null, {
      actorId: "u-someone-else",
      groupId: CAMP,
      allowed: true,
    });
    expect(theirs).toBe(missing);
    expect(theirs).toBe(ANNOUNCEMENT_MESSAGES.missing);
  });

  it("a draft of another camp answers as missing too", () => {
    expect(
      explainDraftRefusal(
        { ...row, groupId: OTHER_CAMP },
        { actorId: "u-author", groupId: CAMP, allowed: true },
      ),
    ).toBe(ANNOUNCEMENT_MESSAGES.missing);
  });

  it("tells the author a published announcement is immutable", () => {
    expect(
      explainDraftRefusal(
        { ...row, publishedAt: new Date() },
        { actorId: "u-author", groupId: CAMP, allowed: true },
      ),
    ).toBe(ANNOUNCEMENT_MESSAGES.published);
  });

  it("tells a demoted author why their own draft would not publish", () => {
    expect(
      explainDraftRefusal(row, {
        actorId: "u-author",
        groupId: CAMP,
        allowed: false,
      }),
    ).toBe(ANNOUNCEMENT_MESSAGES.notAllowed);
  });
});

describe("explainPinRefusal", () => {
  const delivered = {
    groupId: CAMP,
    dispatchedAt: new Date("2027-03-01T08:00:00Z"),
    pinnedAt: null,
  };

  it("names the lost compare-and-set race", () => {
    expect(
      explainPinRefusal(
        { ...delivered, pinnedAt: new Date() },
        { groupId: CAMP, allowed: true, pinned: true },
      ),
    ).toBe(ANNOUNCEMENT_MESSAGES.alreadyPinned);
    expect(
      explainPinRefusal(delivered, {
        groupId: CAMP,
        allowed: true,
        pinned: false,
      }),
    ).toBe(ANNOUNCEMENT_MESSAGES.alreadyUnpinned);
  });

  it("refuses to pin something nobody has received yet", () => {
    expect(
      explainPinRefusal(
        { ...delivered, dispatchedAt: null },
        { groupId: CAMP, allowed: true, pinned: true },
      ),
    ).toBe(ANNOUNCEMENT_MESSAGES.notDelivered);
  });

  it("refuses an actor outside the audience before saying anything about state", () => {
    expect(
      explainPinRefusal(delivered, {
        groupId: CAMP,
        allowed: false,
        pinned: true,
      }),
    ).toBe(ANNOUNCEMENT_MESSAGES.notAllowed);
  });
});

describe("sortPinned — a total order", () => {
  const at = (iso: string) => new Date(iso);
  const pin = (id: string, iso: string, fromOrg = false): PinnedOrder => ({
    id,
    pinnedAt: at(iso),
    fromOrg,
  });

  it("puts the newest PIN first", () => {
    const pins = [
      pin("a", "2027-03-01T08:00:00Z"),
      pin("b", "2027-03-03T08:00:00Z"),
      pin("c", "2027-03-02T08:00:00Z"),
    ];
    expect(sortPinned(pins).map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  it("on a tie, AfrikaBurn above a camp, then the id", () => {
    const t = "2027-03-01T08:00:00Z";
    const pins = [pin("z", t), pin("y", t, true), pin("a", t)];
    expect(sortPinned(pins).map((p) => p.id)).toEqual(["y", "a", "z"]);
  });

  it("is independent of input order (antisymmetric, never 0 for distinct pins)", () => {
    const t = "2027-03-01T08:00:00Z";
    const pins = [pin("m", t), pin("n", t), pin("o", t, true)];
    const forward = sortPinned(pins).map((p) => p.id);
    const reversed = sortPinned([...pins].reverse()).map((p) => p.id);
    expect(forward).toEqual(reversed);
    expect(comparePinned(pins[0]!, pins[1]!)).toBe(
      -comparePinned(pins[1]!, pins[0]!),
    );
    expect(comparePinned(pins[0]!, pins[1]!)).not.toBe(0);
  });
});

describe("scheduling and dispatch", () => {
  const now = new Date("2027-03-01T08:00:00Z");

  const on = { schedulingEnabled: true };
  const off = { schedulingEnabled: false };

  it("validateSendAt: null is now, the past is refused, a year is the horizon", () => {
    expect(validateSendAt(null, now, on)).toEqual({ ok: true, sendAt: null });
    expect(validateSendAt(new Date("2027-02-28T08:00:00Z"), now, on).ok).toBe(
      false,
    );
    expect(validateSendAt(new Date(now.getTime() + 30_000), now, on).ok).toBe(
      false,
    );
    expect(validateSendAt(new Date("2027-03-02T08:00:00Z"), now, on).ok).toBe(
      true,
    );
    expect(validateSendAt(new Date("2028-06-01T08:00:00Z"), now, on).ok).toBe(
      false,
    );
    expect(validateSendAt(new Date("nonsense"), now, on).ok).toBe(false);
  });

  // Regression: with no scheduler calling the dispatch route, a scheduled
  // publish was accepted ("Scheduled for ...") and then never delivered, and a
  // published announcement cannot be edited or cancelled, so it was lost.
  it("validateSendAt: a send time is refused while scheduling is off; now still works", () => {
    expect(validateSendAt(null, now, off)).toEqual({ ok: true, sendAt: null });
    expect(validateSendAt(new Date("2027-03-02T08:00:00Z"), now, off)).toEqual({
      ok: false,
      error: ANNOUNCEMENT_MESSAGES.schedulingOff,
    });
  });

  it('isAnnouncementSchedulingEnabled: only an explicit "true" turns it on', () => {
    expect(isAnnouncementSchedulingEnabled(undefined)).toBe(false);
    expect(isAnnouncementSchedulingEnabled("")).toBe(false);
    expect(isAnnouncementSchedulingEnabled("false")).toBe(false);
    expect(isAnnouncementSchedulingEnabled("1")).toBe(false);
    expect(isAnnouncementSchedulingEnabled("true")).toBe(true);
    expect(isAnnouncementSchedulingEnabled(" TRUE ")).toBe(true);
  });

  it("isDueForDispatch: only published, scheduled, undelivered CAMP rows whose time came", () => {
    const due = {
      groupId: CAMP,
      publishedAt: new Date("2027-02-01T00:00:00Z"),
      dispatchedAt: null,
      sendAt: new Date("2027-03-01T07:00:00Z"),
    };
    expect(isDueForDispatch(due, now)).toBe(true);
    // Idempotent: once claimed it is never due again.
    expect(isDueForDispatch({ ...due, dispatchedAt: now }, now)).toBe(false);
    expect(isDueForDispatch({ ...due, publishedAt: null }, now)).toBe(false);
    expect(
      isDueForDispatch(
        { ...due, sendAt: new Date("2027-03-01T09:00:00Z") },
        now,
      ),
    ).toBe(false);
    // An immediate row is fanned out inline, never by the job.
    expect(isDueForDispatch({ ...due, sendAt: null }, now)).toBe(false);
    // An org bulletin — including every pre-existing one with a null
    // dispatched_at — is never the job's business.
    expect(isDueForDispatch({ ...due, groupId: null }, now)).toBe(false);
  });

  it("decideDispatch re-asks the sender's permission and the edition", () => {
    expect(
      decideDispatch({ senderAllowed: true, editionIsActive: true }),
    ).toEqual({
      deliver: true,
    });
    expect(
      decideDispatch({ senderAllowed: false, editionIsActive: true }),
    ).toEqual({
      deliver: false,
      reason: "sender_not_allowed",
    });
    expect(
      decideDispatch({ senderAllowed: null, editionIsActive: true }),
    ).toEqual({
      deliver: false,
      reason: "author_gone",
    });
    expect(
      decideDispatch({ senderAllowed: true, editionIsActive: false }),
    ).toEqual({
      deliver: false,
      reason: "edition_ended",
    });
  });
});

describe("payloads carry no personal data", () => {
  it("the inbox row is camp name + title + link, and nothing about members", () => {
    const payload = campAnnouncementNotification({
      campName: "Mad Hatters",
      title: "Build week starts Friday",
      announcementId: "a1",
      presentation: "acknowledge",
    });
    expect(payload).toEqual({
      kind: "bulletin",
      title: "Mad Hatters: Build week starts Friday",
      body: "Please read and acknowledge this announcement.",
      link: "/bulletins/a1",
    });
    expect(
      notificationMentionsAny(payload, ["+27821234567", "alice@example.com"]),
    ).toBe(false);
    expect(
      campAnnouncementNotification({
        campName: "Mad Hatters",
        title: "t",
        announcementId: "a1",
        presentation: "feed",
      }).body,
    ).toBeNull();
  });

  it("the immediate email nudges without carrying the body", () => {
    const email = campAnnouncementEmail({
      campName: "Mad Hatters",
      title: "Fire safety brief",
      announcementId: "a1",
    });
    expect(email.subject).toContain("Mad Hatters");
    expect(email.text).toContain("/bulletins/a1");
  });

  // Regression: the link was the bare path "/bulletins/a1", which an email
  // client cannot open, so the must-acknowledge nudge had no way through.
  it("the immediate email links absolutely when the app URL is known", () => {
    const email = campAnnouncementEmail({
      campName: "Mad Hatters",
      title: "Fire safety brief",
      announcementId: "a1",
      appUrl: "https://contributors.example.com/",
    });
    expect(email.text).toContain(
      "Open it here: https://contributors.example.com/bulletins/a1",
    );
    const relative = campAnnouncementEmail({
      campName: "Mad Hatters",
      title: "Fire safety brief",
      announcementId: "a1",
      appUrl: null,
    });
    expect(relative.text).toContain("Open it here: /bulletins/a1");
  });

  it("only a must-acknowledge announcement emails immediately", () => {
    expect(shouldSendImmediateEmail("bulletin")).toBe(false);
    expect(
      shouldSendImmediateEmail("bulletin", { mustAcknowledge: false }),
    ).toBe(false);
    expect(
      shouldSendImmediateEmail("bulletin", { mustAcknowledge: true }),
    ).toBe(true);
  });
});
