import { describe, it, expect, beforeEach, vi } from "vitest";
import { encrypt } from "@quagga/db/crypto";
import { dbMock } from "@/test/db-mock";
import { afterTasks, flushAfterTasks, resetNextMocks } from "@/test/next-mocks";

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());
vi.mock("next/server", async () =>
  (await import("@/test/next-mocks")).nextServerMock(),
);

// The resolver decrypts, so the process needs a key. Set before the first
// encrypt/decrypt — `@quagga/db/crypto` derives and caches it lazily.
process.env.PGCRYPTO_KEY = "test-pgcrypto-key-16+";

const { resolveMedicalNotesForViewer } = await import("../medical-access");

const EDITION = "eeeeeeee-0000-0000-0000-000000000000";
const VIEWER = "aaaaaaaa-0000-0000-0000-000000000001";
const SUBJECT = "bbbbbbbb-0000-0000-0000-000000000002";
const CAMP_A = "11111111-1111-1111-1111-111111111111";
const CAMP_B = "22222222-2222-2222-2222-222222222222";
const ORG_ONE = "0f9a0000-0000-0000-0000-00000000000a";
const ORG_TWO = "0f9a0000-0000-0000-0000-00000000000b";
const REGISTRATIONS_DEPT = "dddddddd-0000-0000-0000-00000000000r";
const SUPPLIERS_DEPT = "dddddddd-0000-0000-0000-00000000000s";

const NOTES = "Type 1 diabetic. Insulin in the green cooler, camp kitchen.";

interface MembershipRow {
  id: string;
  userId: string;
  groupId: string;
  role: string;
}

function membership(
  userId: string,
  groupId: string,
  role: string,
  id = `m-${groupId}-${userId}`,
): MembershipRow {
  return { id, userId, groupId, role };
}

/** The two department-ownership rows the resolver's org branch reads. Domains
 * are owned by DIFFERENT departments here on purpose — that separation is what
 * the `registrations` scoping test turns on. */
const DOMAIN_OWNERS = [
  {
    domain: "registrations",
    departmentId: REGISTRATIONS_DEPT,
    departmentName: "Registrations",
  },
  {
    domain: "suppliers",
    departmentId: SUPPLIERS_DEPT,
    departmentName: "Suppliers",
  },
];

function read(viewerUserId = VIEWER, subjectUserId = SUBJECT) {
  return resolveMedicalNotesForViewer({
    viewerUserId,
    subjectUserId,
    editionId: EDITION,
  });
}

beforeEach(() => {
  dbMock.reset();
  resetNextMocks();
});

describe("resolveMedicalNotesForViewer — the camp branch", () => {
  it("REFUSES a lead of camp A reading a member of camp B, and never reads the row", async () => {
    // The pure predicate is exhaustively tested in @quagga/core. What is only
    // testable here is that the resolver assembles the context it judges — and
    // that the refusal happens BEFORE the ciphertext is fetched, so a bug in
    // the projection below cannot leak what the predicate refused.
    dbMock.queue(
      [{ id: ORG_ONE }],
      [
        membership(VIEWER, CAMP_A, "lead"),
        membership(SUBJECT, CAMP_B, "member"),
      ],
    );

    const result = await read();
    expect(result).toEqual({ visible: false, notes: null, unreadable: false });
    expect(dbMock.queries.map((q) => q.kind)).toEqual(["select", "select"]);
  });

  it("gives a lead of the subject's OWN camp the notes, and queues exactly one audit row", async () => {
    dbMock.queue(
      [{ id: ORG_ONE }],
      [
        membership(VIEWER, CAMP_A, "lead"),
        membership(SUBJECT, CAMP_A, "member"),
      ],
      [{ medicalNotes: encrypt(NOTES) }],
    );

    const result = await read();
    expect(result).toEqual({ visible: true, notes: NOTES, unreadable: false });

    // The audit is deferred, not skipped: nothing has been written at the point
    // the notes are returned, which is the whole point of `after()` on an
    // emergency read.
    expect(dbMock.queriesOfKind("insert")).toHaveLength(0);
    expect(afterTasks).toHaveLength(1);

    await flushAfterTasks();
    const audit = dbMock.onlyQuery("insert");
    expect(audit.arg("values")).toMatchObject({
      actorId: VIEWER,
      subject: SUBJECT,
      action: "bio.medical.view",
      // WHY the access was allowed, not just that it was — the trail has to
      // survive the role being changed afterwards.
      meta: { basis: "camp_lead" },
    });
  });

  it("reports ciphertext it cannot decrypt as unreadable, not as an empty field", async () => {
    // Three-state, and this is the state that matters. `null` renders as the
    // affirmative "no medical notes on file"; handing that to a medic looking
    // at a burner who wrote something is the same failure as a false all-clear.
    dbMock.queue(
      [{ id: ORG_ONE }],
      [
        membership(VIEWER, CAMP_A, "lead"),
        membership(SUBJECT, CAMP_A, "member"),
      ],
      [{ medicalNotes: "zzzz" }],
    );

    expect(await read()).toEqual({
      visible: true,
      notes: null,
      unreadable: true,
    });
    // Nothing was disclosed, so nothing is audited.
    expect(afterTasks).toHaveLength(0);
  });
});

describe("resolveMedicalNotesForViewer — what is and is not an access event", () => {
  it("does NOT audit a burner reading their own notes", async () => {
    dbMock.queue(
      [{ id: ORG_ONE }],
      [membership(VIEWER, CAMP_A, "member")],
      [{ medicalNotes: encrypt(NOTES) }],
    );

    const result = await read(VIEWER, VIEWER);
    expect(result.notes).toBe(NOTES);
    // Reading your own data is not an access event. Recording it would fill the
    // one trail that answers "who saw my medical information?" with the answer
    // "you did".
    expect(afterTasks).toHaveLength(0);
  });

  it("does NOT audit a read of an EMPTY medical field, even for someone else", async () => {
    dbMock.queue(
      [{ id: ORG_ONE }],
      [
        membership(VIEWER, CAMP_A, "lead"),
        membership(SUBJECT, CAMP_A, "member"),
      ],
      [{ medicalNotes: null }],
    );

    expect(await read()).toEqual({
      visible: true,
      notes: null,
      unreadable: false,
    });
    expect(afterTasks).toHaveLength(0);
  });

  it("returns the notes even when the audit write fails — the read never waits on the log", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMock.queue(
      [{ id: ORG_ONE }],
      [
        membership(VIEWER, CAMP_A, "lead"),
        membership(SUBJECT, CAMP_A, "member"),
      ],
      [{ medicalNotes: encrypt(NOTES) }],
      new Error("audit_events insert failed"),
    );

    const result = await read();
    expect(result.notes).toBe(NOTES);

    // Fails OPEN, deliberately: nobody should wait on a log row to find out
    // someone is diabetic. The failure is swallowed, but it IS logged.
    await expect(flushAfterTasks()).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("resolveMedicalNotesForViewer — recognising org groups", () => {
  it("does not grant access THROUGH a second org group", async () => {
    // The schema's unique index is on (kind, name_normalized), so more than one
    // `kind: 'org'` row is permitted. Recognising only one of them failed OPEN:
    // the unrecognised org group counted as a camp for both parties, and the
    // intersection then granted medical access through the org group itself.
    dbMock.queue(
      [{ id: ORG_ONE }, { id: ORG_TWO }],
      [
        membership(VIEWER, ORG_TWO, "lead"),
        membership(SUBJECT, ORG_TWO, "member"),
      ],
      [], // org role grants
      DOMAIN_OWNERS,
    );

    expect(await read()).toEqual({
      visible: false,
      notes: null,
      unreadable: false,
    });
  });

  it("keeps the STRONGEST org role, so the answer does not depend on row order", async () => {
    // A viewer with rows on several org groups. A later non-qualifying row must
    // not overwrite an earlier qualifying one, or the outcome becomes a
    // function of whatever order Postgres happened to return.
    const rows = [
      membership(VIEWER, ORG_ONE, "god", "org-1"),
      membership(VIEWER, ORG_TWO, "member", "org-2"),
    ];

    for (const ordered of [rows, [...rows].reverse()]) {
      dbMock.reset();
      resetNextMocks();
      dbMock.queue(
        [{ id: ORG_ONE }, { id: ORG_TWO }],
        ordered,
        [],
        DOMAIN_OWNERS,
        [{ medicalNotes: encrypt(NOTES) }],
      );
      expect(await read()).toEqual({
        visible: true,
        notes: NOTES,
        unreadable: false,
      });
    }
  });
});

describe("resolveMedicalNotesForViewer — the org branch is scoped to registrations", () => {
  const grant = (departmentId: string) => [
    { departmentId, permissions: { personal_information: true } },
  ];

  function queueOrgViewer(grants: unknown[]) {
    dbMock.queue(
      [{ id: ORG_ONE }],
      [
        membership(VIEWER, ORG_ONE, "org_staff"),
        membership(SUBJECT, CAMP_A, "member"),
      ],
      grants,
      DOMAIN_OWNERS,
      [{ medicalNotes: encrypt(NOTES) }],
    );
  }

  it("REFUSES a lead of a department that does not own registrations", async () => {
    // This is the hole the per-domain resolution closed. Flattening every role
    // to `departmentId: null` treated a departmental grant as org-wide, so a
    // Suppliers lead opening any burner's profile in the PARTICIPANT app read
    // medical notes the console would have refused them.
    queueOrgViewer(grant(SUPPLIERS_DEPT));

    expect(await read()).toEqual({
      visible: false,
      notes: null,
      unreadable: false,
    });
  });

  it("permits the same grant when it is scoped to the department that owns registrations", async () => {
    queueOrgViewer(grant(REGISTRATIONS_DEPT));

    const result = await read();
    expect(result.notes).toBe(NOTES);

    await flushAfterTasks();
    expect(dbMock.onlyQuery("insert").arg("values")).toMatchObject({
      meta: { basis: "org_staff" },
    });
  });

  it("REFUSES an org account whose roles grant nothing — the console door is not the safety tier", async () => {
    queueOrgViewer([]);

    expect(await read()).toEqual({
      visible: false,
      notes: null,
      unreadable: false,
    });
  });
});
