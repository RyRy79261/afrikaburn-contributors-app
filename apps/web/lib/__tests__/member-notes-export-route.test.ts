import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { encrypt } from "@quagga/db/crypto";
import { MEMBER_RECORDS_AUDIT } from "@quagga/core";
import { GroupKind, MembershipRole, ProjectRoleKind } from "@quagga/types";
import { dbMock } from "@/test/db-mock";

// The member-notes export ROUTE (#105) over the REAL member-records store and
// a fake database, so the refusals asserted here are the ones @quagga/core
// actually makes — and the headers are the ones a browser actually gets.

vi.mock("@/lib/db", async () =>
  (await import("@/test/db-mock")).dbModuleMock(),
);

const stubs = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  gated: null as string | null,
  dbConfigured: true,
}));

vi.mock("@/lib/session", () => ({
  getCurrentCampUser: async () => stubs.user,
  enforceGate: async () => {
    if (stubs.gated) throw new Error(`NEXT_REDIRECT;replace;${stubs.gated}`);
  },
}));
vi.mock("@/lib/config", () => ({
  isDatabaseConfigured: () => stubs.dbConfigured,
}));
vi.mock("@/lib/roles-store", () => ({
  getMemberPermissions: async () => null,
}));

const { GET } = await import(
  "@/app/(app)/camps/[slug]/member-notes/[userId]/export/route"
);

const LEAD = MembershipRole.enum.lead;
const MEMBER = MembershipRole.enum.member;
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001"; // lead
const REN = "aaaaaaaa-0000-4000-8000-000000000002"; // note-keeper, not a lead
const JABU = "aaaaaaaa-0000-4000-8000-000000000003"; // the subject
const CAMP = "11111111-0000-4000-8000-00000000000a";
const SLUG = "mad-hatters";
const SECRET = "Asked not to be on night shifts this year.";

const campRow = [
  { id: CAMP, name: "Mad Hatters", slug: SLUG, kind: GroupKind.enum.theme_camp },
];
const person = (userId: string, role: string) => ({
  userId,
  membershipId: `m-${userId}`,
  role,
  archivedAt: null,
  username: userId === JABU ? "Jabu" : userId === REN ? "Ren Notfound" : "Alice Hatter",
  sanitizedAt: null,
});
const roles = (grant: Record<string, boolean> | null) => [
  [
    { id: "r-base", kind: ProjectRoleKind.enum.baseline, permissions: {} },
    { id: "r-welfare", kind: ProjectRoleKind.enum.custom, permissions: grant ?? {} },
  ],
  grant ? [{ projectRoleId: "r-welfare" }] : [],
];

function request(
  userId: string = JABU,
  headers: Record<string, string> = {},
  slug: string = SLUG,
) {
  return GET(
    new Request(
      `https://app.example/camps/${slug}/member-notes/${userId}/export`,
      { headers },
    ),
    { params: Promise.resolve({ slug, userId }) },
  );
}

beforeEach(() => {
  dbMock.reset();
  stubs.user = null;
  stubs.gated = null;
  stubs.dbConfigured = true;
  process.env.DATABASE_URL = "postgres://test";
  process.env.PGCRYPTO_KEY = "member-records-test-key-not-a-secret";
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.PGCRYPTO_KEY;
});

describe("GET /camps/[slug]/member-notes/[userId]/export", () => {
  it("a lead downloads a plain-text attachment: no-store, slugged filename, the note's text", async () => {
    stubs.user = { id: ALICE, email: "alice@example.com" };
    dbMock.queue(
      campRow,
      [person(ALICE, LEAD), person(JABU, MEMBER)],
      ...roles(null),
      [
        {
          body: encrypt(SECRET),
          editedByUserId: null,
          createdAt: new Date("2026-10-03T10:00:00Z"),
          updatedAt: new Date("2026-10-03T10:00:00Z"),
        },
      ],
      [],
    );
    const res = await request(JABU, { "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="member-notes-mad-hatters-jabu-\d{4}-\d{2}-\d{2}\.txt"$/,
    );
    const body = await res.text();
    expect(body).toContain(SECRET);
    expect(body).toContain("About: Jabu");
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(1);
    expect(
      (dbMock.writesTo(schema.auditEvents)[0]!.arg("values") as { action: string })
        .action,
    ).toBe(MEMBER_RECORDS_AUDIT.noteExport);
  });

  it("a note-keeper who is not a lead gets the same 404 as a stranger, and no audit row", async () => {
    stubs.user = { id: REN, email: "ren@example.com" };
    dbMock.queue(
      campRow,
      [person(REN, MEMBER), person(JABU, MEMBER)],
      ...roles({ member_notes: true }),
    );
    const res = await request();
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect(await res.text()).toBe("Not found");
    expect(dbMock.queriesTouching(schema.memberNotes)).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  it("the member asking for their own notes is a 404", async () => {
    stubs.user = { id: JABU, email: "jabu@example.com" };
    dbMock.queue(campRow, [person(JABU, MEMBER)], ...roles(null));
    const res = await request(JABU);
    expect(res.status).toBe(404);
    expect(dbMock.queriesTouching(schema.memberNotes)).toHaveLength(0);
  });

  it("signed out, no database, or a malformed id: 404 before anything is read", async () => {
    expect((await request()).status).toBe(404);
    stubs.user = { id: ALICE, email: "alice@example.com" };
    expect((await request("not-a-uuid")).status).toBe(404);
    stubs.dbConfigured = false;
    expect((await request()).status).toBe(404);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("refuses a request the browser marks as cross-site, before the session is read", async () => {
    stubs.user = { id: ALICE, email: "alice@example.com" };
    for (const site of ["cross-site", "same-site"]) {
      const res = await request(JABU, { "sec-fetch-site": site });
      expect(res.status).toBe(404);
    }
    expect(dbMock.queries).toHaveLength(0);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  it("with no encryption key, a lead gets a 503 with the reason and no file", async () => {
    delete process.env.PGCRYPTO_KEY;
    stubs.user = { id: ALICE, email: "alice@example.com" };
    dbMock.queue(
      campRow,
      [person(ALICE, LEAD), person(JABU, MEMBER)],
      ...roles(null),
    );
    const res = await request();
    expect(res.status).toBe(503);
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.text()).toMatch(/encryption key/i);
    expect(dbMock.writesTo(schema.auditEvents)).toHaveLength(0);
  });

  // Regression (review): Next answers HEAD with GET when HEAD is undefined,
  // so a HEAD ran a full export and wrote an audit row.
  it("HEAD is refused without touching the database", async () => {
    stubs.user = { id: ALICE, email: "alice@example.com" };
    const { HEAD } = await import(
      "@/app/(app)/camps/[slug]/member-notes/[userId]/export/route"
    );
    const res = HEAD();
    expect(res.status).toBe(405);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("sends a gated lead to their blocking action first", async () => {
    stubs.user = { id: ALICE, email: "alice@example.com" };
    stubs.gated = "/onboarding";
    await expect(request()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(dbMock.queries).toHaveLength(0);
  });
});
