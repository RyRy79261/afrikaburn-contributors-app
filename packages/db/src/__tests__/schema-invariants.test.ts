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
      expect(
        `${table}: ${names.includes(plaintext) ? plaintext : "none"}`,
      ).toBe(`${table}: none`);
    }
  });
});

describe("questionnaire_responses uniqueness (migration 0028)", () => {
  const config = byName.get("questionnaire_responses");
  const unique = (config?.indexes ?? [])
    .map(
      (index) =>
        (
          index as unknown as {
            config: {
              name: string;
              unique: boolean;
              columns: { name: string }[];
              where?: SQL;
            };
          }
        ).config,
    )
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

    const personScoped = unique.find(
      (i) => !i.columns.some((c) => c.name === "group_id"),
    );
    const campScoped = unique.find((i) =>
      i.columns.some((c) => c.name === "group_id"),
    );

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
    const columns =
      byName.get("account_deletion_requests")?.columns.map((c) => c.name) ?? [];
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
      expect(`${required}: ${columns.includes(required)}`).toBe(
        `${required}: true`,
      );
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

describe("work access passes (migration 0036)", () => {
  type IndexConfig = {
    name: string;
    unique: boolean;
    columns: { name: string }[];
    where?: SQL;
  };
  const indexes = (table: string): IndexConfig[] =>
    (byName.get(table)?.indexes ?? []).map(
      (index) => (index as unknown as { config: IndexConfig }).config,
    );

  it("allows at most ONE pending request per registration", () => {
    // The store asks "is there a pending request?" and inserts; two tabs
    // racing that check must collide here, not both succeed. The predicate is
    // the whole point — without it a project could only ever ask once.
    const pending = indexes("wap_requests").find(
      (i) => i.name === "wap_requests_one_pending_idx",
    );
    expect(pending?.unique).toBe(true);
    expect(pending?.columns.map((c) => c.name)).toEqual(["registration_id"]);
    expect(predicateText(pending?.where)).toBe("status = 'pending'");
  });

  it("holds one pass per person per registration", () => {
    const uniq = indexes("wap_allocations").find(
      (i) => i.name === "wap_allocations_registration_membership_idx",
    );
    expect(uniq?.unique).toBe(true);
    expect(uniq?.columns.map((c) => c.name)).toEqual([
      "registration_id",
      "membership_id",
    ]);
  });

  it("caps grants at the ask and ties `granted` to the status", () => {
    const checks = (byName.get("wap_requests")?.checks ?? []).map(
      (c) => c.name,
    );
    expect(checks.sort()).toEqual([
      "wap_requests_granted_iff_status",
      "wap_requests_granted_within_ask",
      "wap_requests_requested_positive",
    ]);
  });

  it("cascades a pass with its membership and its registration", () => {
    // Leaving a camp takes the pass with it; an approved list then reads
    // "1 removed since approval" from the snapshot, never a dangling row.
    const fks = byName.get("wap_allocations")?.foreignKeys ?? [];
    const onDelete = Object.fromEntries(
      fks.map((fk) => [
        getTableConfig(fk.reference().foreignTable).name +
          "." +
          fk.reference().foreignColumns[0]!.name,
        fk.onDelete,
      ]),
    );
    expect(onDelete["memberships.id"]).toBe("cascade");
    expect(onDelete["registrations.id"]).toBe("cascade");
    expect(onDelete["users.id"]).toBe("set null");
  });

  it("mirrors the status vocabularies in @quagga/types", async () => {
    const types = await import("@quagga/types");
    expect(schema.wapListStatusEnum.enumValues).toEqual(
      types.WapListStatus.options,
    );
    expect(schema.wapRequestStatusEnum.enumValues).toEqual(
      types.WapRequestStatus.options,
    );
    expect(schema.notificationKindEnum.enumValues).toEqual(
      types.NotificationKind.options,
    );
  });
});

describe("camp money (migration 0037)", () => {
  const MONEY_TABLES = [
    "camp_budgets",
    "budget_categories",
    "budget_entries",
    "member_dues",
    "dues_payments",
    "camp_claims",
  ] as const;

  const fkMap = (table: string) =>
    (byName.get(table)?.foreignKeys ?? []).map((fk) => ({
      column: fk.reference().columns[0]!.name,
      target: getTableConfig(fk.reference().foreignTable).name,
      onDelete: fk.onDelete,
    }));

  it("exists", () => {
    for (const table of MONEY_TABLES) expect(byName.has(table)).toBe(true);
  });

  it("never hangs the books off a membership, and never cascades a person away", () => {
    // `leaveCamp` deletes the membership row; a money row keyed by it would
    // vanish with it, and the books must add up (spec: "former members keep
    // their dues, payments and claims"). People are users, SET NULL.
    for (const table of MONEY_TABLES) {
      for (const fk of fkMap(table)) {
        expect(fk.target).not.toBe("memberships");
        if (fk.target === "users") {
          expect(`${table}.${fk.column}:${fk.onDelete}`).toBe(
            `${table}.${fk.column}:set null`,
          );
        }
      }
    }
  });

  it("lets a camp's deletion cascade through its categories (NO ACTION, not RESTRICT)", () => {
    for (const table of ["budget_entries", "camp_claims"]) {
      const fk = fkMap(table).find((f) => f.target === "budget_categories");
      expect(fk?.onDelete).toBe("no action");
    }
  });

  it("pins the amount and claim CHECKs", () => {
    const checks = (table: string) =>
      (byName.get(table)?.checks ?? []).map((c) => c.name).sort();
    expect(checks("camp_claims")).toEqual([
      "camp_claims_amount_positive",
      "camp_claims_approved_has_category",
      "camp_claims_decided_iff_not_submitted",
      "camp_claims_not_decided_by_self",
      "camp_claims_not_repaid_by_self",
      "camp_claims_receipt_paired",
      "camp_claims_repaid_on_iff_repaid",
    ]);
    expect(checks("dues_payments")).toEqual(["dues_payments_amount_positive"]);
    expect(checks("budget_entries")).toEqual([
      "budget_entries_amount_positive",
      "budget_entries_receipt_paired",
    ]);
    expect(checks("member_dues")).toEqual(["member_dues_amount_non_negative"]);
  });

  it("mirrors the money vocabularies in @quagga/types", async () => {
    const types = await import("@quagga/types");
    expect(schema.campBudgetStatusEnum.enumValues).toEqual(
      types.CampBudgetStatus.options,
    );
    expect(schema.budgetCategoryKindEnum.enumValues).toEqual(
      types.BudgetCategoryKind.options,
    );
    expect(schema.budgetEntryStatusEnum.enumValues).toEqual(
      types.BudgetEntryStatus.options,
    );
    expect(schema.campClaimStatusEnum.enumValues).toEqual(
      types.CampClaimStatus.options,
    );
  });
});

describe("camp layouts (migration 0038)", () => {
  const fkMap = (table: string) =>
    (byName.get(table)?.foreignKeys ?? []).map((fk) => ({
      column: fk.reference().columns[0]!.name,
      target: getTableConfig(fk.reference().foreignTable).name,
      onDelete: fk.onDelete,
    }));

  it("is owned by the registration — one layout per registration", () => {
    const owner = fkMap("camp_layouts").find(
      (f) => f.column === "registration_id",
    );
    expect(owner).toEqual({
      column: "registration_id",
      target: "registrations",
      onDelete: "cascade",
    });
    const unique = byName
      .get("camp_layouts")
      ?.indexes.find((i) => i.config.name === "camp_layouts_registration_idx");
    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.columns.map((c) => (c as Column).name)).toEqual([
      "registration_id",
    ]);
  });

  it("keeps snapshots append-only: never unique on version, so a resubmit adds a row", () => {
    for (const i of byName.get("camp_layout_snapshots")?.indexes ?? []) {
      expect(i.config.unique).toBe(false);
    }
  });

  it("never cascades a person away, and never hangs off a membership", () => {
    for (const table of ["camp_layouts", "camp_layout_snapshots"]) {
      for (const fk of fkMap(table)) {
        expect(fk.target).not.toBe("memberships");
        if (fk.target === "users") {
          expect(`${table}.${fk.column}:${fk.onDelete}`).toBe(
            `${table}.${fk.column}:set null`,
          );
        }
      }
    }
  });

  it("pins the version CHECKs", () => {
    const checks = (table: string) =>
      (byName.get(table)?.checks ?? []).map((c) => c.name).sort();
    expect(checks("camp_layouts")).toEqual(["camp_layouts_version_positive"]);
    expect(checks("camp_layout_snapshots")).toEqual([
      "camp_layout_snapshots_version_positive",
    ]);
  });
});

describe("camp meetings (migration 0039)", () => {
  const fkMap = (table: string) =>
    (byName.get(table)?.foreignKeys ?? []).map((fk) => ({
      column: fk.reference().columns[0]!.name,
      target: getTableConfig(fk.reference().foreignTable).name,
      onDelete: fk.onDelete,
    }));

  it("belongs to the camp and the edition, and goes with either", () => {
    const fks = fkMap("camp_meetings");
    expect(fks.find((f) => f.column === "group_id")).toEqual({
      column: "group_id",
      target: "groups",
      onDelete: "cascade",
    });
    expect(fks.find((f) => f.column === "edition_id")).toEqual({
      column: "edition_id",
      target: "editions",
      onDelete: "cascade",
    });
  });

  it("never cascades a meeting away with a person, and never hangs off a membership", () => {
    for (const fk of fkMap("camp_meetings")) {
      expect(fk.target).not.toBe("memberships");
      if (fk.target === "users") {
        expect(`camp_meetings.${fk.column}:${fk.onDelete}`).toBe(
          `camp_meetings.${fk.column}:set null`,
        );
      }
    }
    // "Who came" is keyed by user, so archiving a member keeps the record;
    // erasure removes the rows explicitly (apps/web/lib/account-sanitize.ts).
    for (const fk of fkMap("camp_meeting_attendees")) {
      expect(fk.target).not.toBe("memberships");
    }
  });

  it("pins the CHECKs: time in the day, a real length, https links, its own camp", () => {
    const checks = (byName.get("camp_meetings")?.checks ?? [])
      .map((c) => c.name)
      .sort();
    expect(checks).toEqual([
      "camp_meetings_audience_is_this_camp",
      "camp_meetings_cancelled_by_needs_cancelled_at",
      "camp_meetings_duration_bounds",
      "camp_meetings_start_minute_in_day",
      "camp_meetings_version_positive",
      "camp_meetings_video_link_https",
    ]);
    const https = byName
      .get("camp_meetings")
      ?.checks.find((c) => c.name === "camp_meetings_video_link_https");
    expect(predicateText(https?.value)).toContain("like 'https://%'");
  });

  it("ticks one person once per meeting", () => {
    const pk = byName.get("camp_meeting_attendees")?.primaryKeys[0];
    expect(pk?.columns.map((c) => c.name)).toEqual(["meeting_id", "user_id"]);
  });
});
