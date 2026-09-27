import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// "ARCHIVING REVOKES CAMP ACCESS" (App Spec CDB-036, decided 2026-09-27, #55)
// is only true if EVERY membership query that decides access or reach filters
// archived rows out. There were ~80 such queries across both apps when the
// column was added, and the next one written will not know about it — a
// forgotten filter is a former member who can still read the roster, receive
// announcements or see a medical note, and nothing else would catch it: the
// db mock cannot see a WHERE clause (test/db-mock.ts says so).
//
// So this is a source assertion over the whole monorepo, the way
// deletion-guards.test.ts pins the tombstone filters. Every statement that
// names `schema.memberships` as a TABLE (from / join / update / an sql``
// interpolation) must either:
//
//   - filter through `activeMembership()` / `formerMembership()` (or name
//     `archivedAt` directly), or
//   - carry a `former members:` comment saying why it deliberately reads
//     archived rows too (ref-code allocation, the org group, sanitisation…).
//
// A new query that does neither fails here, with its file and line.

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

const ROOTS = [
  "apps/web/lib",
  "apps/web/app",
  "apps/web/components",
  "apps/org/lib",
  "apps/org/app",
  "apps/org/components",
  "apps/suppliers/lib",
  "apps/suppliers/app",
  "packages/auth/src",
  "packages/db/src",
];

const SKIP_FILES = new Set([
  // The table's definition and the predicate's own home.
  "packages/db/src/schema.ts",
  "packages/db/src/membership-archive.ts",
]);

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "__tests__" || name === ".next")
      continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
      out.push(full);
  }
}

/** A query site: `schema.memberships` used as a table, not `schema.memberships.col`. */
const SITE = /schema\.memberships(?![.\w])/g;

interface Site {
  file: string;
  line: number;
  statement: string;
}

function sites(): Site[] {
  const files: string[] = [];
  for (const root of ROOTS) walk(path.join(REPO, root), files);
  const found: Site[] = [];
  for (const file of files) {
    const rel = path.relative(REPO, file);
    if (SKIP_FILES.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(SITE)) {
      const at = m.index ?? 0;
      // Skip type positions (`typeof schema.memberships.$inferSelect` is
      // excluded by the regex already) and `insert`/`delete` — an insert
      // creates an ACTIVE row and a delete removes one, neither can hand a
      // former member access.
      const before = src.slice(Math.max(0, at - 20), at);
      if (/(insert|delete)\(\s*$/.test(before)) continue;
      // The statement: from the previous `;` to the next one. Comment lines
      // directly above the statement fall inside it.
      const start = src.lastIndexOf(";", at) + 1;
      const endIdx = src.indexOf(";", at);
      const end = endIdx === -1 ? src.length : endIdx;
      found.push({
        file: rel,
        line: src.slice(0, at).split("\n").length,
        statement: src.slice(start, end),
      });
    }
  }
  return found;
}

const FILTERED =
  /activeMembership\(\)|formerMembership\(\)|archivedAt|archived_at/;
const EXEMPTED = /former members:/;

describe("every membership query knows about former members", () => {
  const all = sites();

  it("finds the membership queries at all (the scan is not vacuous)", () => {
    // If a refactor moved the stores and this scan silently matched nothing,
    // every assertion below would pass. Pin a floor under the count.
    expect(all.length).toBeGreaterThan(60);
  });

  it("each one filters archived rows or says why it reads them", () => {
    const offenders = all
      .filter((s) => !FILTERED.test(s.statement) && !EXEMPTED.test(s.statement))
      .map((s) => `${s.file}:${s.line}`);
    expect(offenders).toEqual([]);
  });
});
