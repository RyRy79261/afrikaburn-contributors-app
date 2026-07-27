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
//     query that returns a person resolves `canReadPersonalInformation` first
//     and puts the personal columns behind that answer, so a refused caller's
//     row never contains them — and therefore no RSC payload does either,
//     whatever a component would or would not have rendered.
//  2. EVERY MUTATION NAMES THE CAPABILITY IT NEEDS. A destructive action asks
//     for `delete`, the camp-category taxonomy asks for `manage_camp_categories`,
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
  // query name → the column expressions that must never survive the refusal.
  const GUARDED: Record<string, string[]> = {
    searchAccounts: ["schema.users.email"],
    // The System panel's org-access roster. An engineer may open that page —
    // it is THEIR page — so the roster on it is the one people-returning query
    // most likely to be written as "they can see this page, so let them see the
    // rows", which is exactly the mistake.
    getOrgAccessRoster: ["schema.users.email"],
    getRegistrationOfficers: [
      "schema.burnerBios.contactEmail",
      "schema.burnerBios.phone",
      "schema.users.email",
    ],
    getRegistrationDecisionLog: ["schema.users.email"],
    getSupplierNotes: ["schema.users.email"],
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

  for (const [name, columns] of Object.entries(GUARDED)) {
    it(`${name} resolves the predicate before it selects`, () => {
      const body = functionBody(queries, name);
      const predicateAt = body.indexOf("seesPersonalInformation(actor)");
      const selectAt = body.indexOf(".select(");
      expect(predicateAt, `${name} never asks`).toBeGreaterThan(-1);
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
    const predicateAt = body.indexOf("seesPersonalInformation(actor)");
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

  it("checks `read_system` before it queries anything", () => {
    const checkAt = systemPage.indexOf('orgCan(session.actor, "read_system")');
    const probeAt = systemPage.indexOf("getSystemStatus()");
    const rosterAt = systemPage.indexOf("getOrgAccessRoster(");
    expect(checkAt, "the page never asks").toBeGreaterThan(-1);
    expect(probeAt).toBeGreaterThan(-1);
    expect(rosterAt).toBeGreaterThan(-1);
    expect(checkAt).toBeLessThan(probeAt);
    expect(checkAt).toBeLessThan(rosterAt);
  });

  it("refuses honestly rather than 404-ing", () => {
    expect(systemPage).toContain(
      'orgCapabilityRefusal(session.actor, "read_system")',
    );
  });

  it("does not let page ACCESS imply account management", () => {
    // An engineer holds `read_system` and not `manage_accounts`. The roster's
    // controls must resolve the second capability, not inherit the first — the
    // whole reason `read_system` is documented as a READ.
    expect(systemPage).toContain('orgCan(session.actor, "manage_accounts")');
    expect(systemPage).toContain(
      'orgCan(session.actor, "read_personal_information")',
    );
  });

  it("hides its nav entry behind the same capability the page enforces", () => {
    // Hiding is never the boundary — but an entry that leads somewhere the
    // viewer is refused is its own defect, and both must read one predicate.
    const header = source("components/console-header.tsx");
    expect(header).toMatch(/href: "\/system"[\s\S]{0,80}capability: "read_system"/);
    expect(header).toContain("orgCan(session.actor, item.capability)");
  });

  it("never prints a secret — the derivation is proved separately", () => {
    // The page renders `SystemCheck.value` / `.detail` verbatim, so the promise
    // lives in the deriver. Asserted here only that the page does not reach
    // around it into process.env for something to display.
    expect(systemPage).not.toContain("process.env");
  });
});

describe("REGRESSION: the medical DISCLOSURE CENSUS is not readable by rank", () => {
  // A `bio.medical.view` row only exists when the subject HAS notes, so a list
  // of those rows names the burners who have disclosed a health condition.

  it("the medical access log refuses a rank without personal information", () => {
    const guard = functionBody(medicalAudit, "canReadMedicalAccessLog");
    expect(guard).toContain("canReadPersonalInformation");

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
    // Destructive — never an engineer.
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
    // The camp-category taxonomy — System manager only (Ryan named this one).
    {
      file: "lib/actions/categories.ts",
      action: "createCategory",
      capability: "manage_camp_categories",
    },
    {
      file: "lib/actions/categories.ts",
      action: "updateCategory",
      capability: "manage_camp_categories",
    },
    {
      file: "lib/actions/categories.ts",
      action: "deleteCategory",
      capability: "manage_camp_categories",
    },
    {
      file: "lib/actions/categories.ts",
      action: "setGroupCategory",
      capability: "manage_camp_categories",
    },
    // Access management — System manager only.
    {
      file: "lib/actions/accounts.ts",
      action: "setOrgStaffRole",
      capability: "manage_accounts",
    },
    {
      file: "lib/actions/accounts.ts",
      action: "setOrgDepartment",
      capability: "manage_accounts",
    },
    // Ordinary console work — every rank, but still declared.
    {
      file: "lib/actions/registrations.ts",
      action: "decideRegistration",
      capability: "write",
    },
    {
      file: "lib/actions/suppliers.ts",
      action: "setSupplierStanding",
      capability: "write",
    },
    {
      file: "lib/actions/suppliers.ts",
      action: "addSupplier",
      capability: "write",
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
