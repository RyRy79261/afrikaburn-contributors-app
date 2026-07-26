import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// REGRESSION: medical information — including the mere FACT that a burner has
// disclosed any — must never reach a list, roster, card or export (AGENTS.md
// §Privacy classes). Only a member's DETAIL view resolves it, because that is
// the surface that both authorizes AND records (`bio.medical.view`) the read.
//
// This is a source-level test on purpose. `lib/queries.ts` is `server-only` and
// talks to the DB, so the guarantee cannot be asserted by calling it — but the
// guarantee is a property of the SQL projection and the JSX, both of which are
// plain text. A future edit that re-adds `medicalNotes` to the roster select,
// or a `hasMedical` flag to the roster component, fails here immediately.
//
// If the signpost is ever deliberately reinstated it needs Ryan's ruling and an
// amendment to AGENTS.md:108-111 first — then this test changes with it, which
// is the point: the law and the code cannot drift apart silently.

function source(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relative}`, import.meta.url)),
    "utf8",
  );
}

/** The body of a named exported function, so the assertion is scoped to it. */
function functionBody(text: string, name: string): string {
  const start = text.indexOf(`export async function ${name}`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);

  // Skip the PARAMETER LIST before looking for the body. Taking the first `{`
  // after the name breaks the moment a parameter carries an inline object type
  // (`options: { includeMedicalNotes: boolean }`) — it balances immediately and
  // returns the annotation instead of the body, so every assertion below then
  // passes or fails for the wrong reason.
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

describe("REGRESSION: the org roster carries nothing medical", () => {
  const queries = source("lib/queries.ts");

  it("getRegistrationRoster never selects medical_notes", () => {
    const body = functionBody(queries, "getRegistrationRoster");
    expect(body).not.toMatch(/medicalNotes/);
    expect(body).not.toMatch(/medical_notes/);
  });

  it("getRegistrationRoster exposes no has/has-not medical flag", () => {
    const body = functionBody(queries, "getRegistrationRoster");
    expect(body.toLowerCase()).not.toMatch(/hasmedical/);
  });

  it("RosterMemberRow has no medical field of any kind", () => {
    const start = queries.indexOf("export interface RosterMemberRow");
    expect(start).toBeGreaterThan(-1);
    const shape = queries.slice(start, queries.indexOf("}", start));
    expect(shape.toLowerCase()).not.toMatch(/medical/);
  });

  it("the member DETAIL query is still the one place notes are decrypted", () => {
    // The counterpart guarantee: removing the roster leak must not have removed
    // the legitimate, audited purposeful-access path.
    const detail = functionBody(queries, "getRosterMemberDetail");
    expect(detail).toMatch(/medicalNotes/);
    expect(detail).toMatch(/decryptOrNull/);
  });

  it("the DETAIL query authorises BEFORE it selects the column", () => {
    // The caller runs `canViewMedicalNotes` and passes the answer in, so a
    // refusal never loads the ciphertext at all. Deciding after the decrypt
    // leaves plaintext in render scope with only a conditional between it and
    // an RSC payload.
    const detail = functionBody(queries, "getRosterMemberDetail");
    expect(detail).toMatch(/options\.includeMedicalNotes/);

    const page = source(
      "app/(console)/registrations/[id]/members/[userId]/page.tsx",
    );
    const predicateAt = page.indexOf("canViewMedicalNotes(");
    const fetchAt = page.indexOf("getRosterMemberDetail(");
    expect(predicateAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(predicateAt).toBeLessThan(fetchAt);
  });

  it("the roster component renders no medical text or icon", () => {
    const roster = source("components/member-roster.tsx");
    const rendered = roster.replace(/\/\*[\s\S]*?\*\//g, ""); // strip doc comments
    expect(rendered.toLowerCase()).not.toMatch(/medical/);
    expect(rendered).not.toMatch(/Stethoscope/);
  });
});
