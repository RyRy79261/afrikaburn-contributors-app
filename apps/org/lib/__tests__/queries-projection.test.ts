import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";
import {
  CAMPS_LEAD,
  GOD,
  NO_ROLES,
  PERSONAL_READER,
  READER,
  SUPPLIERS_LEAD,
} from "./support/actors";

/**
 * EVERY CONSOLE READ DECIDES PERSONAL INFORMATION AT THE SELECT, not in the JSX
 * — precisely so a refused caller's row never contains a phone number, an
 * emergency contact or a medical note, and therefore no RSC payload does
 * either. `org-rank-enforcement.test.ts` asserts that the SOURCE TEXT still
 * spells that rule out; this file executes it. A refactor that kept the wording
 * and changed the returned object would ship contact details to every staff
 * page load and leave every source-text test green.
 *
 * ── THE PAIRING RULE ─────────────────────────────────────────────────────────
 *
 * Every authorisation assertion here comes in a PAIR: the personal column is
 * SEEDED PRESENT, the granted actor receives it, the refused actor does not.
 * Without the positive half a test passes against a module that never selected
 * the column at all, which proves nothing about the guard. The fake database
 * projects each seeded row down to the keys the module actually selected (see
 * support/fake-db.ts), so dropping the conditional from a select puts the
 * column back in the refused caller's row and the pair goes red.
 *
 * ── WHAT THIS FILE DOES NOT PROVE ────────────────────────────────────────────
 *
 * Nothing about SQL. Not a WHERE clause, not a join, not an ordering. Those keep
 * their proof in `pnpm e2e:local`.
 */

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
}));

import { encrypt } from "@quagga/db/crypto";
import {
  getActiveEdition,
  getCampCategories,
  getOrgAccessRoster,
  getOrgRoleImpacts,
  getOrgRolesOverview,
  getOverviewCounts,
  getRegistrationDecisionLog,
  getRegistrationDetail,
  getRegistrationOfficers,
  getRegistrationRoster,
  getRegistrationRows,
  getRosterMemberDetail,
  getStatusBoard,
  getSupplierNotes,
  getSuppliersOverview,
  getWranglerBoard,
  getWranglerCandidates,
  getWranglerForGroup,
  listAssignableOrgRoles,
  searchAccounts,
} from "@/lib/queries";

const ENV = { ...process.env };

const EDITION = {
  id: "ed-2027",
  name: "AfrikaBurn 2027",
  year: 2027,
  startDate: "2027-04-26",
  endDate: "2027-05-02",
};

beforeEach(() => {
  db = fakeDb();
  // The medical column is encrypted at rest; the round trip is only a real
  // assertion with a real key.
  process.env.PGCRYPTO_KEY = "test-key-at-least-16-chars-long";
});

afterEach(() => {
  process.env = { ...ENV };
});

/** The projection keys a recorded select asked for. */
function selectedColumns(table: string, nth = 0): string[] {
  const call = db.recorded("select", table)[nth];
  if (!call) throw new Error(`no select from ${table} was recorded`);
  return call.columns ?? [];
}

describe("getActiveEdition", () => {
  it("returns the active edition, or null when none is seeded", async () => {
    db.seed("editions", [EDITION]);
    await expect(getActiveEdition()).resolves.toEqual(EDITION);

    db.seed("editions", []);
    // A fresh database has no edition and the console must render anyway — the
    // empty-state copy is the correct first-boot answer, not a crash.
    await expect(getActiveEdition()).resolves.toBeNull();
  });
});

describe("getOverviewCounts", () => {
  it("tallies each registration status and reports the group counts", async () => {
    db.seed("editions", [EDITION]);
    db.seed("registrations", [
      { status: "submitted" },
      { status: "submitted" },
      { status: "approved" },
      { status: "withdrawn" },
    ]);
    const counts = await getOverviewCounts();

    expect(counts.registrationsTotal).toBe(4);
    expect(counts.registrationsByStatus).toEqual({
      draft: 0,
      submitted: 2,
      under_review: 0,
      changes_requested: 0,
      approved: 1,
      rejected: 0,
      withdrawn: 1,
    });
  });

  it("returns the ZEROED status map and no registrations without an edition", async () => {
    // Not an empty object: the tiles render one row per status, and a missing
    // key would render "undefined" rather than 0 on a fresh deployment.
    db.seed("editions", []);
    const counts = await getOverviewCounts();

    expect(counts.edition).toBeNull();
    expect(counts.registrationsTotal).toBe(0);
    expect(Object.values(counts.registrationsByStatus)).toEqual([
      0, 0, 0, 0, 0, 0, 0,
    ]);
    // It must not have gone looking for registrations of no edition.
    expect(db.recorded("select", "registrations")).toHaveLength(0);
  });

  it("reports camps and suppliers from the count queries", async () => {
    db = fakeDb({ counts: { groups: 12, suppliers: 30 } });
    db.seed("editions", []);
    const counts = await getOverviewCounts();
    expect(counts).toMatchObject({ camps: 12, suppliers: 30 });
  });
});

describe("searchAccounts — the personal column is never selected OR matched", () => {
  const ACCOUNT = {
    userId: "user-1",
    username: "alice",
    email: "alice@example.com",
    role: "org_staff",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };

  it("gives the email to a caller who may read personal information", async () => {
    db.seed("users", [ACCOUNT]);
    const [row] = await searchAccounts("org-1", "alice", PERSONAL_READER);
    expect(row?.email).toBe("alice@example.com");
    expect(selectedColumns("users")).toContain("email");
  });

  it("withholds it from a caller who may not — the column is never selected", async () => {
    // The seeded row HAS the email. This only passes because the module left it
    // out of the projection.
    db.seed("users", [ACCOUNT]);
    const [row] = await searchAccounts("org-1", "alice", READER);
    expect(row?.email).toBeNull();
    expect(selectedColumns("users")).not.toContain("email");
    // The handle stays: usernames are the org's own structure, not personal
    // information, and a search that returned nothing at all would look broken.
    expect(row?.username).toBe("alice");
  });

  it("still resolves the account's rank and roles for a refused caller", async () => {
    // Roles are the ORG'S structure, not a fact about a person. Withholding
    // them would make the accounts table unreadable for the rank that most
    // often audits it.
    db.seed("users", [ACCOUNT]);
    db.seed("org_role_assignments", [
      {
        userId: "user-1",
        id: "role-1",
        key: "suppliers.lead",
        name: "Suppliers lead",
        kind: "seeded",
        color: "amber",
        departmentId: "dept-suppliers",
        departmentName: "Suppliers",
        permissions: { read: true, delete: true },
        sort: 0,
      },
    ]);

    const [row] = await searchAccounts("org-1", "", READER);

    expect(row?.role).toBe("org_staff");
    expect(row?.roles).toEqual([
      {
        id: "role-1",
        name: "Suppliers lead",
        kind: "seeded",
        color: "amber",
        departmentId: "dept-suppliers",
        departmentName: "Suppliers",
      },
    ]);
    // ...and the resolved union is computed with the same core resolver the
    // server actions refuse with, so the table can never advertise an access
    // the console would refuse.
    const del = row?.capabilities.find((c) => c.capability === "delete");
    expect(del?.departments).toEqual(["Suppliers"]);
    expect(del?.domains).toEqual(["suppliers", "supplier_documents"]);
  });

  it("resolves NO capabilities for an account that holds no console door", async () => {
    db.seed("users", [{ ...ACCOUNT, role: null }]);
    const [row] = await searchAccounts("org-1", "", GOD);
    expect(row?.role).toBeNull();
    expect(row?.capabilities).toEqual([]);
  });

  it("does not query for roles when the search found nobody", async () => {
    db.seed("users", []);
    await expect(searchAccounts("org-1", "nobody", GOD)).resolves.toEqual([]);
    expect(db.recorded("select", "org_role_assignments")).toHaveLength(0);
  });
});

describe("getOrgRolesOverview / listAssignableOrgRoles", () => {
  beforeEach(() => {
    db.seed("org_departments", [
      {
        id: "dept-1",
        key: "suppliers",
        name: "Suppliers",
        description: "Supply chain",
      },
    ]);
    db.seed("org_roles", [
      {
        id: "role-1",
        key: "suppliers.lead",
        name: "Suppliers lead",
        description: null,
        kind: "seeded",
        color: "amber",
        departmentId: "dept-1",
        departmentName: "Suppliers",
        permissions: { read: true, delete: true, manage_accounts: true },
      },
      {
        id: "role-2",
        key: "reviewer",
        name: "Reviewer",
        description: null,
        kind: "custom",
        color: "teal",
        departmentId: null,
        departmentName: null,
        permissions: { read: true },
      },
    ]);
    db.seed("org_role_assignments", [{ orgRoleId: "role-1", holders: 3 }]);
    db.seed("org_department_domains", [
      {
        domain: "suppliers",
        departmentId: "dept-1",
        departmentName: "Suppliers",
      },
    ]);
  });

  it("groups roles under their department and lists the org-wide ones apart", async () => {
    const overview = await getOrgRolesOverview("org-1");

    expect(overview.departments).toHaveLength(1);
    expect(overview.departments[0]?.roles.map((r) => r.id)).toEqual(["role-1"]);
    expect(overview.departments[0]?.domains).toEqual(["suppliers"]);
    expect(overview.orgWideRoles.map((r) => r.id)).toEqual(["role-2"]);
  });

  it("reports the holder count, which is what makes deleting an informed decision", async () => {
    // Deleting a role cascades its assignments away. "3 people hold this" is the
    // difference between a decision and a surprise.
    const overview = await getOrgRolesOverview("org-1");
    expect(overview.departments[0]?.roles[0]?.holders).toBe(3);
    expect(overview.orgWideRoles[0]?.holders).toBe(0);
  });

  it("names the domains NOBODY owns, so the gap is visible rather than inferred", async () => {
    const overview = await getOrgRolesOverview("org-1");
    // Unowned domains are reachable by org-wide roles alone; a department-scoped
    // role reaches nothing there, which is the state a fresh console is in.
    expect(overview.unownedDomains).toContain("registrations");
    expect(overview.unownedDomains).not.toContain("suppliers");
  });

  it("sanitizes a stored permission no role may hold", async () => {
    // `manage_accounts` was seeded on role-1 above. It is not a grantable
    // capability, and a hand-written row must not be able to advertise it.
    const overview = await getOrgRolesOverview("org-1");
    const capabilities = overview.departments[0]?.roles[0]?.capabilities ?? [];
    expect(capabilities).toEqual(["read", "delete"]);
  });

  it("carries what a scoped role actually reaches into the assignment picker", async () => {
    // The dialog previews the union of a draft selection with the same resolver
    // the server will use, and a department-scoped grant cannot be resolved
    // without knowing what its department owns — including when that is nothing.
    const roles = await listAssignableOrgRoles();
    expect(roles.find((r) => r.id === "role-1")?.departmentDomains).toEqual([
      "suppliers",
    ]);
    expect(roles.find((r) => r.id === "role-2")?.departmentDomains).toEqual([]);
  });
});

describe("getOrgRoleImpacts", () => {
  it("refuses a non-System-manager BEFORE issuing any query", async () => {
    // It carries the labels — the email addresses — of the people who would
    // lose access. A page that forgot to gate the call must get a refusal
    // rather than a leak, so the predicate runs here too.
    await expect(getOrgRoleImpacts("org-1", PERSONAL_READER)).rejects.toThrow(
      /see who would lose access/,
    );
    expect(db.calls).toEqual([]);
  });

  it("tallies who would lose access, per role and per department", async () => {
    db.seed("org_role_assignments", [
      {
        userId: "user-1",
        email: "alice@example.com",
        username: "alice",
        roleId: "role-1",
        departmentId: "dept-1",
      },
      {
        userId: "user-2",
        email: null,
        username: "ren",
        roleId: "role-1",
        departmentId: "dept-1",
      },
    ]);

    const impacts = await getOrgRoleImpacts("org-1", GOD);

    expect(impacts.byRole["role-1"]?.people).toBe(2);
    expect(impacts.byDepartment["dept-1"]?.people).toBe(2);
    // Both hold nothing else, so deleting the role leaves them able to sign in
    // and do nothing — the number that decides whether the dialog is a
    // formality or a warning.
    expect(impacts.byRole["role-1"]?.leftWithNothing).toBe(2);
    // The username is the fallback label so a row is never anonymous on the
    // confirm dialog.
    expect(impacts.byRole["role-1"]?.labels).toContain("alice@example.com");
    expect(impacts.byRole["role-1"]?.labels).toContain("ren");
  });

  it("falls back to a stated label for an account with neither", async () => {
    db.seed("org_role_assignments", [
      {
        userId: "user-3",
        email: null,
        username: null,
        roleId: "role-1",
        departmentId: null,
      },
    ]);
    const impacts = await getOrgRoleImpacts("org-1", GOD);
    expect(impacts.byRole["role-1"]?.labels).toContain(
      "an account with no address",
    );
  });
});

describe("getOrgAccessRoster", () => {
  const MEMBERS = [
    {
      userId: "user-1",
      username: "alice",
      email: "alice@example.com",
      role: "god",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
      userId: "user-2",
      username: "ren",
      email: "ren@example.com",
      role: "org_staff",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    },
  ];

  it("gives the addresses to a personal-information reader", async () => {
    db.seed("memberships", MEMBERS);
    const roster = await getOrgAccessRoster("org-1", PERSONAL_READER);
    expect(roster.members.map((m) => m.email)).toEqual([
      "alice@example.com",
      "ren@example.com",
    ]);
  });

  it("withholds them from a plain reader while KEEPING the counts", async () => {
    // How many people hold a rank is a fact about the deployment, not about a
    // person — which is what lets an engineer see there is exactly one System
    // manager without being told who.
    db.seed("memberships", MEMBERS);
    const roster = await getOrgAccessRoster("org-1", READER);

    expect(roster.members.map((m) => m.email)).toEqual([null, null]);
    expect(selectedColumns("memberships")).not.toContain("email");
    expect(roster.systemManagerCount).toBe(1);
  });

  it("asks the ACCOUNTS domain, not the page's own", async () => {
    // The roster lives on the System panel, but the rows it carries are accounts
    // and their addresses. A Suppliers lead holds personal_information in their
    // own department and must still be refused here — page access must never
    // imply the personal columns.
    db.seed("memberships", MEMBERS);
    const roster = await getOrgAccessRoster("org-1", SUPPLIERS_LEAD);
    expect(roster.members.map((m) => m.email)).toEqual([null, null]);
  });
});

describe("getRegistrationRows", () => {
  it("annotates each row with its cohort from prior registrations", async () => {
    db.seed("registrations", [
      [
        {
          id: "reg-1",
          status: "submitted",
          groupId: "group-1",
          groupName: "Mad Hatters",
          groupKind: "theme_camp",
          groupSlug: "mad-hatters",
          soundRaw: "medium",
          expectedPopulation: 40,
          submittedAt: new Date("2026-11-01T00:00:00Z"),
          updatedAt: new Date("2026-11-02T00:00:00Z"),
        },
        {
          id: "reg-2",
          status: "draft",
          groupId: "group-2",
          groupName: "Camp 404",
          groupKind: "theme_camp",
          groupSlug: "camp-404",
          soundRaw: null,
          expectedPopulation: null,
          submittedAt: null,
          updatedAt: new Date("2026-11-03T00:00:00Z"),
        },
      ],
      // The prior-registrations read: group-1 registered before, group-2 did not.
      [{ groupId: "group-1" }],
    ]);

    const rows = await getRegistrationRows(EDITION);

    expect(rows.map((r) => r.cohort)).toEqual(["returning", "new"]);
    expect(rows[0]?.groupName).toBe("Mad Hatters");
  });
});

describe("getRegistrationDetail", () => {
  const REGISTRATION = {
    id: "reg-1",
    groupId: "group-1",
    editionId: EDITION.id,
    status: "under_review",
    decidedByUserId: "user-9",
    s1ContactEmail: "camp@example.com",
    s1AltContactName: "Ren Notfound",
    s1AltContactPhone: "+27 82 000 0000",
    s1AltContactEmail: "ren@example.com",
    s2LntLeadName: "Jabu",
    s2LntLeadPhone: "+27 83 111 1111",
    s2LntLeadEmail: "jabu@example.com",
    s4ExpectedPopulation: 40,
  };

  function seedDetail() {
    db.seed("registrations", [[REGISTRATION], []]);
    db.seed("groups", [
      {
        id: "group-1",
        name: "Mad Hatters",
        kind: "theme_camp",
        slug: "mad-hatters",
        description: null,
        joinability: "open",
      },
    ]);
    db.seed("editions", [
      { id: EDITION.id, name: EDITION.name, year: EDITION.year },
    ]);
    db.seed("section_reviews", [
      {
        id: "rev-1",
        sectionKey: "s5",
        status: "open",
        comment: "Sound plan needs work",
        createdAt: new Date("2026-11-04T00:00:00Z"),
        reviewerEmail: "reviewer@example.com",
      },
    ]);
    db.seed("section_review_replies", []);
    db.seed("supplier_declarations", [
      {
        supplierId: "sup-1",
        name: "LosKop Catering",
        services: "Catering",
        standing: "good",
        note: "Booked",
      },
    ]);
    db.seed("users", [{ email: "decider@example.com" }]);
  }

  it("assembles the group, edition, reviews and supplier declarations", async () => {
    seedDetail();
    const detail = await getRegistrationDetail("reg-1", GOD);

    expect(detail?.group.name).toBe("Mad Hatters");
    expect(detail?.edition.year).toBe(2027);
    expect(detail?.reviews).toHaveLength(1);
    expect(detail?.reviews[0]?.comment).toBe("Sound plan needs work");
    expect(detail?.supplierDeclarations[0]?.name).toBe("LosKop Catering");
  });

  it("gives the camp's contact people and the decider to a granted caller", async () => {
    seedDetail();
    const detail = await getRegistrationDetail("reg-1", CAMPS_LEAD);

    expect(detail?.registration.s1AltContactPhone).toBe("+27 82 000 0000");
    expect(detail?.registration.s2LntLeadEmail).toBe("jabu@example.com");
    expect(detail?.reviews[0]?.reviewerEmail).toBe("reviewer@example.com");
    expect(detail?.decidedByEmail).toBe("decider@example.com");
  });

  it("nulls the contact block for a refused caller and never selects it", async () => {
    // The row keeps its SHAPE — same type for both callers — with the contact
    // keys spread back as nulls. The review itself (sound, placement,
    // suppliers) is entirely readable, which is the point of every rank having
    // access to the work.
    seedDetail();
    const detail = await getRegistrationDetail("reg-1", SUPPLIERS_LEAD);

    expect(detail?.registration.s1AltContactPhone).toBeNull();
    expect(detail?.registration.s1AltContactEmail).toBeNull();
    expect(detail?.registration.s2LntLeadPhone).toBeNull();
    expect(detail?.registration.s1ContactEmail).toBeNull();
    // ...and the non-personal answers survive.
    expect(detail?.registration.status).toBe("under_review");
    expect(detail?.registration.s4ExpectedPopulation).toBe(40);
    // Selected by name, so a column added to the schema later is included
    // automatically rather than silently vanishing.
    expect(selectedColumns("registrations")).not.toContain("s1AltContactPhone");
    expect(selectedColumns("registrations")).toContain("status");
    // Neither the reviewer nor the decider is named, and the decider is not
    // even looked up.
    expect(detail?.reviews[0]?.reviewerEmail).toBeNull();
    expect(detail?.decidedByEmail).toBeNull();
    expect(db.recorded("select", "users")).toHaveLength(0);
  });

  it("returns null for a registration that does not exist", async () => {
    db.seed("registrations", [[], []]);
    await expect(getRegistrationDetail("nope", GOD)).resolves.toBeNull();
  });

  it("labels org-staff replies as one voice and a departed author by name", async () => {
    seedDetail();
    db.seed("section_review_replies", [
      {
        id: "rep-1",
        reviewId: "rev-1",
        authorUserId: "user-org",
        body: "Please revise",
        createdAt: new Date("2026-11-05T00:00:00Z"),
      },
      {
        id: "rep-2",
        reviewId: "rev-1",
        authorUserId: "user-gone",
        body: "Revised",
        createdAt: new Date("2026-11-06T00:00:00Z"),
      },
      {
        id: "rep-3",
        reviewId: "rev-1",
        authorUserId: null,
        body: "Anonymous",
        createdAt: new Date("2026-11-07T00:00:00Z"),
      },
    ]);
    // The author lookup, then the decider lookup — same table, two reads.
    db.seed("users", [
      [
        { userId: "user-org", username: "abstaff", sanitizedAt: null },
        {
          userId: "user-gone",
          username: null,
          sanitizedAt: new Date("2026-08-01T00:00:00Z"),
        },
      ],
      [{ email: "decider@example.com" }],
    ]);
    db.seed("memberships", [{ userId: "user-org" }]);

    const detail = await getRegistrationDetail("reg-1", GOD);
    const replies = detail?.reviews[0]?.replies ?? [];

    // Org staff collapse to one voice, mirroring the camp-side thread.
    expect(replies[0]).toMatchObject({ authorName: "AfrikaBurn", isOrg: true });
    // A sanitized author is never named — publicMemberName, everywhere.
    expect(replies[1]).toMatchObject({
      authorName: "Departed Burner",
      isOrg: false,
    });
    expect(replies[2]?.authorName).toBe("A camp member");
  });
});

describe("getRegistrationOfficers — the one consented disclosure channel", () => {
  const OFFICER = {
    officerKey: "safety",
    officerName: "Safety officer",
    emoji: "🦺",
    consent: "accepted",
    username: "alice",
    sanitizedAt: null,
    bioEmail: "alice.bio@example.com",
    phone: "+27 82 000 0000",
    userEmail: "alice@example.com",
  };

  it("discloses the officer's phone and email to a granted caller", async () => {
    db.seed("member_role_assignments", [OFFICER]);
    const [row] = await getRegistrationOfficers("group-1", EDITION.id, GOD);
    expect(row?.phone).toBe("+27 82 000 0000");
    expect(row?.email).toBe("alice.bio@example.com");
  });

  it("falls back to the account email when the bio carries none", async () => {
    db.seed("member_role_assignments", [{ ...OFFICER, bioEmail: null }]);
    const [row] = await getRegistrationOfficers("group-1", EDITION.id, GOD);
    expect(row?.email).toBe("alice@example.com");
  });

  it("gives a refused caller the coverage answer WITHOUT the contact details", async () => {
    // The consent an officer gave was to AfrikaBurn's safety and ops people
    // holding their number — which is not everyone who can open the console.
    // Who holds which post IS the coverage answer, and that still reads.
    db.seed("member_role_assignments", [OFFICER]);
    const [row] = await getRegistrationOfficers(
      "group-1",
      EDITION.id,
      SUPPLIERS_LEAD,
    );

    expect(row?.officerKey).toBe("safety");
    expect(row?.displayName).toBe("alice");
    expect(row?.phone).toBeNull();
    expect(row?.email).toBeNull();
    const columns = selectedColumns("member_role_assignments");
    expect(columns).not.toContain("phone");
    expect(columns).not.toContain("bioEmail");
    expect(columns).not.toContain("userEmail");
  });

  it("grants the SAME role its officers when its department owns registrations", async () => {
    // The mirror of the test above, and the half that makes it mean something:
    // a department-scoped grant is refused OUTSIDE its department and honoured
    // INSIDE it. This is the 27 Jul 2026 per-domain rule.
    db.seed("member_role_assignments", [OFFICER]);
    const [row] = await getRegistrationOfficers(
      "group-1",
      EDITION.id,
      CAMPS_LEAD,
    );
    expect(row?.phone).toBe("+27 82 000 0000");
  });

  it("never names a departed officer", async () => {
    db.seed("member_role_assignments", [
      {
        ...OFFICER,
        username: null,
        sanitizedAt: new Date("2026-08-01T00:00:00Z"),
      },
    ]);
    const [row] = await getRegistrationOfficers("group-1", EDITION.id, GOD);
    expect(row?.displayName).toBe("Departed Burner");
  });
});

describe("getRegistrationRoster", () => {
  it("carries no medical column at all — not the notes, not a flag", async () => {
    // The FACT that a named person has declared a health condition is itself
    // special personal information (POPIA s26/27). Rendering a has/has-not flag
    // down forty rows hands a reviewer a complete census of who has disclosed,
    // in one un-audited page load. The query deliberately never selects it, so
    // there is nothing here for a future edit to leak.
    db.seed("memberships", [
      {
        userId: "user-1",
        role: "lead",
        username: "alice",
        sanitizedAt: null,
        medicalNotes: encrypt("asthma"),
      },
    ]);

    const roster = await getRegistrationRoster("group-1");

    expect(roster).toEqual([
      { userId: "user-1", displayName: "alice", role: "lead" },
    ]);
    const columns = selectedColumns("memberships");
    expect(columns).not.toContain("medicalNotes");
    expect(columns).not.toContain("phone");
    expect(JSON.stringify(roster)).not.toContain("asthma");
  });

  it("renders a sanitized member through publicMemberName", async () => {
    db.seed("memberships", [
      {
        userId: "user-1",
        role: "member",
        username: null,
        sanitizedAt: new Date("2026-08-01T00:00:00Z"),
      },
    ]);
    const [row] = await getRegistrationRoster("group-1");
    expect(row?.displayName).toBe("Departed Burner");
  });
});

describe("getRosterMemberDetail — the only org surface that resolves medical notes", () => {
  const MEMBER = {
    userId: "user-1",
    role: "member" as const,
    username: "alice",
    sanitizedAt: null,
  };

  it("decrypts the notes for an authorised read", async () => {
    db.seed("memberships", [
      { ...MEMBER, medicalNotes: encrypt("Severe bee-sting allergy") },
    ]);

    const detail = await getRosterMemberDetail(
      "group-1",
      EDITION.id,
      "user-1",
      {
        includeMedicalNotes: true,
      },
    );

    expect(detail?.medicalNotes).toBe("Severe bee-sting allergy");
    expect(detail?.medicalNotesUnreadable).toBe(false);
  });

  it("neither selects nor decrypts the column for an unauthorised read", async () => {
    // `includeMedicalNotes` is the AUTHORISATION, passed in rather than assumed.
    // Deciding after the decrypt would leave plaintext in render scope behind
    // nothing but a conditional.
    db.seed("memberships", [
      { ...MEMBER, medicalNotes: encrypt("Severe bee-sting allergy") },
    ]);

    const detail = await getRosterMemberDetail(
      "group-1",
      EDITION.id,
      "user-1",
      {
        includeMedicalNotes: false,
      },
    );

    expect(detail?.medicalNotes).toBeNull();
    expect(selectedColumns("memberships")).not.toContain("medicalNotes");
  });

  it("distinguishes 'none recorded' from 'we cannot read this'", async () => {
    // Collapsing the two renders an affirmative all-clear derived from a
    // failure, on a safety path — a wrong or rotated key must never read as
    // "no medical notes on file".
    db.seed("memberships", [{ ...MEMBER, medicalNotes: null }]);
    const none = await getRosterMemberDetail("group-1", EDITION.id, "user-1", {
      includeMedicalNotes: true,
    });
    expect(none).toMatchObject({
      medicalNotes: null,
      medicalNotesUnreadable: false,
    });

    db.seed("memberships", [
      { ...MEMBER, medicalNotes: "not-ciphertext-at-all" },
    ]);
    const broken = await getRosterMemberDetail(
      "group-1",
      EDITION.id,
      "user-1",
      {
        includeMedicalNotes: true,
      },
    );
    expect(broken).toMatchObject({
      medicalNotes: null,
      medicalNotesUnreadable: true,
    });
  });

  it("returns null when the member is not in that group", async () => {
    db.seed("memberships", []);
    await expect(
      getRosterMemberDetail("group-1", EDITION.id, "user-1", {
        includeMedicalNotes: true,
      }),
    ).resolves.toBeNull();
  });
});

describe("getRegistrationDecisionLog", () => {
  const EVENT = {
    id: "audit-1",
    action: "registration.approve",
    meta: { status: "approved" },
    createdAt: new Date("2026-11-10T00:00:00Z"),
    actorEmail: "staff@example.com",
  };

  it("names the deciding staff member for a granted caller", async () => {
    db.seed("audit_events", [EVENT]);
    const [row] = await getRegistrationDecisionLog("reg-1", CAMPS_LEAD);
    expect(row?.actorEmail).toBe("staff@example.com");
  });

  it("keeps the history readable but unattributed for a refused caller", async () => {
    // WHAT was decided and when is org record; WHO decided it is a staff
    // member's email.
    db.seed("audit_events", [EVENT]);
    const [row] = await getRegistrationDecisionLog("reg-1", READER);
    expect(row?.action).toBe("registration.approve");
    expect(row?.meta).toEqual({ status: "approved" });
    expect(row?.actorEmail).toBeNull();
    expect(selectedColumns("audit_events")).not.toContain("actorEmail");
  });
});

describe("getSuppliersOverview", () => {
  it("never selects `contact` for ANY rank", async () => {
    // The leak that was found and fixed: nothing on this screen renders the
    // contact, so withholding it from engineers alone still shipped a named
    // human's phone number in the RSC payload of every staff and god page load.
    // A field nobody renders should not be fetched.
    db.seed("suppliers", [
      {
        id: "sup-1",
        name: "LosKop Catering",
        services: "Catering",
        website: null,
        category: "food",
        returning: "returning",
        standing: "good",
        steps: { docs: "complete" },
        contact: "Alice, +27 82 000 0000",
      },
    ]);
    db.seed("supplier_notes", [{ supplierId: "sup-1", total: 2 }]);

    const rows = await getSuppliersOverview(EDITION.id);

    expect(selectedColumns("suppliers")).not.toContain("contact");
    expect(JSON.stringify(rows)).not.toContain("+27 82 000 0000");
    expect(rows[0]).toMatchObject({
      steps: { docs: "complete" },
      notesCount: 2,
    });
  });

  it("falls back to an empty step map and a zero note count", async () => {
    // A supplier with no onboarding row for this edition is the normal state at
    // the start of a year; `steps ?? {}` is what keeps the progress chip at 0/7
    // rather than crashing the table.
    db.seed("suppliers", [
      {
        id: "sup-2",
        name: "Dust Bunnies Hire",
        services: null,
        website: null,
        category: null,
        returning: null,
        standing: "watch",
        steps: null,
      },
    ]);
    db.seed("supplier_notes", []);

    const [row] = await getSuppliersOverview(null);
    expect(row).toMatchObject({ steps: {}, notesCount: 0 });
  });
});

describe("getSupplierNotes", () => {
  const NOTE = {
    id: "note-1",
    kind: "vetting",
    body: "Quoted for 2027",
    createdAt: new Date("2026-11-01T00:00:00Z"),
    authorEmail: "buyer@example.com",
  };

  it("names the author for a Suppliers lead — their own department", async () => {
    db.seed("supplier_notes", [NOTE]);
    const [row] = await getSupplierNotes("sup-1", SUPPLIERS_LEAD);
    expect(row?.authorEmail).toBe("buyer@example.com");
  });

  it("withholds the author from a plain reader while keeping the note body", async () => {
    // The note is org record about a BUSINESS and every rank reads it; the
    // author's address is a staff member's.
    db.seed("supplier_notes", [NOTE]);
    const [row] = await getSupplierNotes("sup-1", READER);
    expect(row?.body).toBe("Quoted for 2027");
    expect(row?.authorEmail).toBeNull();
    expect(selectedColumns("supplier_notes")).not.toContain("authorEmail");
  });

  it("withholds it from a CAMPS lead — the domain, not the rank, decides", async () => {
    db.seed("supplier_notes", [NOTE]);
    const [row] = await getSupplierNotes("sup-1", CAMPS_LEAD);
    expect(row?.authorEmail).toBeNull();
  });
});

describe("getCampCategories", () => {
  it("reports usage per category and zero for an unused one", async () => {
    db.seed("camp_categories", [
      { id: "cat-1", label: "Food", emoji: "🍲", sort: 0 },
      { id: "cat-2", label: "Sound", emoji: "🔊", sort: 1 },
    ]);
    db.seed("group_categories", [
      { categoryId: "cat-1" },
      { categoryId: "cat-1" },
    ]);

    const rows = await getCampCategories(EDITION.id);

    expect(rows.map((r) => r.usage)).toEqual([2, 0]);
  });
});

describe("getStatusBoard", () => {
  it("returns all-zero derivations without querying when no edition is active", async () => {
    const board = await getStatusBoard(null);
    expect(board.edition).toBeNull();
    expect(board.funnel.total).toBe(0);
    expect(db.calls).toEqual([]);
  });

  it("derives the funnel, coverage and rollups from the seeded rows", async () => {
    db.seed("burner_bios", [
      { completedAt: new Date("2026-10-01T00:00:00Z") },
      { completedAt: null },
    ]);
    db.seed("groups", [
      { kind: "theme_camp", status: "approved", grantsInterest: true },
      { kind: "artwork", status: null, grantsInterest: null },
    ]);
    db.seed("registrations", [
      // funnel read, then the officer-coverage camp read, then the wrangler read
      [{ status: "approved" }, { status: "submitted" }],
      [
        { groupId: "group-1", status: "approved", soundRaw: "loud" },
        { groupId: "group-2", status: "draft", soundRaw: null },
      ],
      [
        { status: "approved", wranglerUserId: "user-1" },
        { status: "approved", wranglerUserId: null },
      ],
    ]);
    db.seed("member_role_assignments", [
      // THE KEYS MUST BE REAL ONES. These read "safety" and "lnt" until 4 Aug
      // 2026, and neither is in the OfficerKey enum (`safety_officer`,
      // `lnt_officer`, `fire_safety_officer`, `sound_officer`,
      // `safety_monitor`). An unrecognised key matches no required slot, so the
      // whole assignment path contributed nothing and this test reported the
      // same officer numbers it would with the feature deleted — verified by
      // seeding every key as accepted and watching `outstandingSlots` not move.
      // The keys also have to be REQUIRED ones to move the number. A theme camp
      // always requires `lnt_officer` and `fire_safety_officer`;
      // `safety_officer` is only *recommended*, so assigning it proves nothing.
      { groupId: "group-1", officerKey: "lnt_officer", consent: "accepted" },
      // A declined slot does NOT count as filled — this is the assertion that
      // stops the org console telling placement a camp has its Safety Baron
      // when that person said no.
      {
        groupId: "group-1",
        officerKey: "fire_safety_officer",
        consent: "declined",
      },
      // Neither does an assignment with no officer key at all.
      { groupId: "group-1", officerKey: null, consent: "accepted" },
    ]);
    db.seed("suppliers", [
      { standing: "good", steps: { docs: "complete" } },
      { standing: "suspended", steps: null },
    ]);
    db.seed("questionnaire_activations", [
      { id: "act-1", title: "Camp check-in" },
    ]);
    db.seed("required_actions", [
      { activationId: "act-1", status: "done" },
      { activationId: "act-1", status: "pending" },
      // A required action with no activation is skipped rather than crashing.
      { activationId: null, status: "pending" },
    ]);

    const board = await getStatusBoard(EDITION);

    expect(board.funnel.total).toBe(2);
    // Only the in-flight camps count towards officer coverage; the draft is out.
    expect(board.officerCoverage.applicableCamps).toBe(1);
    // THE CONSENT FILTER, asserted rather than merely seeded.
    //
    // The three `member_role_assignments` rows above model accepted, declined
    // and key-less slots, and until now nothing checked the result: a mutation
    // making `row.consent !== "pending" && row.consent !== "accepted"` always
    // false — so a DECLINED officer counts as filled — left this whole file
    // green. That is the org console telling placement a camp has its safety
    // and LNT officers when one of them said no.
    //
    // ONE outstanding: `lnt_officer` is accepted and therefore filled;
    // `fire_safety_officer` was declined and so is still open. If declined
    // counted, this would be 0 — which is exactly the mutation that used to
    // survive.
    expect(board.officerCoverage.outstandingSlots).toBe(1);
    expect(board.officerCoverage.fullyOfficered).toBe(0);
    expect(board.officerCoverage.campsWithGaps).toBe(1);
    expect(board.wranglerCoverage.eligibleCamps).toBe(2);
    expect(board.wranglerCoverage.assigned).toBe(1);
    expect(board.wranglerCoverage.unassigned).toBe(1);
    expect(board.supplierStandings.good).toBe(1);
    expect(board.supplierStandings.suspended).toBe(1);
    expect(board.questionnaires.sends).toHaveLength(1);
    // Two required actions carry `act-1`; the third carries no activation at all
    // and must be dropped. Asserting the COUNT is what pins that — the length
    // check above stays 1 either way, so inverting `if (!a.activationId)
    // continue` (which would attach nothing to act-1 and file the orphan under
    // an `undefined` key) went unnoticed before this line.
    expect(board.questionnaires.sends[0]).toMatchObject({
      activationId: "act-1",
      sent: 2,
      completed: 0,
    });
  });

  it("does not query required actions when no activation is open", async () => {
    db.seed("questionnaire_activations", []);
    const board = await getStatusBoard(EDITION);
    expect(db.recorded("select", "required_actions")).toHaveLength(0);
    expect(board.questionnaires.sends).toEqual([]);
  });
});

describe("wrangler reads", () => {
  it("excludes an org member with no username from the picker", async () => {
    // `publicMemberName(null)` is the literal string "Unnamed burner", so
    // without this filter the picker is a list of identical entries and the camp
    // is told "Unnamed burner is now your wrangler". The only other identifier
    // is the email, and putting that in a scheduling control would make the
    // list's CONTENTS depend on who is looking.
    db.seed("memberships", [
      { userId: "user-1", username: "zara", sanitizedAt: null },
      { userId: "user-2", username: "  ", sanitizedAt: null },
      { userId: "user-3", username: null, sanitizedAt: null },
      {
        userId: "user-4",
        username: "gone",
        sanitizedAt: new Date("2026-08-01T00:00:00Z"),
      },
      { userId: "user-5", username: "alice", sanitizedAt: null },
    ]);

    const candidates = await getWranglerCandidates("org-1");

    expect(candidates.map((c) => c.displayName)).toEqual(["alice", "zara"]);
  });

  it("shows a camp as VACANT when the wrangler's account is gone", async () => {
    // The assignment row survives a deleted account on purpose (SET NULL), so
    // the board can show the camp as vacant. An inner join would make it look
    // like a camp that was never assigned — a different thing needing a
    // different action.
    db.seed("wrangler_assignments", [
      {
        wranglerUserId: null,
        username: null,
        sanitizedAt: null,
        assignedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);

    const row = await getWranglerForGroup("group-1", EDITION.id);
    expect(row).toMatchObject({ wranglerUserId: null, displayName: null });
  });

  it("names the wrangler when one holds the camp", async () => {
    db.seed("wrangler_assignments", [
      {
        wranglerUserId: "user-1",
        username: "alice",
        sanitizedAt: null,
        assignedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);
    const row = await getWranglerForGroup("group-1", EDITION.id);
    expect(row?.displayName).toBe("alice");
  });

  it("returns null when the camp has no assignment row at all", async () => {
    db.seed("wrangler_assignments", []);
    await expect(
      getWranglerForGroup("group-1", EDITION.id),
    ).resolves.toBeNull();
  });

  it("counts the open section-review threads on each board row", async () => {
    db.seed("registrations", [
      {
        registrationId: "reg-1",
        groupId: "group-1",
        campName: "Mad Hatters",
        campSlug: "mad-hatters",
        wranglerUserId: "user-1",
        username: "alice",
        sanitizedAt: null,
      },
      {
        registrationId: "reg-2",
        groupId: "group-2",
        campName: "Camp 404",
        campSlug: "camp-404",
        wranglerUserId: null,
        username: null,
        sanitizedAt: null,
      },
    ]);
    db.seed("section_reviews", [{ registrationId: "reg-1", count: 3 }]);

    const rows = await getWranglerBoard(EDITION.id);

    expect(rows[0]).toMatchObject({
      wranglerName: "alice",
      openSectionReviews: 3,
    });
    expect(rows[1]).toMatchObject({
      wranglerName: null,
      openSectionReviews: 0,
    });
  });
});

describe("the whole projection rule, stated once", () => {
  it("refuses personal information to an actor holding nothing at all", async () => {
    // The half-finished grant: the door is open and no role carries anything.
    // Every personal read must resolve to null for them, in every domain.
    db.seed("users", [
      {
        userId: "user-1",
        username: "alice",
        email: "alice@example.com",
        role: "org_staff",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    const [account] = await searchAccounts("org-1", "", NO_ROLES);
    expect(account?.email).toBeNull();

    db.seed("supplier_notes", [
      {
        id: "n",
        kind: "vetting",
        body: "b",
        createdAt: new Date(),
        authorEmail: "buyer@example.com",
      },
    ]);
    const [note] = await getSupplierNotes("sup-1", NO_ROLES);
    expect(note?.authorEmail).toBeNull();
  });
});
