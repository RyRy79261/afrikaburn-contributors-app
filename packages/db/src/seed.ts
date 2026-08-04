/**
 * Idempotent seed script (build-spec §Seeds).
 *
 * ## The seeding principle (Ryan, 26 Jul 2026 — binding)
 *
 * **Seeds contain ONLY org-owned reference/catalog data. Every burner, camp,
 * membership, registration and questionnaire response — in EVERY environment,
 * including the kickoff demo — is created live through the app.**
 *
 * There are no seeded accounts and no seeded user-generated content. The demo
 * is performed live: Ryan signs up as a real burner, registers Camp 404 through
 * the actual wizard, and the org side reviews it. That is more honest (it shows
 * the real journey) and it removes an entire class of seed/auth-identity drift —
 * seeded users previously carried placeholder `authUserId = seed:<email>`
 * strings and could never sign in, which made every "sign in as a seeded owner"
 * step of every smoke test un-performable.
 *
 * ### Seeded (org-owned reference/catalog data)
 *   - edition AfrikaBurn 2027 (2027-04-26 → 2027-05-02, active)
 *   - the org group "AfrikaBurn" itself (no memberships — staff elevate live via
 *     GOD_EMAILS — the kickoff demo beat)
 *   - the two seeded ORG ROLES (Org staff, Engineer) carrying the rights those
 *     ranks held before they became data. Insert-if-missing, so a System
 *     manager's own edits to them survive every later deploy. No departments and
 *     no role ASSIGNMENTS are seeded — those are live acts.
 *   - the 8 canonical camp categories for the edition (org taxonomy; the org may
 *     edit freely afterwards)
 *   - the supplier repository imported from data/suppliers.json (the scrubbed AB
 *     public sheet snapshot) + each supplier's per-edition onboarding step map.
 *     This is a CATALOG camps pick from, not user content. Suppliers seed with
 *     `userId = null` on purpose, so a real supplier can later self-register and
 *     claim their row by email overlap (docs/supplier-spec.md).
 *   - one org-authored questionnaire TEMPLATE (definition only — no activation,
 *     no audience, no responses), so the console has a real form to send live.
 *
 * ### Never seeded
 *   - users, burner bios, theme camps / artworks / mutant vehicles, memberships,
 *     invites, registrations, supplier declarations, section reviews,
 *     questionnaire activations / required actions / responses, notifications,
 *     bulletins, audit events, supplier notes. All of it is live-created.
 *   - payments: AfrikaBurn never receives payment from theme camps —
 *     registration is free. The `payments` table stays frozen in the schema for
 *     future logistics apps, but nothing is ever seeded against registrations.
 *
 * Safe to run repeatedly: every write is keyed on the row's real unique
 * constraint (or, where none exists, a find-then-write lookup).
 *
 * BOOTSTRAP, NOT SYNC — and "safe to run repeatedly" means the SECOND run
 * changes nothing, not merely that it does not crash. Anything the org can edit
 * in the console (a supplier's standing, its onboarding progress, which domains
 * a department owns) is INSERT-IF-MISSING here. A seed that re-asserts the
 * committed snapshot reverts real decisions on a schedule, silently, and the
 * deploy that did it logs nothing an organiser would ever see.
 *
 * Run via `pnpm --filter @quagga/db db:seed` once `DATABASE_URL` is set. This
 * script is NEVER part of any build step and must not run at import time.
 */
import { pathToFileURL } from "node:url";
import { eq, and, sql } from "drizzle-orm";
import {
  CANONICAL_CAMP_CATEGORIES,
  SOUND_SCALE,
  SEEDED_ORG_DEPARTMENTS,
  departmentRoleRows,
  normalizeCategoryLabel,
  normalizeName,
  seededOrgRoleRows,
} from "@quagga/core";
import { SupplierImportRow } from "@quagga/types";
import type { Questionnaire, SupplierOnboardingSteps } from "@quagga/types";
import { createPooledDb } from "./index";
import * as schema from "./schema";
import suppliersDataRaw from "./data/suppliers.json" with { type: "json" };

// Validate the committed snapshot against the shared Zod schema at the
// boundary (build-spec: "Zod validation at every boundary") rather than
// trusting the JSON import's inferred `string` types.
const suppliersData = {
  ...suppliersDataRaw,
  suppliers: suppliersDataRaw.suppliers.map((row) =>
    SupplierImportRow.parse(row),
  ),
};

/** First row of a `.returning()` result, or throw — every insert here is a
 * single-row upsert, so an empty result means something is badly wrong. */
function firstOrThrow<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`[seed] expected a row after writing ${what}`);
  return row;
}

// --- Small local helpers (kept in-script — apps/web's slugify is a
// "server-only" module and not importable from a standalone db script). ----

function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "camp"
  );
}

type Db = ReturnType<typeof createPooledDb>["db"];
type GroupRow = typeof schema.groups.$inferSelect;

// ---------------------------------------------------------------------------

/**
 * Insert the reference data the app cannot function without: the active edition,
 * the AfrikaBurn org group, the camp categories, the scrubbed supplier catalogue
 * and the org questionnaire template. NO accounts, camps or registrations — demo
 * data is created live through the app.
 *
 * Exported so the DEPLOY can bootstrap a brand-new database (see migrate.ts).
 * Every write goes through an idempotent `ensure*` helper, so calling it twice is
 * safe; the caller owns the connection.
 */
/**
 * Ensure the two seeded ORG ROLES exist (migration 0018), returning how many
 * were actually inserted.
 *
 * INSERT-IF-MISSING on the stable `key`, NEVER an update. The org console's
 * permissions live in these rows now, and a System manager may have re-righted
 * either of them — "idempotent" must mean "safe to run twice", not "reverts the
 * org's own edits on every deploy".
 *
 * Exported separately from `seedReferenceData` because the deploy calls it on
 * ALREADY-SEEDED databases too: one that predates org roles v1 has the new
 * tables and no rows, which would leave every org account able to sign in and do
 * nothing (see migrate.ts).
 */
export async function ensureSeededOrgRoles(db: Db): Promise<number> {
  let inserted = 0;
  for (const row of seededOrgRoleRows()) {
    const written = await db
      .insert(schema.orgRoles)
      .values(row)
      .onConflictDoNothing({ target: schema.orgRoles.key })
      .returning({ id: schema.orgRoles.id });
    inserted += written.length;
  }
  return inserted;
}

/**
 * The two departments that back a deployed portal, plus their domains and their
 * lead/member role pair. Insert-if-missing on the stable key, so a deployment
 * that already has them (from migration 0022, or hand-created before it) keeps
 * its rows, its assignments and any edits made to them.
 */
export async function ensureSeededOrgDepartments(db: Db): Promise<number> {
  let inserted = 0;
  for (const dept of SEEDED_ORG_DEPARTMENTS) {
    const [row] = await db
      .insert(schema.orgDepartments)
      .values({
        key: dept.key,
        name: dept.name,
        nameNormalized: normalizeName(dept.name),
        description: dept.description,
        kind: "system",
        sort: dept.sort,
      })
      .onConflictDoNothing({ target: schema.orgDepartments.key })
      .returning({ id: schema.orgDepartments.id });
    inserted += row ? 1 : 0;

    const [existing] = row
      ? [row]
      : await db
          .select({ id: schema.orgDepartments.id })
          .from(schema.orgDepartments)
          .where(eq(schema.orgDepartments.key, dept.key))
          .limit(1);
    if (!existing) continue;

    // Domains: ONLY for a department this call just created.
    //
    // `onConflictDoNothing` on the domain protects a domain some OTHER
    // department owns, and that is all it protects. It does not protect a
    // domain nobody owns — and "nobody owns it" is precisely what an org
    // TAKING A DOMAIN AWAY from a department looks like, because
    // `org_department_domains` records ownership by presence and an unassigned
    // domain is a deleted row. So every deploy re-filed `registrations` and
    // `camp_categories` under Theme camps and `suppliers` and
    // `supplier_documents` under Suppliers, whatever the org had decided,
    // handing every holder of those departments' LEAD roles
    // `personal_information` over those domains again — silently, with no audit
    // row, on a schedule nobody associated with a deploy.
    //
    // Gating on `row` (the insert returned one ⇒ the department did not exist)
    // makes this a bootstrap: a department we create starts owning what it is
    // for, and after that its domains are the org's business.
    //
    // In practice that branch will rarely be taken, and that is fine rather
    // than dead: migration 0022 inserts both departments AND their domains, and
    // migrations run before this does, so on every database that has reached
    // 0022 the rows are already there. This stays as the belt to the migration's
    // braces — it is what would file the domains on a database that somehow
    // reached the seed without them.
    if (row) {
      for (const domain of dept.domains) {
        await db
          .insert(schema.orgDepartmentDomains)
          .values({ domain, departmentId: row.id })
          .onConflictDoNothing({ target: schema.orgDepartmentDomains.domain });
      }
    }

    // The permanent lead/member pair, exactly as a System manager creating a
    // department gets.
    for (const roleRow of departmentRoleRows({
      id: existing.id,
      key: dept.key,
      name: dept.name,
    })) {
      await db
        .insert(schema.orgRoles)
        .values(roleRow)
        .onConflictDoNothing({ target: schema.orgRoles.key });
    }
  }
  return inserted;
}

export async function seedReferenceData(db: Db): Promise<void> {
  {
    // --- Edition -------------------------------------------------------------
    const edition = firstOrThrow(
      await db
        .insert(schema.editions)
        .values({
          name: "AfrikaBurn 2027",
          year: 2027,
          startDate: "2027-04-26",
          endDate: "2027-05-02",
          isActive: true,
        })
        .onConflictDoUpdate({
          target: schema.editions.year,
          set: { isActive: true, name: "AfrikaBurn 2027" },
        })
        .returning(),
      "the 2027 edition",
    );
    console.log(`[seed] edition: ${edition.name} (${edition.id})`);

    // --- Org group -------------------------------------------------------------
    // The org entity itself is reference data. No memberships seeded on purpose —
    // staff elevate live via GOD_EMAILS at the kickoff meeting,
    // and `createdByUserId` stays null because no seeded person exists to own it.
    const orgGroup = await ensureGroup(db, {
      kind: "org",
      name: "AfrikaBurn",
      description: "The organising body behind the AfrikaBurn event.",
      joinability: "invite_only",
    });
    console.log(`[seed] org group: ${orgGroup.name} (${orgGroup.id})`);

    // --- Org roles (org-owned access reference data) ---------------------------
    // The two SEEDED SYSTEM ROLES, carrying exactly the rights `org_staff` and
    // `engineer` held when those were hardcoded ranks. They are reference data
    // in the same sense the camp-category taxonomy is: org-owned structure the
    // org edits afterwards, never user content.
    //
    // INSERT-IF-MISSING, never update. A System manager who has re-righted the
    // Engineer role must not have that undone by the next deploy's seed —
    // "seeds are idempotent" means running twice is safe, not that the org's own
    // edits get reverted. Departments are NOT seeded at all: nobody can say how
    // many there are, so the console creates them (docs: Ryan, 27 Jul 2026).
    const orgRolesSeeded = await ensureSeededOrgRoles(db);
    console.log(`[seed] org roles ensured (${orgRolesSeeded} inserted)`);

    const deptsSeeded = await ensureSeededOrgDepartments(db);
    console.log(`[seed] org departments ensured (${deptsSeeded} inserted)`);

    // --- Camp categories (org-defined per-edition taxonomy) ---------------------
    // The canonical catalog for 2027. Org may edit freely afterwards. Camps pick
    // from these live — no group ↔ category links are seeded, because no camps
    // are seeded. Idempotent via the unique (edition, label_normalized) index.
    for (const [i, cat] of CANONICAL_CAMP_CATEGORIES.entries()) {
      await ensureCampCategory(db, edition.id, {
        label: cat.label,
        emoji: cat.emoji,
        sort: i,
      });
    }
    console.log(
      `[seed] camp categories seeded: ${CANONICAL_CAMP_CATEGORIES.length}`,
    );

    // --- Questionnaire templates (org-authored reference data) -------------------
    // A DEFINITION only: no activation, no audience, no required actions, no
    // responses — those are all live acts the org performs in the console. The
    // `org-` key prefix is what makes the console treat it as org-owned
    // (apps/org/lib/questionnaires/queries.ts#isOrgDefinitionKey).
    const safetyCheckin: Questionnaire = {
      version: "1",
      pages: [
        {
          id: "safety",
          kind: "questions",
          title: "Pre-event safety check-in",
          questions: [
            {
              id: "extinguishers",
              kind: "boolean",
              prompt: "Will you have fire extinguishers on site?",
              required: true,
            },
            {
              id: "fire_lead",
              kind: "short_text",
              prompt: "Who is your camp's fire-safety point of contact?",
              maxLength: 120,
              required: true,
            },
            {
              id: "notes",
              kind: "long_text",
              prompt: "Anything the AfrikaBurn safety team should know?",
              maxLength: 1000,
              required: false,
            },
          ],
        },
      ],
    };
    // --- FORM 2 (roadmap M4-20) ---------------------------------------------
    //
    // AfrikaBurn's second registration form, asked in January: how big are you,
    // when do you arrive, where do you want to be, what noise will you make —
    // and the layout diagram it calls mandatory. Form 1 (September) asks intent
    // and is our wizard; this is everything nobody knows in September.
    //
    // A DEFINITION only, like the safety check-in: no activation, no audience,
    // no responses. AfrikaBurn releases it from the console in January, which is
    // the whole reason Form 2 is a questionnaire rather than more wizard steps.
    //
    // THE QUESTION IDS ARE A CONTRACT, not incidental names. `mapForm2Answers`
    // (@quagga/core) mirrors each one into the registration column the wizard
    // used to write, so the sound answer still drives the camp's required
    // officers and the review screen still has a Size panel to show. Rename one
    // in the console and the mirror REPORTS the column as unfilled rather than
    // failing silently — but it will be unfilled, so don't.
    //
    // The sound options come from @quagga/core's SOUND_SCALE rather than being
    // retyped here: that scale is what `soundLevelFromValue` matches against to
    // decide whether a camp owes a sound officer, and a seed with its own
    // wording would be a second, drifting copy of a safety rule.
    const form2: Questionnaire = {
      version: "1",
      pages: [
        {
          id: "size",
          kind: "questions",
          title: "Size & logistics",
          questions: [
            {
              id: "expected_population",
              kind: "short_text",
              // `format: "integer"` is what makes this a NUMBER question — there
              // is no numeric kind, and the mirror's `count()` accepts a numeric
              // string for exactly this reason.
              format: "integer",
              min: 1,
              maxLength: 6,
              prompt: "How many people will be camping with you?",
              required: true,
            },
            {
              id: "first_arrival_date",
              kind: "date",
              prompt: "When does your first person arrive on site?",
              required: true,
            },
            {
              id: "area_dimensions",
              kind: "short_text",
              prompt: "Roughly how much space do you need? (e.g. 20m x 15m)",
              maxLength: 120,
              required: true,
            },
            {
              id: "layout_diagram",
              kind: "file_link",
              prompt:
                "Upload your camp layout diagram — interactive area, private camping, ablutions, water and fuel storage, parking, and your camp name on the drawing.",
              required: true,
            },
          ],
        },
        {
          id: "sound_placement",
          kind: "questions",
          title: "Sound & placement",
          questions: [
            {
              id: "amplified_music",
              kind: "single_select",
              prompt: "What sound will you be running?",
              required: true,
              options: SOUND_SCALE.map((level) => ({
                value: level.value,
                label: level.label,
              })),
            },
            {
              id: "sound_plan",
              kind: "long_text",
              prompt:
                "Tell us about your sound: what you're playing, when, and how you'll keep it neighbourly.",
              maxLength: 1000,
              required: false,
            },
            {
              id: "placement_first_choice",
              kind: "short_text",
              prompt: "Where would you most like to be placed?",
              maxLength: 200,
              required: false,
            },
            {
              id: "family_friendly",
              kind: "short_text",
              prompt: "Is your camp family-friendly?",
              maxLength: 120,
              required: false,
            },
          ],
        },
      ],
    };
    const form2Def = await ensureQuestionnaireDefinition(db, {
      key: "org-theme-camp-form-2-2027",
      title: "Theme Camp Form 2",
      definition: form2,
      version: "1",
      createdByUserId: null,
    });
    console.log(`[seed] questionnaire template: ${form2Def.key}`);

    const safetyDef = await ensureQuestionnaireDefinition(db, {
      key: "org-safety-checkin-2027",
      title: "Pre-event safety check-in",
      definition: safetyCheckin,
      version: "1",
      // Org-authored reference data — deliberately unowned by any person.
      createdByUserId: null,
    });
    console.log(`[seed] questionnaire template: ${safetyDef.key}`);

    // --- Suppliers ---------------------------------------------------------------
    // Supplier model v2 (docs/supplier-spec.md) + the REAL AfrikaBurn Suppliers
    // List (parser v2). Standing, category, and returning are seeded straight
    // from the imported sheet data (Status → standing, Category normalised,
    // Returning Supplier? → returning), and each supplier's onboarding step map
    // is pre-populated from the sheet's fees/crew-pass progress phrases. No
    // vetting/source anywhere, and NO owning account — `userId` stays null so a
    // real supplier can self-register later and claim the row by email overlap.
    let supplierCount = 0;
    for (const row of suppliersData.suppliers) {
      const supplier = await ensureSupplier(db, row);
      await ensureSupplierOnboarding(
        db,
        supplier.id,
        edition.id,
        row.onboarding,
      );
      supplierCount++;
    }
    console.log(
      `[seed] suppliers: ${supplierCount} imported (source: ${suppliersData.source})`,
    );

    console.log("[seed] done.");
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error(
      "[seed] DATABASE_URL is not set — nothing to seed. Set it in .env first.",
    );
    process.exitCode = 1;
    return;
  }

  const { db, pool } = createPooledDb();
  try {
    await seedReferenceData(db);
  } finally {
    await pool.end();
  }
}

// --- Write helpers -------------------------------------------------------------
// Idempotent by construction: each keys on the row's real unique constraint
// (schema.ts) except `suppliers`, which has none — that path does a
// find-then-write lookup by name instead. The helpers covering rows the org
// edits — suppliers, supplier onboarding, department domains — are
// insert-if-missing (see each one for what a re-run used to destroy). The
// edition, the camp-category taxonomy and the questionnaire template still
// upsert.

interface GroupSpec {
  kind: (typeof schema.groups.$inferInsert)["kind"];
  name: string;
  description?: string;
  joinability?: (typeof schema.groups.$inferInsert)["joinability"];
}

async function ensureGroup(db: Db, spec: GroupSpec): Promise<GroupRow> {
  const nameNormalized = normalizeName(spec.name);
  const existing = await db
    .select()
    .from(schema.groups)
    .where(
      and(
        eq(schema.groups.kind, spec.kind),
        eq(schema.groups.nameNormalized, nameNormalized),
      ),
    )
    .limit(1);
  const existingRow = existing[0];
  if (existingRow) return existingRow;

  const baseSlug = slugify(spec.name);
  let slug = baseSlug;
  let suffix = 2;
  // Extremely unlikely to collide (names are unique per kind already), but
  // slugs are globally unique across all kinds — guard anyway.
  for (;;) {
    const clash = await db
      .select({ id: schema.groups.id })
      .from(schema.groups)
      .where(eq(schema.groups.slug, slug))
      .limit(1);
    if (clash.length === 0) break;
    slug = `${baseSlug}-${suffix++}`;
  }

  return firstOrThrow(
    await db
      .insert(schema.groups)
      .values({
        kind: spec.kind,
        name: spec.name,
        nameNormalized,
        slug,
        description: spec.description ?? null,
        joinability: spec.joinability ?? "invite_only",
        createdByUserId: null,
      })
      .returning(),
    `group ${spec.name}`,
  );
}

async function ensureSupplier(
  db: Db,
  row: {
    name: string;
    services: string;
    contact: string;
    website: string;
    // Ported from the sheet (parser v2); all default to a listed row.
    category?: string | null;
    returning?: (typeof schema.suppliers.$inferInsert)["returning"];
    standing?: (typeof schema.suppliers.$inferInsert)["standing"];
  },
) {
  const standing = row.standing ?? "good";
  const category =
    row.category && row.category.length > 0 ? row.category : null;
  const returning = row.returning ?? null;
  // Dedupe on the NORMALISED name, not the exact one. The sheet is a human
  // export: a trailing space or a capitalisation change makes two rows that
  // look identical in the console but are distinct strings, so an exact-match
  // lookup inserts a second row and the org sees a perfect duplicate it cannot
  // tell apart. `userId` is never written — the catalogue row stays accountless
  // until a real supplier claims it.
  const existing = await db
    .select()
    .from(schema.suppliers)
    .where(
      sql`lower(btrim(${schema.suppliers.name})) = lower(btrim(${row.name}))`,
    )
    .limit(1);
  const existingRow = existing[0];
  // BOOTSTRAP, NOT SYNC — the principle stated at the top of this file, applied
  // to the row that most needed it. This used to UPDATE the existing supplier
  // from the sheet on every run, and `standing` is an ORG VERDICT: a supplier
  // the org had suspended came back to `good` the moment anyone re-ran the seed,
  // with nothing in the console to say why. `category` and `returning` are the
  // same class of thing (the org edits them), and `contact`/`website` overwrote
  // a corrected address with the stale one from a snapshot taken in July 2026.
  //
  // The trade, stated plainly: re-importing a NEWER suppliers.json no longer
  // updates rows that already exist. That is the right way round. The console is
  // where a supplier's details are maintained, a seed is not a merge tool, and
  // an import that silently overwrites live decisions is the 40-suppliers
  // incident wearing a different hat (see the note at the foot of this file).
  if (existingRow) return existingRow;
  return firstOrThrow(
    await db
      .insert(schema.suppliers)
      .values({
        name: row.name,
        services: row.services,
        contact: row.contact,
        website: row.website,
        category,
        returning,
        standing,
        importedAt: new Date(suppliersData.importedAt),
      })
      .returning(),
    `supplier ${row.name}`,
  );
}

/**
 * Insert the per supplier × edition onboarding step-state map IF THE PAIR HAS
 * NONE (idempotent on the unique (supplier, edition) index).
 *
 * Insert-if-missing, not upsert. `steps` is the sheet's snapshot of where a
 * supplier had got to in July 2026, and the org moves it forward from there in
 * the console — fees paid, crew passes issued, documents acknowledged. An
 * `onConflictDoUpdate` wrote that snapshot back over the live map on every run,
 * so every supplier's onboarding progress for the edition reverted to the
 * imported starting state and the org's work vanished with no record that it
 * had ever been done.
 */
async function ensureSupplierOnboarding(
  db: Db,
  supplierId: string,
  editionId: string,
  steps: SupplierOnboardingSteps,
): Promise<void> {
  await db
    .insert(schema.supplierOnboarding)
    .values({ supplierId, editionId, steps })
    .onConflictDoNothing({
      target: [
        schema.supplierOnboarding.supplierId,
        schema.supplierOnboarding.editionId,
      ],
    });
}

// --- Camp category upsert helpers ----------------------------------------------

type CampCategoryRow = typeof schema.campCategories.$inferSelect;

/** Upsert a camp category (idempotent on the unique (edition, label_normalized)
 * index — a re-run refreshes emoji/sort but keeps the row + its id stable). */
async function ensureCampCategory(
  db: Db,
  editionId: string,
  input: { label: string; emoji: string | null; sort: number },
): Promise<CampCategoryRow> {
  return firstOrThrow(
    await db
      .insert(schema.campCategories)
      .values({
        editionId,
        label: input.label,
        labelNormalized: normalizeCategoryLabel(input.label),
        emoji: input.emoji,
        sort: input.sort,
      })
      .onConflictDoUpdate({
        target: [
          schema.campCategories.editionId,
          schema.campCategories.labelNormalized,
        ],
        set: {
          label: input.label,
          emoji: input.emoji,
          sort: input.sort,
          updatedAt: new Date(),
        },
      })
      .returning(),
    `camp category ${input.label}`,
  );
}

// --- Questionnaire template upsert helper --------------------------------------

type DefinitionRow = typeof schema.questionnaireDefinitions.$inferSelect;

async function ensureQuestionnaireDefinition(
  db: Db,
  input: {
    key: string;
    title: string;
    definition: Questionnaire;
    version: string;
    createdByUserId: string | null;
  },
): Promise<DefinitionRow> {
  return firstOrThrow(
    await db
      .insert(schema.questionnaireDefinitions)
      .values({
        key: input.key,
        title: input.title,
        definition: input.definition,
        status: "published",
        version: input.version,
        createdByUserId: input.createdByUserId,
      })
      .onConflictDoUpdate({
        target: schema.questionnaireDefinitions.key,
        set: {
          title: input.title,
          definition: input.definition,
          status: "published",
          version: input.version,
        },
      })
      .returning(),
    `questionnaire definition ${input.key}`,
  );
}

// ONLY when invoked directly (`tsx src/seed.ts`), never on import.
//
// This file exports `seedReferenceData` and `ensureSeededOrgRoles`, and the
// DEPLOY MIGRATOR imports them. A bare top-level `main()` meant that merely
// importing this module ran the ENTIRE reference seed — so once migrate.ts
// imported it on the already-seeded path too, every deploy re-seeded a live
// database: organiser edits reverted, deleted suppliers and categories came
// back, a supplier suspended by the org silently returned to good standing,
// all while the migrator logged "reference data present — not re-seeding".
//
// That is the 40-suppliers incident (commit 5300038) re-opened through a
// different door, and it is worse — that one duplicated rows on a database
// nobody was using yet; this one overwrites decisions on a live one. Guarded
// exactly as migrate.ts guards itself, for exactly the same reason.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error("[seed] Failed:", err);
    process.exitCode = 1;
  });
}
