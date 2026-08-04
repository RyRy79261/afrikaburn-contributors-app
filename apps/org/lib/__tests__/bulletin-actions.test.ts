import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";

/**
 * A BULLETIN IS A BROADCAST, AND IT CANNOT BE RECALLED.
 *
 * Publishing fans one notification out per resolved recipient. That is why the
 * title and the audience freeze at publish (the recipients' rows carry the title
 * as sent, and a broadcast cannot be re-aimed afterwards), why the broadcast
 * right is re-checked AT publish rather than trusted from save time, and why a
 * double publish is refused rather than tolerated — the whole audience getting
 * the same notice twice, with nothing in the console saying why, is a defect
 * that has happened.
 */

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
  createPooledDb: () => ({ db, pool: { end: async () => {} } }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireOrgSession = vi.fn();
vi.mock("@/lib/session", () => ({
  requireOrgSession: (options?: unknown) => requireOrgSession(options),
}));

import { getBulletin, listBulletins } from "@/lib/bulletins";
import {
  publishBulletin,
  saveBulletin,
  setBulletinPinned,
} from "@/lib/actions/bulletins";

const BULLETIN_ID = "17171717-1717-4717-8717-171717171717";
const ENV = { ...process.env };

const EDITION = {
  id: "ed-2027",
  name: "AfrikaBurn 2027",
  year: 2027,
  startDate: "2027-04-26",
  endDate: "2027-05-02",
};

const COMPOSE = {
  title: "Gate opens Sunday",
  bodyMd: "Bring water.",
  audience: { kind: "org_internal" as const },
  pinned: false,
  publish: false,
};

/** The seven row sets `buildAudienceContext` reads, with one org member. */
function seedAudienceContext() {
  db.seed("memberships", [
    {
      membershipId: "mem-1",
      userId: "staff-1",
      groupId: "org-1",
      role: "org_staff",
    },
  ]);
  db.seed("groups", [{ id: "org-1", kind: "org" }]);
  db.seed("registrations", []);
  db.seed("burner_bios", []);
  db.seed("member_role_assignments", []);
  db.seed("project_roles", []);
  db.seed("suppliers", []);
}

beforeEach(() => {
  db = fakeDb();
  process.env.DATABASE_URL = "postgres://localhost/quagga";
  requireOrgSession.mockReset();
  requireOrgSession.mockResolvedValue({
    dbUserId: "user-1",
    orgGroupId: "org-1",
    role: "god",
  });
  db.seed("editions", [EDITION]);
});

afterEach(() => {
  process.env = { ...ENV };
});

describe("saveBulletin", () => {
  it("refuses a CAMP-scoped target outright", async () => {
    // Bulletins broadcast to org audiences; a single camp is a camp-scoped
    // questionnaire, which is a different feature with a different consent.
    const result = await saveBulletin({
      ...COMPOSE,
      audience: {
        kind: "project",
        groupId: "g",
        mode: "everyone",
        roleIds: [],
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "Bulletins broadcast to org audiences, not a single camp.",
    });
    expect(db.recorded("insert", "bulletins")).toHaveLength(0);
  });

  it("refuses an ENGINEER with the broadcast refusal, not a generic one", async () => {
    // The seeded Engineer role holds `create` and `update` for console
    // operations, but announcing things to burners in AfrikaBurn's name is not
    // IT work — so the CAPABILITY passes and the AUDIENCE predicate refuses.
    requireOrgSession.mockResolvedValue({
      dbUserId: "user-1",
      orgGroupId: "org-1",
      role: "engineer",
    });

    const result = await saveBulletin(COMPOSE);

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(
      /don't broadcast to burners in AfrikaBurn's name/,
    );
  });

  it("asks for `create` when composing and `update` when correcting", async () => {
    // Both used to ask for `update`, so a role given "may correct what is
    // already there" could compose a brand-new bulletin and broadcast it.
    db.seed("bulletins", [{ id: BULLETIN_ID }]);
    await saveBulletin(COMPOSE);
    expect(requireOrgSession).toHaveBeenLastCalledWith({
      capability: "create",
      domain: "bulletins",
    });

    db = fakeDb();
    db.seed("editions", [EDITION]);
    db.seed("bulletins", [
      {
        id: BULLETIN_ID,
        title: COMPOSE.title,
        audience: COMPOSE.audience,
        publishedAt: null,
      },
    ]);
    await saveBulletin({ ...COMPOSE, id: BULLETIN_ID });
    expect(requireOrgSession).toHaveBeenLastCalledWith({
      capability: "update",
      domain: "bulletins",
    });
  });

  it("refuses when there is no active edition to attach it to", async () => {
    db.seed("editions", []);
    await expect(saveBulletin(COMPOSE)).resolves.toEqual({
      ok: false,
      error: "No active edition to attach the bulletin to.",
    });
  });

  it("refuses a bulletin that no longer exists", async () => {
    db.seed("bulletins", []);
    await expect(
      saveBulletin({ ...COMPOSE, id: BULLETIN_ID }),
    ).resolves.toEqual({
      ok: false,
      error: "That bulletin no longer exists.",
    });
  });

  it("FREEZES the title and audience once it has gone out", async () => {
    // Rewriting either left the console's own "sent to N people" detail
    // describing a broadcast that never took place. The refusal is loud rather
    // than a silent discard, because the composer posts the whole form back and
    // a dropped title change would toast "Bulletin saved." over an unmoved
    // title.
    db.seed("bulletins", [
      {
        id: BULLETIN_ID,
        title: "Gate opens Sunday",
        audience: { kind: "org_internal" },
        publishedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);

    const result = await saveBulletin({
      ...COMPOSE,
      id: BULLETIN_ID,
      title: "Gate opens Monday",
    });

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(
      /Its title and audience are fixed/,
    );
    expect(db.recorded("update", "bulletins")).toHaveLength(0);
  });

  it("still lets the BODY be corrected after publish, and sends nothing new", async () => {
    // The other half: a published bulletin is not read-only, it is re-aim-proof.
    db.seed("bulletins", [
      {
        id: BULLETIN_ID,
        title: "Gate opens Sunday",
        audience: { kind: "org_internal" },
        publishedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);

    const result = await saveBulletin({
      ...COMPOSE,
      id: BULLETIN_ID,
      bodyMd: "Bring water and a hat.",
      publish: true,
    });

    expect(result).toEqual({ ok: true, id: BULLETIN_ID });
    const values = db.recorded("update", "bulletins")[0]?.values as Record<
      string,
      unknown
    >;
    expect(values.bodyMd).toBe("Bring water and a hat.");
    // Never re-stamped, never re-titled, and nobody notified again.
    expect(values.publishedAt).toBeUndefined();
    expect(values.title).toBeUndefined();
    expect(db.recorded("insert", "notifications")).toHaveLength(0);
    expect(db.inserted("audit_events")).toMatchObject({
      action: "bulletin.update",
    });
  });

  it("does not read a reordered selector list as an audience CHANGE", async () => {
    // `["a","b"]` and `["b","a"]` reach exactly the same people; treating the
    // order as a change would refuse an ordinary body edit.
    db.seed("bulletins", [
      {
        id: BULLETIN_ID,
        title: "Gate opens Sunday",
        audience: {
          kind: "org_outbound",
          selectors: ["all_current_burners", "camp_leads"],
        },
        publishedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);

    const result = await saveBulletin({
      ...COMPOSE,
      id: BULLETIN_ID,
      audience: {
        kind: "org_outbound",
        selectors: ["camp_leads", "all_current_burners"],
      },
    });

    expect(result).toEqual({ ok: true, id: BULLETIN_ID });
  });

  it("creates a DRAFT without notifying anybody", async () => {
    db.seed("bulletins", [{ id: BULLETIN_ID }]);

    const result = await saveBulletin(COMPOSE);

    expect(result).toEqual({ ok: true, id: BULLETIN_ID });
    expect(db.inserted("bulletins")).toMatchObject({
      editionId: EDITION.id,
      title: "Gate opens Sunday",
      publishedAt: null,
    });
    expect(db.recorded("insert", "notifications")).toHaveLength(0);
    expect(db.inserted("audit_events")).toMatchObject({
      action: "bulletin.create",
    });
  });

  it("publishes on create by fanning out one notification per recipient", async () => {
    db.seed("bulletins", [{ id: BULLETIN_ID }]);
    seedAudienceContext();

    const result = await saveBulletin({ ...COMPOSE, publish: true });

    expect(result).toEqual({ ok: true, id: BULLETIN_ID });
    const rows = db.inserted("notifications") as {
      userId: string;
      bulletinId: string;
      linkApp: string | null;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: "staff-1",
      bulletinId: BULLETIN_ID,
    });
    // linkApp stays NULL by design: /bulletins/<id> exists in all three apps and
    // each authorises the read from the recipient's own row, so the same
    // relative path resolves wherever they happen to read it.
    expect(rows[0]?.linkApp).toBeNull();
    expect(db.inserted("audit_events")).toMatchObject({
      action: "bulletin.publish",
    });
  });
});

describe("publishBulletin", () => {
  it("refuses one that no longer exists", async () => {
    db.seed("bulletins", []);
    await expect(publishBulletin({ id: BULLETIN_ID })).resolves.toEqual({
      ok: false,
      error: "That bulletin no longer exists.",
    });
  });

  it("REFUSES A SECOND PUBLISH", async () => {
    // Two publishes racing the same draft both read `published_at IS NULL`, both
    // passed, and both fanned out — the whole audience got the notice twice.
    // The row lock serialises them so the second finds it published.
    db.seed("bulletins", [
      {
        id: BULLETIN_ID,
        title: "Gate opens Sunday",
        audience: { kind: "org_internal" },
        editionId: EDITION.id,
        publishedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);

    const result = await publishBulletin({ id: BULLETIN_ID });

    expect(result).toEqual({
      ok: false,
      error: "That bulletin is already published.",
    });
    expect(db.recorded("insert", "notifications")).toHaveLength(0);
  });

  it("RE-CHECKS the broadcast right at publish time", async () => {
    // The save-time answer may be stale: a role can be rescoped, or a
    // department can lose a domain, between drafting and sending.
    requireOrgSession.mockResolvedValue({
      dbUserId: "user-1",
      orgGroupId: "org-1",
      role: "engineer",
    });
    db.seed("bulletins", [
      {
        id: BULLETIN_ID,
        title: "Gate opens Sunday",
        audience: { kind: "org_internal" },
        editionId: EDITION.id,
        publishedAt: null,
      },
    ]);

    const result = await publishBulletin({ id: BULLETIN_ID });

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/don't broadcast/);
    expect(db.recorded("update", "bulletins")).toHaveLength(0);
    expect(db.recorded("insert", "notifications")).toHaveLength(0);
  });

  it("refuses a stored audience that is camp-scoped", async () => {
    db.seed("bulletins", [
      {
        id: BULLETIN_ID,
        title: "Gate opens Sunday",
        audience: {
          kind: "project",
          groupId: "g",
          mode: "everyone",
          roleIds: [],
        },
        editionId: EDITION.id,
        publishedAt: null,
      },
    ]);
    const result = await publishBulletin({ id: BULLETIN_ID });
    expect(result).toMatchObject({ ok: false });
  });

  it("stamps, fans out and audits in one unit", async () => {
    db.seed("bulletins", [
      {
        id: BULLETIN_ID,
        title: "Gate opens Sunday",
        audience: { kind: "org_internal" },
        editionId: EDITION.id,
        publishedAt: null,
      },
    ]);
    seedAudienceContext();

    const result = await publishBulletin({ id: BULLETIN_ID });

    expect(result).toEqual({ ok: true });
    expect(
      (db.recorded("update", "bulletins")[0]?.values as { publishedAt: Date })
        .publishedAt,
    ).toBeInstanceOf(Date);
    expect(db.inserted("notifications")).toHaveLength(1);
    expect(db.inserted("audit_events")).toMatchObject({
      action: "bulletin.publish",
      subject: BULLETIN_ID,
    });
  });
});

describe("setBulletinPinned", () => {
  it("refuses without `update` on bulletins", async () => {
    requireOrgSession.mockRejectedValue(new Error("Not authorised."));
    await expect(
      setBulletinPinned({ id: BULLETIN_ID, pinned: true }),
    ).resolves.toEqual({ ok: false, error: "Not authorised." });
    expect(requireOrgSession).toHaveBeenCalledWith({
      capability: "update",
      domain: "bulletins",
    });
  });

  it("toggles the pin and records which way", async () => {
    await setBulletinPinned({ id: BULLETIN_ID, pinned: true });
    expect(db.recorded("update", "bulletins")[0]?.values).toMatchObject({
      pinned: true,
    });
    expect(db.inserted("audit_events")).toMatchObject({
      action: "bulletin.pin",
      meta: { pinned: true },
    });
  });
});

describe("bulletin read models", () => {
  const ROW = {
    id: BULLETIN_ID,
    title: "Gate opens Sunday",
    bodyMd: "Bring water.",
    audience: { kind: "org_internal" },
    pinned: false,
    publishedAt: new Date("2026-11-01T00:00:00Z"),
    createdAt: new Date("2026-10-30T00:00:00Z"),
    updatedAt: new Date("2026-11-01T00:00:00Z"),
  };

  it("returns nothing env-lessly rather than crashing the page", async () => {
    delete process.env.DATABASE_URL;
    await expect(listBulletins()).resolves.toEqual([]);
    await expect(getBulletin(BULLETIN_ID)).resolves.toBeNull();
    expect(db.calls).toEqual([]);
  });

  it("carries the read rate off the notification fan-out", async () => {
    db.seed("bulletins", [ROW]);
    db.seed("notifications", [{ bulletinId: BULLETIN_ID, sent: 40, read: 12 }]);

    const [summary] = await listBulletins();

    expect(summary).toMatchObject({
      id: BULLETIN_ID,
      audienceLabel: "Org members (internal)",
      sentCount: 40,
      readCount: 12,
    });
  });

  it("reports a zero tally for a bulletin nobody has received", async () => {
    // A draft has no notification rows at all; 0/0 is the honest answer and
    // `undefined/undefined` on the card is not.
    db.seed("bulletins", [{ ...ROW, publishedAt: null }]);
    db.seed("notifications", []);

    const [summary] = await listBulletins();
    expect(summary).toMatchObject({ sentCount: 0, readCount: 0 });
  });

  it("returns null for an id that does not exist", async () => {
    db.seed("bulletins", []);
    await expect(getBulletin(BULLETIN_ID)).resolves.toBeNull();
    // ...and it did not go on to aggregate notifications for a row it does not
    // have.
    expect(db.recorded("select", "notifications")).toHaveLength(0);
  });

  it("counts ONE bulletin's tally in SQL rather than fetching every bulletin", async () => {
    // It used to be a filter over `listBulletins()`, so opening one bulletin
    // fetched every bulletin row in the deployment — 20 000-character bodies
    // included — and aggregated every bulletin notification ever sent.
    db.seed("bulletins", [ROW]);
    db.seed("notifications", [{ sent: 40, read: 12 }]);

    const summary = await getBulletin(BULLETIN_ID);

    expect(summary).toMatchObject({ sentCount: 40, readCount: 12 });
    const [tally] = db.recorded("select", "notifications");
    expect(tally?.methods).not.toContain("groupBy");
  });
});
