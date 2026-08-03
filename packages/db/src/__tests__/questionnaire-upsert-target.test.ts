import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// REGRESSION: migration 0028 split `questionnaire_responses` uniqueness into two
// PARTIAL indexes — person-scoped answers unique per (user, definition, edition)
// WHERE group_id IS NULL, camp-scoped ones including the camp.
//
// Postgres will not use a partial index to resolve `ON CONFLICT (cols)` unless
// the statement repeats the index's predicate. Every existing upsert targeted
// the three columns and nothing else, so the moment 0028 applied they all failed
// with:
//
//     there is no unique or exclusion constraint matching the ON CONFLICT
//     specification
//
// That is EVERY questionnaire write — the Burner Bio onboarding spine, the org's
// check-ins, and the artwork/mutant-vehicle registration path. The migration's
// own verification had exercised inserts and the uniqueness rules and never once
// an upsert, which is how the app actually writes; an e2e run caught it, on a
// screen that just said "Something went wrong".
//
// This pins the fix at the only place it can be pinned without a live database:
// the source. A fourth upsert added later without `targetWhere` fails here
// rather than in production.

const UPSERT_SITES = [
  "../../../../apps/web/lib/questionnaire-store.ts",
  "../../../../apps/web/lib/project-registration-store.ts",
  "../../../../apps/org/lib/questionnaires/actions.ts",
];

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * Every `.onConflictDoUpdate({...})` block in a source file, as raw text.
 * Brace-counted rather than regexed, because these blocks nest.
 */
function conflictBlocks(source: string): string[] {
  const blocks: string[] = [];
  const marker = ".onConflictDoUpdate(";
  let from = 0;
  for (;;) {
    const start = source.indexOf(marker, from);
    if (start === -1) break;
    let depth = 0;
    let i = start + marker.length - 1;
    for (; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    blocks.push(source.slice(start, i + 1));
    from = i + 1;
  }
  return blocks;
}

describe("questionnaire_responses upserts name a partial index", () => {
  for (const site of UPSERT_SITES) {
    const name = site.split("/").slice(-2).join("/");

    it(`${name} passes targetWhere on every questionnaire-response upsert`, () => {
      const source = read(site);
      const offenders = conflictBlocks(source)
        .filter((block) => block.includes("questionnaireResponses"))
        .filter((block) => !block.includes("targetWhere"));

      expect(
        offenders.length,
        `An ON CONFLICT on questionnaire_responses without targetWhere. ` +
          `Since migration 0028 the unique indexes are PARTIAL, so Postgres ` +
          `cannot match this and the insert fails at runtime. Add ` +
          `targetWhere: isNull(schema.questionnaireResponses.groupId) for a ` +
          `person-scoped answer, or isNotNull(...) for a camp-scoped one.`,
      ).toBe(0);
    });

    it(`${name} still has at least one such upsert to check`, () => {
      // Guards the guard: if these files are refactored and the upsert moves,
      // the test above would pass vacuously and prove nothing.
      const blocks = conflictBlocks(read(site)).filter((b) =>
        b.includes("questionnaireResponses"),
      );
      expect(blocks.length).toBeGreaterThan(0);
    });
  }
});
