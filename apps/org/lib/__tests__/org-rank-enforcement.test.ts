import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// REGRESSION: the console's permission LEVELS, proved where they are enforced.
//
// Two guarantees, both properties of the SQL projection and the action guards
// rather than of anything a unit test can call: `lib/queries.ts` is
// `server-only` and talks to a database. So — exactly like `roster-privacy`,
// whose idiom this borrows — the assertions read the source, because the source
// IS the guarantee:
//
//  1. PERSONAL INFORMATION IS EXCLUDED AT THE SELECT, not in the JSX. Every
//     query that returns a person resolves the personal-information predicate
//     first and puts the personal columns behind that answer, so a refused
//     caller's row never contains them — and therefore no RSC payload does
//     either, whatever a component would or would not have rendered.
//     Since 27 Jul 2026 it also names WHICH PART OF THE CONSOLE it is serving:
//     the capability is department-scoped, so an un-domained check would hand a
//     suppliers lead a theme camp's members. The domain each query names is
//     asserted here, because getting it wrong is silent and invisible in review.
//  2. EVERY MUTATION NAMES THE CAPABILITY IT NEEDS. A destructive action asks
//     for `delete`, the camp-category taxonomy asks for the System manager RANK,
//     account access asks for `manage_accounts`. An engineer is then refused
//     server-side with an honest message rather than merely losing a button.
//
// The pure matrix itself is tested in packages/core
// (`__tests__/org-permissions.test.ts`); this file tests that the console
// actually consults it.

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

  // Skip the PARAMETER LIST first — taking the first `{` after the name returns
  // an inline parameter type annotation instead of the body.
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

/**
 * The function body with every `...(personal ? { … } : {})` spread REMOVED.
 *
 * What survives is what an actor WITHOUT `read_personal_information` receives —
 * so asserting a personal column is absent from this is the real guarantee, not
 * "the column is mentioned near a conditional somewhere".
 */
function withoutPersonalBranch(body: string): string {
  return body.replace(/\.\.\.\(personal[\s\S]*?\}\s*:\s*\{\}\)/g, "");
}

/** The column map handed to the FIRST `.select(` in a body — the projection. */
function selectProjection(body: string): string {
  const open = body.indexOf(".select(");
  expect(open, "no .select( in body").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open + ".select".length; i < body.length; i += 1) {
    if (body[i] === "(") depth += 1;
    else if (body[i] === ")") {
      depth -= 1;
      if (depth === 0) return body.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced parens in select");
}

const queries = source("lib/queries.ts");
const medicalAudit = source("lib/medical-audit.ts");
const statusBoard = source("lib/status-board.ts");
const questionnaireQueries = source("lib/questionnaires/queries.ts");

describe("REGRESSION: an engineer's payload carries no personal information", () => {
  // query name → the DOMAIN it must resolve against, and the column
  // expressions that must never survive the refusal.
  const GUARDED: Record<string, { domain: string; columns: string[] }> = {
    searchAccounts: { domain: "accounts", columns: ["schema.users.email"] },
    // The System panel's org-access roster. An engineer may open that page —
    // it is THEIR page — so the roster on it is the one people-returning query
    // most likely to be written as "they can see this page, so let them see the
    // rows", which is exactly the mistake. It asks `accounts`, NOT `runsDeployment`
    // and not the system panel's own domain: page access never implies rows.
    getOrgAccessRoster: { domain: "accounts", columns: ["schema.users.email"] },
    getRegistrationOfficers: {
      domain: "registrations",
      columns: [
        "schema.burnerBios.contactEmail",
        "schema.burnerBios.phone",
        "schema.users.email",
      ],
    },
    getRegistrationDecisionLog: {
      domain: "registrations",
      columns: ["schema.users.email"],
    },
    getSupplierNotes: { domain: "suppliers", columns: ["schema.users.email"] },
  };

  // STRONGER THAN GUARDED: this one is not rank-gated because it does not fetch
  // the column at all. `suppliers.contact` is rendered by no column in the
  // table, so gating it merely moved a needless disclosure from "everyone" to
  // "everyone except engineers". A field nobody renders should not be selected,
  // and then there is no rank decision left to get wrong.
  it("getSuppliersOverview never selects suppliers.contact, for any rank", () => {
    const body = functionBody(queries, "getSuppliersOverview");
    expect(body).not.toContain("schema.suppliers.contact");
    expect(body).not.toContain("seesPersonalInformation");
  });

  for (const [name, { domain, columns }] of Object.entries(GUARDED)) {
    it(`${name} resolves the predicate for \`${domain}\` before it selects`, () => {
      const body = functionBody(queries, name);
      const predicateAt = body.indexOf(
        `seesPersonalInformation(actor, "${domain}")`,
      );
      const selectAt = body.indexOf(".select(");
      expect(
        predicateAt,
        `${name} never asks for the ${domain} domain`,
      ).toBeGreaterThan(-1);
      expect(selectAt).toBeGreaterThan(-1);
      expect(predicateAt).toBeLessThan(selectAt);
    });

    it(`${name} selects no personal column for a refused caller`, () => {
      const refused = withoutPersonalBranch(
        selectProjection(functionBody(queries, name)),
      );
      for (const column of columns) {
        expect(refused, `${name} still selects ${column}`).not.toContain(
          column,
        );
      }
    });
  }

  it("NO query decides personal information without naming a domain", () => {
    // The un-domained predicate still exists for affordances (a nav entry, a
    // placeholder), and a query reaching for it would silently restore the
    // global behaviour this change removed. Server-side read models must not
    // import it at all.
    for (const [label, text] of [
      ["queries.ts", queries],
      ["medical-audit.ts", medicalAudit],
      ["status-board.ts", statusBoard],
      ["questionnaires/queries.ts", questionnaireQueries],
    ] as const) {
      expect(
        text,
        `${label} uses the un-domained personal-information predicate`,
      ).not.toContain("canReadPersonalInformationAnywhere");
    }
    // …and the helper in queries.ts REQUIRES the argument, so there is no
    // un-domained call to make in the first place.
    expect(queries).toContain(
      "function seesPersonalInformation(actor: OrgActor, domain: OrgDomain)",
    );
  });

  it("searchAccounts does not MATCH on email either — no lookup oracle", () => {
    // Dropping email from the projection while still filtering on it would turn
    // the search box into a "does this address have an account here?" service.
    const body = functionBody(queries, "searchAccounts");
    const whereAt = body.indexOf(".where(");
    const tail = body.slice(whereAt);
    expect(tail).toContain("ilike(schema.users.username");
    // The email match exists, but only on the far side of the predicate: the
    // branch a refused caller takes filters on the username alone.
    const emailMatchAt = tail.indexOf("ilike(schema.users.email");
    expect(emailMatchAt).toBeGreaterThan(-1);
    const guardAt = tail.indexOf("personal");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(emailMatchAt);
  });

  it("the registration row omits the camp's contact PEOPLE, not its answers", () => {
    const loader = functionBody(queries, "loadRegistrationRow");
    // The refused branch destructures the contact columns OUT of the table's
    // column map, so what is selected is everything else — a column added to the
    // schema later is included automatically instead of silently disappearing.
    expect(loader).toContain("getTableColumns(schema.registrations)");
    for (const key of [
      "s1ContactEmail",
      "s1AltContactName",
      "s1AltContactPhone",
      "s1AltContactEmail",
      "s2LntLeadName",
      "s2LntLeadPhone",
      "s2LntLeadEmail",
    ]) {
      expect(loader, `${key} is not held back`).toContain(key);
    }
    // …and the camp's own answers are NOT withheld: an engineer reviews the
    // registration, they just don't get the humans' numbers.
    for (const key of [
      "s5SoundPlan",
      "s4ExpectedPopulation",
      "s6FeeStructure",
    ]) {
      expect(loader).not.toContain(key);
    }
  });

  it("getRegistrationDetail asks before it loads the row", () => {
    const body = functionBody(queries, "getRegistrationDetail");
    const predicateAt = body.indexOf(
      'seesPersonalInformation(actor, "registrations")',
    );
    const loadAt = body.indexOf("loadRegistrationRow(");
    expect(predicateAt).toBeGreaterThan(-1);
    expect(predicateAt).toBeLessThan(loadAt);
  });

  it("the recent-activity feed withholds the actor's identity", () => {
    const refused = withoutPersonalBranch(
      selectProjection(functionBody(statusBoard, "getRecentActivity")),
    );
    expect(refused).not.toContain("schema.users.email");
  });
});

describe("REGRESSION: the System panel is gated, and gates its own controls", () => {
  const systemPage = source("app/(console)/system/page.tsx");

  it("checks the deployment-running RANK before it queries anything", () => {
    // `runsDeployment` replaced the old `read_system` capability: opening the system panel is
    // "do you run this deployment", which is the engineer/System manager RANK.
    // Collapsing it into `isSystemManager` would have locked engineers out of
    // the panel that exists for them — see `runsDeployment` in @quagga/core.
    const checkAt = systemPage.indexOf("runsDeployment(session.actor)");
    const probeAt = systemPage.indexOf("getSystemStatus()");
    const rosterAt = systemPage.indexOf("getOrgAccessRoster(");
    expect(checkAt, "the page never asks").toBeGreaterThan(-1);
    expect(probeAt).toBeGreaterThan(-1);
    expect(rosterAt).toBeGreaterThan(-1);
    expect(checkAt).toBeLessThan(probeAt);
    expect(checkAt).toBeLessThan(rosterAt);
  });

  it("refuses honestly rather than 404-ing", () => {
    expect(systemPage).toContain("runsDeploymentRefusal()");
  });

  it("does not let page ACCESS imply account management", () => {
    // An engineer runs the deployment and is NOT a System manager. The roster's
    // controls must ask the anchor, not inherit panel access — the whole reason
    // the panel is documented as a READ.
    expect(systemPage).toContain("isSystemManager(session.actor)");
    // …and the email column resolves the `accounts` DOMAIN, so a department
    // lead who can open the system panel still does not read the org's address
    // book unless their department owns accounts.
    expect(systemPage).toContain(
      'canReadPersonalInformationIn(session.actor, "accounts")',
    );
  });

  it("hides its nav entry behind the same rank the page enforces", () => {
    // Hiding is never the boundary — but an entry that leads somewhere the
    // viewer is refused is its own defect, and both must read one predicate.
    const header = source("components/console-header.tsx");
    expect(header).toMatch(/href: "\/system"[\s\S]{0,80}runsDeployment: true/);
    expect(header).toContain("runsDeployment(session.actor)");
  });

  it("never prints a secret — the derivation is proved separately", () => {
    // The page renders `SystemCheck.value` / `.detail` verbatim, so the promise
    // lives in the deriver. Asserted here only that the page does not reach
    // around it into process.env for something to display.
    expect(systemPage).not.toContain("process.env");
  });
});

describe("REGRESSION: a restricted control is shown restricted, not offered", () => {
  // Ryan, 28 Jul 2026: "I'd rather things be transparent with restrictions than
  // completely obfuscated, except for private personal information." That cuts
  // both ways — a control the viewer cannot use must be neither hidden NOR
  // live, and the second half is the one that rotted.
  //
  // `SuppliersTable` takes `deleteRefusal` and documents that OMITTING IT MEANS
  // "NOT ASKED", in which case the bin icon is offered exactly as before. The
  // page did not ask. So an engineer — a rank that "deliberately cannot delete
  // anything in any department" — and any lead scoped to a department that does
  // not own suppliers both got a live destructive control whose only feedback
  // was a toast after they pressed it.
  //
  // Asserted at the PAGE, because the page is the only layer that has the actor.

  it("the suppliers page answers the delete question for the table", () => {
    // Whitespace-normalised: prettier wraps the call across four lines the
    // moment the argument list grows, and a test that breaks on reformatting is
    // a test people delete.
    const page = source("app/(console)/suppliers/page.tsx").replace(/\s+/g, "");
    expect(page).toContain(
      'orgCanInDomain(guard.session.actor,"delete","suppliers"',
    );
    expect(page).toContain(
      'orgCapabilityRefusal(guard.session.actor,"delete","suppliers"',
    );
    expect(page).toContain("deleteRefusal={deleteRefusal}");
  });

  it("the table still treats an unanswered page as 'not asked'", () => {
    // The prop stays OPTIONAL on purpose: defaulting it to a refusal would take
    // removal away from every System manager the moment a new page forgot to
    // pass it. The regression that matters is a page that does not ask, so the
    // test lives on the page above, not on this default.
    const table = source("components/suppliers-table.tsx");
    expect(table).toContain("deleteRefusal?: string | null;");
    expect(table).toContain("not available to you");
    expect(table).toContain("aria-describedby={DELETE_REFUSAL_ID}");
  });

  it("the registration detail answers the decide question for the panel", () => {
    // Approve and Reject are the most consequential buttons in the console and
    // they rendered live for every account. `decideRegistration` guards `update`
    // in `registrations`, so a lead scoped elsewhere learned that by pressing
    // Approve on someone else's department and reading a toast.
    const page = source("app/(console)/registrations/[id]/page.tsx").replace(
      /\s+/g,
      "",
    );
    expect(page).toContain('orgCanInDomain(actor,"update","registrations"');
    expect(page).toContain(
      'orgCapabilityRefusal(actor,"update","registrations"',
    );
    // BOTH renders — the project branch and the theme-camp branch. Wiring one
    // and not the other is the exact half-fix this asserts against.
    expect(page.split("decisionRefusal={decisionRefusal}").length - 1).toBe(2);
  });

  it("the decision panel refuses in place rather than hiding the buttons", () => {
    const panel = source("components/decision-panel.tsx");
    expect(panel).toContain("disabled={Boolean(refusal) || pending}");
    expect(panel).toContain("not available to you");
    expect(panel).toContain("aria-describedby={refusal ? DECISION_REFUSAL_ID");
  });

  it("the camp-category manager disables its controls instead of dropping them", () => {
    const manager = source("components/categories/categories-manager.tsx");
    // Every write control is reachable in the markup and refused by `canManage`.
    for (const control of [
      "disabled={!canManage || pending}",
      "not available to you",
      "aria-describedby={canManage ? undefined : refusalId}",
    ]) {
      expect(manager).toContain(control);
    }
    // …and the page hands it the id of the one refusal sentence it prints.
    const page = source("app/(console)/categories/page.tsx");
    expect(page).toContain("refusalId={MANAGE_REFUSAL_ID}");
    expect(page).toContain("id={MANAGE_REFUSAL_ID}");
    expect(page).toContain(
      'systemManagerRefusal("change the camp categories")',
    );
  });
});

describe("REGRESSION: a wrangler assignment is guarded, gated and does not leak", () => {
  // Migration 0026 put something behind a button that had promised "unlocks
  // after approval" since it was a stub. Three things have to stay true, and
  // the roadmap requires an adversarial pass on the third (M4-08).
  const wranglers = source("lib/actions/wranglers.ts");

  it("asks the same capability that decides the registration", () => {
    // Wrangling is the continuation of the review, so it is `update` in
    // `registrations` — not a new domain nobody owns, and not an ungated action.
    const flat = wranglers.replace(/\s+/g, "");
    expect(flat).toContain('capability:"update",domain:"registrations"');
    // BOTH directions. An assign that is guarded and an unassign that is not
    // means anyone can strip every camp of its wrangler.
    expect(
      flat.split('capability:"update",domain:"registrations"').length - 1,
    ).toBe(2);
  });

  it("gates on APPROVAL server-side, not in the component", () => {
    const body = functionBody(wranglers, "assignWrangler");
    expect(body).toContain('registration.status !== "approved"');
    expect(body).toContain("Approve it first");
    // …and on the kind: MV/art belong to the DMV and the Art crew.
    expect(body).toContain('registration.campKind !== "theme_camp"');
  });

  it("refuses anyone who is not an org member, from the server", () => {
    // The picker is a client control and this action is a public endpoint, so a
    // hand-made request could otherwise hand a camp to any account in the
    // database — including one of that camp's own members.
    const body = functionBody(wranglers, "assignWrangler");
    expect(body).toContain("schema.memberships.groupId, session.orgGroupId");
    expect(body).toContain("isn't an AfrikaBurn org member");
  });

  it("notifies the camp and the wrangler — from ids, never from an audience", () => {
    // THE ADVERSARIAL REQUIREMENT (roadmap M4-08): the fan-out must reach the
    // assigned wrangler and that camp's leads, and nobody else. Both recipient
    // lists are derived from ids this function was handed; if either ever comes
    // from a role query or the bulletin audience resolver, it can over-send.
    const body = functionBody(wranglers, "notifyWranglerAssigned");
    expect(body).toContain("eq(schema.memberships.groupId, input.groupId)");
    expect(body).toContain(
      'inArray(schema.memberships.role, ["lead", "admin"])',
    );
    expect(body).toContain("input.wranglerUserId");
    // Nothing here may reach for the broadcast machinery.
    expect(body).not.toContain("resolveAudience");
    expect(body).not.toContain("buildBulletinNotifications");
    // The wrangler is filtered out of the camp copy when they are also a lead,
    // so nobody gets the same news twice.
    expect(body).toContain("id !== input.wranglerUserId");
  });

  it("audits both directions", () => {
    expect(functionBody(wranglers, "assignWrangler")).toContain(
      '"wrangler.assign"',
    );
    expect(functionBody(wranglers, "unassignWrangler")).toContain(
      '"wrangler.unassign"',
    );
  });

  it("the review screen and the board both ask before offering the control", () => {
    const detail = source("app/(console)/registrations/[id]/page.tsx").replace(
      /\s+/g,
      "",
    );
    expect(detail).toContain('orgCanInDomain(actor,"update","registrations")');
    expect(detail).toContain("wranglerRefusal={wranglerRefusal}");

    const board = source("app/(console)/wranglers/page.tsx").replace(
      /\s+/g,
      "",
    );
    expect(board).toContain('orgCanInDomain(actor,"update","registrations")');
    expect(board).toContain("refusal={refusal}");
  });

  it("neither wrangler read selects a personal column", () => {
    // Who shepherds a camp is scheduling, not personal information — so these
    // queries have no `seesPersonalInformation` branch to get wrong, and must
    // not grow one by accident.
    for (const fn of [
      "getWranglerCandidates",
      "getWranglerForGroup",
      "getWranglerBoard",
    ]) {
      const body = functionBody(queries, fn);
      expect(body).not.toContain("schema.users.email");
      expect(body).toContain("publicMemberName");
    }
  });
});

describe("REGRESSION: the medical DISCLOSURE CENSUS is not readable by rank", () => {
  // A `bio.medical.view` row only exists when the subject HAS notes, so a list
  // of those rows names the burners who have disclosed a health condition.

  it("the medical access log refuses anyone without personal information THERE", () => {
    const guard = functionBody(medicalAudit, "canReadMedicalAccessLog");
    // The `audit` domain specifically: the log spans every camp, so a grant
    // scoped to one department is not a grant over a console-wide census.
    expect(guard).toContain('canReadPersonalInformationIn(actor, "audit")');

    const log = functionBody(medicalAudit, "getMedicalAccessLog");
    // Fails closed IN the query — not merely at the page that calls it.
    expect(log).toContain("canReadMedicalAccessLog(actor)");
    expect(log).toContain("throw new Error");
  });

  it("the audit page checks before it fetches, and says why", () => {
    const page = source("app/(console)/audit/page.tsx");
    const checkAt = page.indexOf("canReadMedicalAccessLog(actor)");
    const fetchAt = page.indexOf("getMedicalAccessLog(actor)");
    expect(checkAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(checkAt).toBeLessThan(fetchAt);
    // Refused, not silently blank.
    expect(page).toContain("orgCapabilityRefusal");
  });

  it("the recent-activity feed asks the audit domain too", () => {
    const body = functionBody(statusBoard, "getRecentActivity");
    expect(body).toContain('canReadPersonalInformationIn(actor, "audit")');
  });

  it("the general audit trail drops medical rows for a refused caller", () => {
    // Otherwise the subject ids alone would rebuild the census, since every rank
    // can open a member's detail page.
    const trail = functionBody(medicalAudit, "getAuditTrail");
    expect(trail).toContain("MEDICAL_VIEW_AUDIT_ACTION");
    const refused = withoutPersonalBranch(selectProjection(trail));
    expect(refused).not.toContain("schema.users.email");
  });
});

describe("REGRESSION: questionnaire responses are personal information", () => {
  it("the results predicate names the questionnaires domain", () => {
    const guard = functionBody(
      questionnaireQueries,
      "canReadActivationResults",
    );
    expect(guard).toContain(
      'canReadPersonalInformationIn(actor, "questionnaires")',
    );
  });

  it("the results query fails closed", () => {
    const body = functionBody(questionnaireQueries, "getActivationResults");
    expect(body).toContain("canReadActivationResults(actor)");
    expect(body).toContain("throw new Error");
  });

  it("the results page refuses honestly rather than 404-ing", () => {
    const page = source(
      "app/(console)/questionnaires/[key]/[activationId]/page.tsx",
    );
    const checkAt = page.indexOf("canReadActivationResults(session.actor)");
    const fetchAt = page.indexOf("getActivationResults(");
    expect(checkAt).toBeGreaterThan(-1);
    expect(checkAt).toBeLessThan(fetchAt);
    expect(page).toContain("orgCapabilityRefusal");
  });
});

describe("REGRESSION: every mutation names the capability it needs", () => {
  const CAPABILITY_BY_ACTION: {
    file: string;
    action: string;
    capability: string;
  }[] = [
    // Destructive — never an engineer, and never outside its own department.
    {
      file: "lib/actions/suppliers.ts",
      action: "deleteSupplier",
      capability: "delete",
    },
    {
      file: "lib/actions/supplier-documents.ts",
      action: "deleteSupplierDocument",
      capability: "delete",
    },
    // (The camp-category taxonomy left this table. It is System-manager-only —
    // Ryan named that one on 27 Jul 2026 — so its guard is the ANCHOR, not a
    // capability, and it is asserted as such below. It was briefly listed here
    // during the CRUD rework, which is exactly how the rule got relaxed: the
    // seeded `org_staff` and `engineer` roles carry no department, and a
    // department-less grant reaches every domain, so "requires update" meant
    // "every org account".)
    // (Access management left this table: `manage_accounts` stopped being a
    // capability when the vocabulary became CRUD. `setOrgStaffRole` now calls
    // `requireSystemManager()` — the ANCHOR — which is a stronger guarantee than
    // a grant, and is proved in `org-role-lockout.test.ts`.)
    // (Departments moved out of this file entirely in org roles v1: they are
    // rows a System manager creates, and every action that touches them requires
    // the System manager ANCHOR rather than a capability — proved in
    // `org-role-lockout.test.ts`, which is the stronger guarantee.)
    // Ordinary console work — every rank, but still declared.
    {
      file: "lib/actions/registrations.ts",
      action: "decideRegistration",
      capability: "update",
    },
    {
      file: "lib/actions/suppliers.ts",
      action: "setSupplierStanding",
      capability: "update",
    },
    {
      file: "lib/actions/suppliers.ts",
      action: "addSupplier",
      capability: "create",
    },
  ];

  for (const { file, action, capability } of CAPABILITY_BY_ACTION) {
    it(`${action} requires \`${capability}\``, () => {
      const body = functionBody(source(file), action);
      expect(body).toMatch(
        new RegExp(
          `requireOrgSession\\(\\{\\s*\\n?\\s*capability: "${capability}"`,
        ),
      );
    });
  }

  // THE ANCHOR, not a capability. A permission that can be granted can be
  // granted to the wrong person; the camp-category taxonomy is edition-wide
  // reference data every registration renders against, so it is reserved to the
  // rank. `requireSystemManager` resolves `memberships.role = 'god'` directly.
  for (const action of [
    "createCategory",
    "updateCategory",
    "deleteCategory",
    "setGroupCategory",
  ]) {
    it(`${action} requires the System manager anchor`, () => {
      const body = functionBody(source("lib/actions/categories.ts"), action);
      expect(body).toMatch(/requireSystemManager\(/);
      expect(body).not.toMatch(/requireOrgSession\(/);
    });
  }

  it("every DESTRUCTIVE mutation also names the domain it destroys in", () => {
    // `delete` is department-scoped, so a guard that names only the capability
    // resolves as "belongs to no department" and refuses every departmental
    // lead. Fail-closed, but wrong — and invisible until a lead complains.
    const DOMAIN_BY_ACTION: {
      file: string;
      action: string;
      domain: string;
    }[] = [
      {
        file: "lib/actions/suppliers.ts",
        action: "deleteSupplier",
        domain: "suppliers",
      },
      {
        file: "lib/actions/supplier-documents.ts",
        action: "deleteSupplierDocument",
        domain: "supplier_documents",
      },
    ];
    for (const { file, action, domain } of DOMAIN_BY_ACTION) {
      const body = functionBody(source(file), action);
      expect(body, `${action} names no domain`).toContain(
        `domain: "${domain}"`,
      );
    }
  });

  it("no console mutation is left with a bare, unexplained gate", () => {
    // `requireOrgSession()` with no capability is allowed only where the actor
    // is acting on THEMSELVES (their own notification inbox, their own blocking
    // questionnaire) — every such call carries a comment saying so, so a new
    // unguarded mutation cannot slip in unnoticed.
    const files = [
      "lib/actions/accounts.ts",
      "lib/actions/bulletins.ts",
      "lib/actions/categories.ts",
      "lib/actions/registrations.ts",
      "lib/actions/notifications.ts",
      "lib/actions/org-roles.ts",
      "lib/actions/supplier-documents.ts",
      "lib/actions/suppliers.ts",
      "lib/questionnaires/actions.ts",
    ];
    for (const file of files) {
      const text = source(file);
      const bare = [...text.matchAll(/requireOrgSession\(\)/g)];
      for (const match of bare) {
        const preceding = text.slice(
          Math.max(0, match.index - 320),
          match.index,
        );
        expect(
          /own|self|themselves|their own/i.test(preceding),
          `${file}: a bare requireOrgSession() with no "acting on themselves" note`,
        ).toBe(true);
      }
    }
  });
});
