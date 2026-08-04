import { describe, it, expect } from "vitest";
import { Column, SQL, StringChunk, is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../schema";

// THIS FILE CONTRIBUTES NOTHING TO THE COVERAGE NUMBER, BY DESIGN.
//
// `schema.ts` is excluded from coverage (see vitest.config.ts): it is 2000
// lines of declaration in which v8 measures ZERO branches, so "covering" it
// would mean executing table definitions and calling that proof. This file is
// the part of schema.ts that IS worth asserting — the invariants a migration or
// a careless column addition can break — separated out precisely so nobody is
// tempted to un-exclude the file to make these assertions "count".
//
// If you are here to raise a percentage, this is the wrong file.

const TABLES = Object.values(schema).filter((value) => is(value, PgTable));
const configs = TABLES.map((table) => getTableConfig(table));
const byName = new Map(configs.map((config) => [config.name, config]));

/** Render a partial index's predicate as flat text: `group_id is null`. */
function predicateText(predicate: SQL | undefined): string {
  if (!predicate) return "";
  let text = "";
  const walk = (chunk: unknown): void => {
    if (is(chunk, SQL)) {
      for (const inner of chunk.queryChunks) walk(inner);
      return;
    }
    if (is(chunk, StringChunk)) text += chunk.value.join("");
    else if (is(chunk, Column)) text += chunk.name;
  };
  walk(predicate);
  return text.replace(/\s+/g, " ").trim();
}

describe("the schema is actually enumerable", () => {
  it("exports the tables this file sweeps", () => {
    // Guard against a vacuous suite: every assertion below loops over TABLES,
    // and a loop over an empty list passes silently.
    expect(TABLES.length).toBeGreaterThan(30);
    expect(byName.has("burner_bios")).toBe(true);
    expect(byName.has("questionnaire_responses")).toBe(true);
  });
});

describe("encrypted columns", () => {
  // Pinned deliberately. crypto.ts encrypts exactly these, and adding a third
  // `*_encrypted` column without wiring it through `encrypt`/`decryptField`
  // passes lint, typecheck, build and every other test in the repo — and only
  // surfaces as plaintext personal information in a live database.
  const ENCRYPTED_COLUMNS = ["sa_id_encrypted", "passport_encrypted"] as const;

  const found = configs.flatMap((config) =>
    config.columns
      .filter((column) => column.name.endsWith("_encrypted"))
      .map((column) => ({ table: config.name, column })),
  );

  it("are exactly the set crypto.ts knows how to read", () => {
    expect(found.map((f) => f.column.name).sort()).toEqual(
      [...ENCRYPTED_COLUMNS].sort(),
    );
  });

  it("are text and NULLABLE — an unreadable column must be storable as absent", () => {
    for (const { table, column } of found) {
      expect(`${table}.${column.name} ${column.columnType}`).toBe(
        `${table}.${column.name} PgText`,
      );
      expect(`${table}.${column.name} notNull=${column.notNull}`).toBe(
        `${table}.${column.name} notNull=false`,
      );
    }
  });

  it("have NO plaintext sibling column", () => {
    // `sa_id_encrypted` alongside a `sa_id` would make the encryption
    // decorative. HARD_LOCKED_PRIVATE_FIELDS covers the projection layer; this
    // covers the storage layer.
    for (const { table, column } of found) {
      const plaintext = column.name.replace(/_encrypted$/, "");
      const names = byName.get(table)?.columns.map((c) => c.name) ?? [];
      expect(`${table}: ${names.includes(plaintext) ? plaintext : "none"}`).toBe(
        `${table}: none`,
      );
    }
  });
});

describe("questionnaire_responses uniqueness (migration 0028)", () => {
  const config = byName.get("questionnaire_responses");
  const unique = (config?.indexes ?? [])
    .map((index) => (index as unknown as { config: {
      name: string;
      unique: boolean;
      columns: { name: string }[];
      where?: SQL;
    } }).config)
    .filter((index) => index.unique);

  it("keeps TWO partial unique indexes, each carrying its predicate", () => {
    // When 0028 landed, every questionnaire write in the product failed with
    // "there is no unique or exclusion constraint matching the ON CONFLICT
    // specification" — the Burner Bio spine, the org's check-ins and the
    // artwork/vehicle registration path — and the screen said only "Something
    // went wrong". Postgres will not resolve an ON CONFLICT against a PARTIAL
    // index unless the statement repeats the predicate, so the predicates are
    // half of the contract. questionnaire-upsert-target.test.ts pins the
    // CALLER's half; this pins the schema's.
    expect(unique).toHaveLength(2);

    const personScoped = unique.find((i) => !i.columns.some((c) => c.name === "group_id"));
    const campScoped = unique.find((i) => i.columns.some((c) => c.name === "group_id"));

    expect(personScoped?.columns.map((c) => c.name)).toEqual([
      "user_id",
      "definition_key",
      "edition_id",
    ]);
    expect(predicateText(personScoped?.where)).toBe("group_id is null");

    expect(campScoped?.columns.map((c) => c.name)).toEqual([
      "user_id",
      "definition_key",
      "edition_id",
      "group_id",
    ]);
    expect(predicateText(campScoped?.where)).toBe("group_id is not null");
  });
});

describe("account_deletion_requests still answers the cancellation query", () => {
  it("carries every column cancelPendingDeletion reads and writes", () => {
    // deletion.ts selects these by name. A rename would be caught by tsc there,
    // but this states the dependency where the column lives — the 14-day
    // "just sign in" promise is the thing on the other end of it.
    const columns = byName.get("account_deletion_requests")?.columns.map((c) => c.name) ?? [];
    for (const required of [
      "id",
      "user_id",
      "status",
      "requested_at",
      "grace_ends_at",
      "cancelled_at",
      "completed_at",
      "updated_at",
    ]) {
      expect(`${required}: ${columns.includes(required)}`).toBe(`${required}: true`);
    }
  });
});

describe("self-consistency across every exported table", () => {
  it("names every table in snake_case, with no duplicates", () => {
    // The migrations are generated FROM these names; a camelCase table would
    // need quoting everywhere and a duplicate would silently shadow.
    const names = configs.map((config) => config.name);
    expect(names.filter((name) => !/^[a-z][a-z0-9_]*$/.test(name))).toEqual([]);
    expect(names.length).toBe(new Set(names).size);
  });

  it("points every foreign key at a table this module exports", () => {
    // A dangling reference is a migration that will not apply — discovered at
    // deploy time, against production, which is the only place migrations run.
    const known = new Set(configs.map((config) => config.name));
    const dangling: string[] = [];
    for (const config of configs) {
      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference();
        const target = getTableConfig(reference.foreignTable).name;
        if (!known.has(target)) dangling.push(`${config.name} -> ${target}`);
      }
    }
    expect(dangling).toEqual([]);
  });
});
