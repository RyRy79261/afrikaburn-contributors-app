import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  ORG_CAPABILITIES,
  ORG_DOMAINS,
  buildDomainOwnership,
  isSystemManager,
  orgCan,
  orgCanIn,
  orgCanInDomain,
  type DomainOwnership,
  type OrgActor,
} from "@quagga/core";

/** A deployment where Suppliers owns the supply-related parts of the console
 * and Theme camps owns registrations — enough for a scoped grant to mean
 * something, and with several domains deliberately left unowned. */
const SUPPLIERS = "dept-suppliers";
const CAMPS = "dept-camps";
const OWNERSHIP: DomainOwnership = buildDomainOwnership([
  { domain: "suppliers", departmentId: SUPPLIERS, departmentName: "Suppliers" },
  {
    domain: "supplier_documents",
    departmentId: SUPPLIERS,
    departmentName: "Suppliers",
  },
  {
    domain: "registrations",
    departmentId: CAMPS,
    departmentName: "Theme camps",
  },
]);

// THE LOCKOUT SCENARIOS.
//
// Org roles v1 made the console's permissions EDITABLE, which means the console
// can now be edited into a state where nobody can fix it. Every rail that stops
// that is tested here, each named as the scenario it prevents — because these
// are the failures that turn a bad afternoon into a lost weekend, and every one
// of them is silent until the moment it matters.
//
// Two kinds of assertion live here, and both are the real guarantee:
//
//  · PURE — the resolver's behaviour, called directly.
//  · SOURCE-LEVEL — for guards that live in `server-only` modules talking to a
//    database (`lib/session.ts`, `lib/actions/*`). The source IS the guarantee,
//    exactly as `roster-privacy` and `org-rank-enforcement` already do it.

function source(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relative}`, import.meta.url)),
    "utf8",
  );
}

/** The body of a named exported function, so an assertion is scoped to it. */
function functionBody(text: string, name: string): string {
  const start = text.search(
    new RegExp(`(export )?(async )?function ${name}\\b`),
  );
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const paramsOpen = text.indexOf("(", start);
  let parens = 0;
  let paramsClose = paramsOpen;
  for (let i = paramsOpen; i < text.length; i += 1) {
    if (text[i] === "(") parens += 1;
    else if (text[i] === ")") {
      parens -= 1;
      if (parens === 0) {
        paramsClose = i;
        break;
      }
    }
  }
  const open = text.indexOf("{", paramsClose);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const session = source("lib/session.ts");
const accounts = source("lib/actions/accounts.ts");
const orgRoles = source("lib/actions/org-roles.ts");

describe("LOCKOUT SCENARIO 1: the god bootstrap still works", () => {
  // A fresh deployment has no roles, no departments and no assignments. If the
  // first console load depended on any of them, nobody could ever get in.

  it("the bootstrap writes `god` on the membership, before any role exists", () => {
    const resolve = functionBody(session, "resolveOrgSession");
    const bootstrapAt = resolve.indexOf("canBootstrapGodEmail");
    const rolesAt = resolve.indexOf("orgRoleAssignments");
    expect(bootstrapAt, "the bootstrap is gone").toBeGreaterThan(-1);
    expect(rolesAt, "roles are never loaded").toBeGreaterThan(-1);
    // The bootstrap runs FIRST and depends on nothing the roles tables hold.
    expect(bootstrapAt).toBeLessThan(rolesAt);
    expect(resolve).toContain('role: "god"');
  });

  it("the gate is the membership role, not a role assignment", () => {
    // `orgRankFromRole` deciding the door is what lets a god (or a brand-new
    // org account) through a database with an empty `org_roles` table.
    const resolve = functionBody(session, "resolveOrgSession");
    expect(resolve).toContain("orgRankFromRole(membership?.role)");
    // The refusal now carries a diagnostic field (`godEmailUnverified`), so
    // match the KIND rather than the exact one-line object literal — the
    // property under test is "a non-staff membership is refused", not the
    // shape of the refusal.
    expect(resolve).toContain('kind: "forbidden"');
  });

  it("the ownership map is resolved in the session, not per query", () => {
    // Every scoped answer depends on it, so it is loaded once and carried on
    // the actor. A query resolving it for itself would be a query that could
    // forget to.
    const resolve = functionBody(session, "resolveOrgSession");
    expect(resolve).toContain("loadDomainOwnership(db)");
    expect(resolve).toContain("actor: { rank, roles, domains }");
  });

  it("a god resolves every capability with no roles at all", () => {
    const bootstrapped: OrgActor = {
      rank: "god",
      roles: [],
      domains: OWNERSHIP,
    };
    expect(isSystemManager(bootstrapped)).toBe(true);
    for (const capability of ORG_CAPABILITIES) {
      expect(orgCan(bootstrapped, capability)).toBe(true);
      expect(orgCanIn(bootstrapped, capability, null)).toBe(true);
      expect(orgCanIn(bootstrapped, capability, "any-department")).toBe(true);
    }
  });

  it("no role row can take a god's rights away", () => {
    // The nightmare version: somebody assigns the System manager a role that
    // grants nothing, believing roles are the whole story.
    const nerfed: OrgActor = {
      rank: "god",
      domains: OWNERSHIP,
      roles: [
        {
          id: "r1",
          key: "custom.nothing",
          name: "Nothing",
          kind: "custom",
          departmentId: "dept-1",
          permissions: {},
        },
      ],
    };
    for (const capability of ORG_CAPABILITIES) {
      expect(orgCan(nerfed, capability)).toBe(true);
    }
  });
});

describe("LOCKOUT SCENARIO 2: the sole System manager cannot be removed or demoted", () => {
  it("the accounts panel refuses to touch a god membership at all", () => {
    const body = functionBody(accounts, "setOrgStaffRole");
    // The read happens first, and a `god` row throws before either branch.
    const readAt = body.indexOf("const [existing]");
    const guardAt = body.indexOf('existing?.role === "god"');
    const elevateAt = body.indexOf('input.action === "elevate"');
    expect(readAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(readAt);
    expect(guardAt).toBeLessThan(elevateAt);
    expect(body).toContain("throw new Error");
  });

  it("`god` is not in the grantable set, so it cannot be minted either", () => {
    expect(accounts).toContain(
      'const GrantableRank = z.enum(["engineer", "org_staff"])',
    );
    expect(accounts).not.toMatch(/z\.enum\(\[[^\]]*"god"/);
  });

  it("the delete path can never match a god row", () => {
    // The WHERE reuses the role just proved not to be `god`, so even a race
    // cannot turn this into a god deletion.
    const body = functionBody(accounts, "setOrgStaffRole");
    expect(body).toContain('eq(schema.memberships.role, existing?.role ?? "org_staff")');
  });

  it("nobody can change their own access, including a System manager", () => {
    const body = functionBody(accounts, "setOrgStaffRole");
    expect(body).toContain("input.userId === session.dbUserId");
  });

  it("role assignment refuses a god target rather than pretending to work", () => {
    const body = functionBody(orgRoles, "setAccountOrgRoles");
    expect(body).toContain('membership.role === "god"');
  });
});

describe("LOCKOUT SCENARIO 3: only a System manager manages departments, roles and assignments", () => {
  const MANAGED = [
    "createDepartment",
    "renameDepartment",
    "deleteDepartment",
    "createOrgRole",
    "updateOrgRole",
    "deleteOrgRole",
    "setAccountOrgRoles",
  ];

  for (const action of MANAGED) {
    it(`${action} requires the System manager anchor`, () => {
      const body = functionBody(orgRoles, action);
      expect(body).toContain("await requireSystemManager()");
      // …and NOT a capability, which a role could one day be given.
      expect(body).not.toContain("requireOrgSession(");
    });
  }

  it("the anchor is the `god` membership, resolved from nothing editable", () => {
    const guard = functionBody(session, "requireSystemManager");
    expect(guard).toContain("isSystemManager(state.actor)");
    expect(guard).toContain("throw new Error");
    // `isSystemManager` reads `rank`, which comes from `memberships.role`.
    expect(source("lib/session.ts")).toContain("orgRankFromRole(membership?.role)");
  });

  it("the roles PAGE decides `canManage` from the anchor, not a capability", () => {
    const page = source("app/(console)/system/roles/page.tsx");
    // Reading the model is the system panel's own capability; CHANGING it is
    // the anchor, and `canManage` is the only thing the client component is
    // told. A capability here would be grantable, which is the whole hazard.
    expect(page).toContain('orgCan(session.actor, "read_system")');
    expect(page).toContain("const canManage = isSystemManager(session.actor)");
    expect(page).toContain("canManage={canManage}");
    // A refusal, not a notFound(): hiding teaches nobody the rule. (The words
    // appear in the page's own comment explaining exactly that, so the check is
    // for the IMPORT — you cannot call what you never brought in.)
    expect(page).not.toMatch(/import[\s\S]*notFound[\s\S]*from "next\/navigation"/);
  });

  it("the people a deletion would strip are not fetched for a mere reader", () => {
    // `getOrgRoleImpacts` carries the affected accounts' EMAIL ADDRESSES. An
    // engineer may read the permission model; they may not receive that, and
    // the guarantee is that the query does not run rather than that a component
    // skips the values (a skipped value still ships in the RSC payload).
    const page = source("app/(console)/system/roles/page.tsx");
    expect(page).toContain("canManage");
    expect(page).toContain("getOrgRoleImpacts(session.orgGroupId, session.actor)");
    expect(page).toContain("Promise.resolve(null)");
    // …and the query refuses on its own, before the select, so a page that
    // forgot the gate leaks nothing (queries.ts `getOrgRoleImpacts`).
    const q = source("lib/queries.ts");
    const guard = q.indexOf("if (!isSystemManager(actor)) {");
    expect(guard).toBeGreaterThan(-1);
    expect(q.indexOf("getOrgRoleImpacts")).toBeLessThan(guard);
  });

  it("`manage_accounts` is refused to every role, however the row was written", () => {
    const crafted: OrgActor = {
      rank: "org_staff",
      domains: OWNERSHIP,
      roles: [
        {
          id: "r1",
          key: "custom.sneaky",
          name: "Sneaky",
          kind: "custom",
          departmentId: null,
          permissions: { manage_accounts: true, read: true },
        },
      ],
    };
    expect(orgCan(crafted, "manage_accounts")).toBe(false);
    expect(orgCanIn(crafted, "manage_accounts", null)).toBe(false);
    // The rest of the role still works — this is a targeted refusal, not a
    // poison pill that voids the whole row.
    expect(orgCan(crafted, "read")).toBe(true);
  });

  it("a permanent role cannot be deleted, and the guard is server-side", () => {
    const body = functionBody(orgRoles, "deleteOrgRole");
    expect(body).toContain("canDeleteOrgRoleKind(role.kind)");
    expect(body).toContain("throw new Error");
  });
});

describe("LOCKOUT SCENARIO 4: fail closed — no roles means nothing but the door", () => {
  it("an org account with no roles resolves no capability at all", () => {
    for (const rank of ["org_staff", "engineer"] as const) {
      const fresh: OrgActor = { rank, roles: [], domains: OWNERSHIP };
      expect(isSystemManager(fresh)).toBe(false);
      for (const capability of ORG_CAPABILITIES) {
        expect(orgCan(fresh, capability)).toBe(false);
        expect(orgCanIn(fresh, capability, SUPPLIERS)).toBe(false);
        for (const domain of ORG_DOMAINS) {
          expect(orgCanInDomain(fresh, capability, domain)).toBe(false);
        }
      }
    }
  });

  it("…and still clears the gate, so they can be told why rather than bounced", () => {
    // The door and the rights are separate on purpose: an account that cannot
    // sign in cannot be told that it needs a role.
    const resolve = functionBody(session, "resolveOrgSession");
    const rankAt = resolve.indexOf("const rank = orgRankFromRole");
    const okAt = resolve.indexOf('kind: "ok"');
    expect(rankAt).toBeGreaterThan(-1);
    expect(okAt).toBeGreaterThan(rankAt);
    // Nothing between the gate and the `ok` return refuses on an empty role set.
    const between = resolve.slice(rankAt, okAt);
    expect(between).not.toContain("forbidden");
  });

  it("every page is gated on `read`, in ONE place a new page cannot forget", () => {
    // Before org roles v1 every rank held `read`, so no page checked it. Now an
    // account can hold the door and no roles — and if the check lived on the
    // pages, the next page added would be the one that forgot.
    const gate = source("lib/gate.tsx");
    expect(gate).toContain('orgCan(session.actor, "read")');
    expect(gate).toContain("NoRolesScreen");
    // …and it refuses BEFORE handing the session over, so no page can query.
    // (Asserted over the file rather than a extracted body: `guardConsole`'s
    // RETURN TYPE is an object literal, which the brace-matching helper would
    // mistake for the body.)
    const checkAt = gate.indexOf('if (!orgCan(session.actor, "read"))');
    const okAt = gate.indexOf("return { ok: true, session };");
    expect(checkAt).toBeGreaterThan(-1);
    expect(okAt).toBeGreaterThan(-1);
    expect(checkAt).toBeLessThan(okAt);
  });

  it("the session re-sanitizes stored permissions on the way in", () => {
    // A row written by anything other than the role editor still cannot carry a
    // capability no role may hold.
    const resolve = functionBody(session, "resolveOrgSession");
    expect(resolve).toContain("sanitizeOrgPermissions(r.permissions)");
  });

  it("LOCKOUT SCENARIO: a scoped delete never leaks out of its department", () => {
    // The rail that makes "org staff may only delete in their related
    // department" real rather than aspirational: `delete` is ALWAYS resolved
    // through `orgCanIn`, so a guard that forgets to name a department refuses a
    // department-scoped role instead of silently granting it everywhere.
    const guard = functionBody(session, "requireOrgSession");
    expect(guard).toContain("isDepartmentScopedCapability(capability)");
    expect(guard).toContain(
      "orgCanInDomain(state.actor, capability, domain)",
    );

    const suppliersLead: OrgActor = {
      rank: "org_staff",
      domains: OWNERSHIP,
      roles: [
        {
          id: "r1",
          key: "dept.suppliers.lead",
          name: "Suppliers lead",
          kind: "system",
          departmentId: SUPPLIERS,
          permissions: {
            read: true,
            write: true,
            delete: true,
            read_personal_information: true,
          },
        },
      ],
    };
    // Their own department's domains: yes. Another department's: no. A domain
    // nobody owns: no. A guard that named none: no.
    expect(orgCanInDomain(suppliersLead, "delete", "suppliers")).toBe(true);
    expect(orgCanInDomain(suppliersLead, "delete", "supplier_documents")).toBe(
      true,
    );
    expect(orgCanInDomain(suppliersLead, "delete", "registrations")).toBe(false);
    expect(orgCanInDomain(suppliersLead, "delete", "bulletins")).toBe(false);
    expect(orgCanInDomain(suppliersLead, "delete", null)).toBe(false);
    expect(orgCanIn(suppliersLead, "delete", CAMPS)).toBe(false);
    // …while their ordinary work is not confined: read and write are not scoped.
    expect(orgCan(suppliersLead, "write")).toBe(true);
  });

  it("LOCKOUT SCENARIO: a scoped PERSONAL-INFORMATION grant stays in its department", () => {
    // The same rail for the capability Ryan corrected. A suppliers lead reads
    // supply-related details and is refused a theme camp's members — enforced
    // by the same guard, so a query that names its domain cannot be bypassed by
    // one that forgets (forgetting refuses).
    const suppliersLead: OrgActor = {
      rank: "org_staff",
      domains: OWNERSHIP,
      roles: [
        {
          id: "r1",
          key: "dept.suppliers.lead",
          name: "Suppliers lead",
          kind: "system",
          departmentId: SUPPLIERS,
          permissions: { read: true, read_personal_information: true },
        },
      ],
    };
    expect(
      orgCanInDomain(suppliersLead, "read_personal_information", "suppliers"),
    ).toBe(true);
    for (const domain of ORG_DOMAINS.filter(
      (d) => d !== "suppliers" && d !== "supplier_documents",
    )) {
      expect(
        orgCanInDomain(suppliersLead, "read_personal_information", domain),
      ).toBe(false);
    }
  });

  it("LOCKOUT SCENARIO: only a System manager decides what a department owns", () => {
    // Ownership IS a permission: giving a department the registrations domain
    // hands its leads every camp member's medical notes. So it sits behind the
    // anchor with every other rights edit, never behind a capability.
    const body = functionBody(orgRoles, "setDepartmentDomains");
    expect(body).toContain("await requireSystemManager()");
    expect(body).not.toContain("requireOrgSession(");
    expect(body).toContain("writeAuditEvent(tx");
    expect(body).toContain("withTransaction");
  });
});

describe("the write path and the resolver agree about what may be stored", () => {
  it("role writes build permissions through the sanitizing helper", () => {
    for (const action of ["createOrgRole", "updateOrgRole"]) {
      const body = functionBody(orgRoles, action);
      expect(body).toContain("orgPermissionsFromKeys(input.capabilities)");
    }
  });

  it("every role mutation is audited", () => {
    for (const action of [
      "createDepartment",
      "renameDepartment",
      "deleteDepartment",
      "createOrgRole",
      "updateOrgRole",
      "deleteOrgRole",
      "setAccountOrgRoles",
    ]) {
      const body = functionBody(orgRoles, action);
      expect(body, `${action} writes no audit row`).toContain(
        "writeAuditEvent(tx",
      );
    }
  });

  it("every role mutation is one transaction, so no audit row outlives its write", () => {
    for (const action of [
      "createDepartment",
      "deleteDepartment",
      "createOrgRole",
      "updateOrgRole",
      "deleteOrgRole",
      "setAccountOrgRoles",
    ]) {
      expect(functionBody(orgRoles, action)).toContain("withTransaction");
    }
  });
});
