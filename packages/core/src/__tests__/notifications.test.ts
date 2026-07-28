import { describe, it, expect } from "vitest";
import type { AudienceSpec } from "@quagga/types";
import {
  buildBulletinNotifications,
  bulletinNotification,
  countUnread,
  groupNotificationsByDay,
  notificationLinkIsLocal,
  resolveNotificationLinkApp,
  notificationMentionsAny,
  officerAcceptedNotification,
  officerAssignmentRequestNotification,
  questionnaireReleasedNotification,
  registrationDecisionNotification,
  resolveBulletinAudience,
  shouldSendImmediateEmail,
  supplierStandingNotification,
  supplierStepConfirmedNotification,
  type NotificationPayload,
  wranglerAssignedNotification,
} from "../notifications";
import { resolveAudience, type AudienceContext } from "../audience";

// --- Fixture world (mirrors audience.test.ts) ----------------------------

const ORG = "g-org";
const CAMP_REG = "g-camp-registered";
const CAMP_UNREG = "g-camp-unregistered";
const EDITION = "e-2027";

function membership(
  userId: string,
  groupId: string,
  role: AudienceContext["memberships"][number]["role"],
) {
  return { membershipId: `m:${userId}:${groupId}`, userId, groupId, role };
}

function baseCtx(): AudienceContext {
  return {
    editionId: EDITION,
    orgGroupId: ORG,
    groups: [
      { id: ORG, kind: "org" },
      { id: CAMP_REG, kind: "theme_camp" },
      { id: CAMP_UNREG, kind: "theme_camp" },
    ],
    memberships: [
      membership("staff", ORG, "org_staff"),
      membership("god", ORG, "god"),
      membership("orgMember", ORG, "member"),
      membership("campRegLead", CAMP_REG, "lead"),
      membership("campRegMember", CAMP_REG, "member"),
      membership("campUnregLead", CAMP_UNREG, "lead"),
    ],
    registrations: [
      { groupId: CAMP_REG, editionId: EDITION, status: "approved", grantsInterest: null },
      { groupId: CAMP_UNREG, editionId: EDITION, status: "draft", grantsInterest: null },
    ],
    bios: [
      { userId: "campRegLead", editionId: EDITION },
      { userId: "campRegMember", editionId: EDITION },
      { userId: "orgMember", editionId: EDITION },
    ],
    roleAssignments: [],
  };
}

// --- Bulletin consumer reuses the shared resolver ------------------------

describe("bulletin audience (shared resolver, second consumer)", () => {
  it("resolveBulletinAudience is the same expansion questionnaires use", () => {
    const spec: AudienceSpec = {
      kind: "org_outbound",
      selectors: ["all_current_burners"],
    };
    const ctx = baseCtx();
    expect(resolveBulletinAudience(spec, ctx)).toEqual(
      resolveAudience(spec, ctx),
    );
  });

  it("fans out exactly one notification row per resolved recipient", () => {
    const spec: AudienceSpec = {
      kind: "org_outbound",
      selectors: ["all_current_burners"],
    };
    const ctx = baseCtx();
    const userIds = resolveBulletinAudience(spec, ctx);
    const rows = buildBulletinNotifications(
      { bulletinId: "b-1", title: "Ticket resale window opens 1 March" },
      userIds,
    );
    expect(rows).toHaveLength(userIds.length);
    expect(rows).toHaveLength(3); // campRegLead, campRegMember, orgMember
    expect(new Set(rows.map((r) => r.userId))).toEqual(new Set(userIds));
    for (const r of rows) {
      expect(r.kind).toBe("bulletin");
      expect(r.bulletinId).toBe("b-1");
      expect(r.link).toBe("/bulletins/b-1");
    }
  });

  it("empty audiences fan out to zero rows (valid, not an error)", () => {
    const spec: AudienceSpec = {
      kind: "org_outbound",
      selectors: ["mv_grant_requesters"],
    };
    const userIds = resolveBulletinAudience(spec, baseCtx());
    expect(buildBulletinNotifications({ bulletinId: "b-x", title: "x" }, userIds)).toEqual([]);
  });
});

// --- Org-internal isolation ----------------------------------------------

describe("org-internal isolation", () => {
  it("an org_internal bulletin reaches only org members, never participants", () => {
    const spec: AudienceSpec = { kind: "org_internal" };
    const userIds = resolveBulletinAudience(spec, baseCtx());
    expect(userIds).toEqual(["god", "orgMember", "staff"].sort());
    expect(userIds).not.toContain("campRegLead");
    expect(userIds).not.toContain("campRegMember");
    expect(userIds).not.toContain("campUnregLead");
  });
});

// --- Preview privacy: no hard-locked fields ------------------------------

describe("preview privacy — no hard-locked fields in any payload", () => {
  // Planted hard-locked values that must never surface in a preview.
  const SECRETS = [
    "+27821234567", // phone
    "9001015800081", // SA ID
    "A12345678", // passport
    "Ma Emergency", // emergency contact name
    "penicillin allergy", // medical
  ];

  // Every builder invoked with representative safe inputs; the source objects
  // deliberately carry NO secret so a leak could only come from a builder
  // echoing something it shouldn't. We assert the output mentions no secret.
  const payloads: NotificationPayload[] = [
    registrationDecisionNotification({ campName: "Mad Hatters", decision: "approved", campSlug: "mad-hatters" }),
    registrationDecisionNotification({ campName: "Karoo Kombuis", decision: "changes_requested" }),
    registrationDecisionNotification({ campName: "Camp 404", decision: "rejected" }),
    questionnaireReleasedNotification({ title: "Build week availability", blocking: true, activationId: "a-1" }),
    questionnaireReleasedNotification({ title: "Feedback", blocking: false }),
    officerAssignmentRequestNotification({ officerLabel: "Safety Baron", campName: "Mad Hatters", campSlug: "mad-hatters" }),
    officerAcceptedNotification({ officerLabel: "Fire Safety Officer", campName: "Mad Hatters" }),
    wranglerAssignedNotification({ wranglerName: "Sipho", campName: "Mad Hatters" }),
    supplierStandingNotification({ standingLabel: "In Good Standing" }),
    supplierStepConfirmedNotification({ stepLabel: "Deposit received" }),
    bulletinNotification({ bulletinTitle: "Ticket resale window opens", bulletinId: "b-1" }),
  ];

  it("no builder emits any hard-locked value", () => {
    for (const payload of payloads) {
      expect(notificationMentionsAny(payload, SECRETS)).toBe(false);
    }
  });

  it("notificationMentionsAny catches a genuine leak (guard is not vacuous)", () => {
    const leaky: NotificationPayload = {
      kind: "security",
      title: "Your phone +27821234567 was updated",
      body: null,
      link: null,
    };
    expect(notificationMentionsAny(leaky, SECRETS)).toBe(true);
  });

  it("blank needles never false-positive", () => {
    const payload = bulletinNotification({ bulletinTitle: "x", bulletinId: "b" });
    expect(notificationMentionsAny(payload, ["", "   "])).toBe(false);
  });

  it("registration decision preview carries the camp name, not private contact", () => {
    const p = registrationDecisionNotification({ campName: "Mad Hatters", decision: "approved" });
    expect(p.title).toContain("Mad Hatters");
    expect(notificationMentionsAny(p, SECRETS)).toBe(false);
  });
});

// --- Blocking flag on questionnaire release ------------------------------

describe("questionnaire release blocking flag", () => {
  it("flags blocking questionnaires explicitly", () => {
    const p = questionnaireReleasedNotification({ title: "Build week", blocking: true });
    expect(p.title).toMatch(/REQUIRED/);
  });
  it("non-blocking releases carry no REQUIRED flag", () => {
    const p = questionnaireReleasedNotification({ title: "Survey", blocking: false });
    expect(p.title).not.toMatch(/REQUIRED/);
  });
});

// --- Immediate-email gating ----------------------------------------------

describe("shouldSendImmediateEmail", () => {
  it("sends for registration decisions", () => {
    expect(shouldSendImmediateEmail("registration")).toBe(true);
  });
  it("sends for blocking questionnaires only", () => {
    expect(shouldSendImmediateEmail("questionnaire", { blocking: true })).toBe(true);
    expect(shouldSendImmediateEmail("questionnaire", { blocking: false })).toBe(false);
    expect(shouldSendImmediateEmail("questionnaire")).toBe(false);
  });
  it("never sends immediate email for bulletins, roles, suppliers, security, wrangler", () => {
    for (const kind of ["bulletin", "role", "supplier", "security", "wrangler"] as const) {
      expect(shouldSendImmediateEmail(kind)).toBe(false);
    }
  });
});

// --- Unread count logic --------------------------------------------------

describe("unread count", () => {
  const now = new Date("2027-03-01T10:00:00Z");
  const rows = [
    { readAt: null, createdAt: now },
    { readAt: null, createdAt: now },
    { readAt: new Date("2027-03-01T09:00:00Z"), createdAt: now },
  ];
  it("counts only rows with a null read_at", () => {
    expect(countUnread(rows)).toBe(2);
  });
  it("is zero for an all-read or empty inbox", () => {
    expect(countUnread([])).toBe(0);
    expect(countUnread([{ readAt: now }])).toBe(0);
  });
});

// --- Day grouping --------------------------------------------------------

describe("groupNotificationsByDay", () => {
  const now = new Date("2027-03-03T12:00:00");
  it("labels today, yesterday, then dates; preserves newest-first order", () => {
    const items = [
      { id: 1, createdAt: new Date("2027-03-03T11:00:00") },
      { id: 2, createdAt: new Date("2027-03-03T09:00:00") },
      { id: 3, createdAt: new Date("2027-03-02T20:00:00") },
      { id: 4, createdAt: new Date("2027-02-28T08:00:00") },
    ];
    const groups = groupNotificationsByDay(items, now);
    expect(groups.map((g) => g.label)).toEqual([
      "Today",
      "Yesterday",
      "2027-02-28",
    ]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual([1, 2]);
    expect(groups[1]!.items.map((i) => i.id)).toEqual([3]);
    expect(groups[2]!.items.map((i) => i.id)).toEqual([4]);
  });
  it("returns [] for an empty inbox", () => {
    expect(groupNotificationsByDay([], now)).toEqual([]);
  });
});

// --- audit M13: a link belongs to ONE app ---------------------------------

describe("notificationLinkIsLocal", () => {
  it("treats an unstamped row as local — every pre-migration row", () => {
    // The column is nullable precisely so a staggered three-app deploy cannot
    // break: null must behave exactly as before it existed.
    expect(notificationLinkIsLocal(null, "web")).toBe(true);
    expect(notificationLinkIsLocal(undefined, "suppliers")).toBe(true);
  });

  it("is local when the row was minted for this app", () => {
    expect(notificationLinkIsLocal("web", "web")).toBe(true);
    expect(notificationLinkIsLocal("suppliers", "suppliers")).toBe(true);
  });

  it("is NOT local across apps — the proven 404 class", () => {
    // A supplier bulletin linking at a participant route, read in the supplier
    // portal, is the exact shape that 404'd.
    expect(notificationLinkIsLocal("web", "suppliers")).toBe(false);
    expect(notificationLinkIsLocal("suppliers", "org")).toBe(false);
    expect(notificationLinkIsLocal("org", "web")).toBe(false);
  });
});

describe("resolveNotificationLinkApp", () => {
  // The bug: a burner received an AfrikaBurn bulletin and could not open it.
  // Each app wrote its own `r.linkApp ?? "<app>"`, and `null ?? "org"` is
  // "org" — so the bulletin fan-out's DELIBERATE null was rewritten to the org
  // app, `notificationLinkIsLocal("org", "web")` returned false on the
  // participant inbox, the link was dropped, and the row rendered inert.
  it("keeps an explicit null — 'belongs to no single app'", () => {
    expect(resolveNotificationLinkApp(null, "org")).toBeNull();
    expect(resolveNotificationLinkApp(null, "web")).toBeNull();
    expect(resolveNotificationLinkApp(null, "suppliers")).toBeNull();
  });

  it("defaults to the writing app when the caller did not say", () => {
    expect(resolveNotificationLinkApp(undefined, "org")).toBe("org");
    expect(resolveNotificationLinkApp(undefined, "web")).toBe("web");
  });

  it("honours an explicit foreign app", () => {
    expect(resolveNotificationLinkApp("suppliers", "org")).toBe("suppliers");
  });

  it("a bulletin's null survives all the way to the reader's inbox", () => {
    // End to end through both halves of the rule: null in, null stored, and
    // every app then treats it as local — which is the whole point.
    const stored = resolveNotificationLinkApp(null, "org");
    expect(notificationLinkIsLocal(stored, "web")).toBe(true);
    expect(notificationLinkIsLocal(stored, "suppliers")).toBe(true);
    expect(notificationLinkIsLocal(stored, "org")).toBe(true);
  });
});
