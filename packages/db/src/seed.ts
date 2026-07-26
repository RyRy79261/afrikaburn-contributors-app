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
 *     GOD_EMAILS, the mvp-proposal's own demo beat)
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
 * Safe to run repeatedly: every write is an upsert keyed on the row's real
 * unique constraint (or, where none exists, a find-then-write lookup).
 *
 * Run via `pnpm --filter @quagga/db db:seed` once `DATABASE_URL` is set. This
 * script is NEVER part of any build step and must not run at import time.
 */
import { eq, and } from "drizzle-orm";
import {
  normalizeName,
  CANONICAL_CAMP_CATEGORIES,
  normalizeCategoryLabel,
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
  suppliers: suppliersDataRaw.suppliers.map((row) => SupplierImportRow.parse(row)),
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
    // per mvp-proposal, staff elevate live via GOD_EMAILS at the kickoff meeting,
    // and `createdByUserId` stays null because no seeded person exists to own it.
    const orgGroup = await ensureGroup(db, {
      kind: "org",
      name: "AfrikaBurn",
      description: "The organising body behind the AfrikaBurn event.",
      joinability: "invite_only",
    });
    console.log(`[seed] org group: ${orgGroup.name} (${orgGroup.id})`);

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
      await ensureSupplierOnboarding(db, supplier.id, edition.id, row.onboarding);
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

// --- Upsert helpers ------------------------------------------------------------
// Idempotent by construction: each keys on the row's real unique constraint
// (schema.ts) except `suppliers`, which has none — that path does a
// find-then-write lookup by name instead.

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
  const category = row.category && row.category.length > 0 ? row.category : null;
  const returning = row.returning ?? null;
  // Suppliers have no source column anymore — dedupe on name (the seed is the
  // only importer, and sheet names are effectively unique). `userId` is never
  // written: the catalog row stays accountless until a real supplier claims it.
  const existing = await db
    .select()
    .from(schema.suppliers)
    .where(eq(schema.suppliers.name, row.name))
    .limit(1);
  const existingRow = existing[0];
  if (existingRow) {
    return firstOrThrow(
      await db
        .update(schema.suppliers)
        .set({
          services: row.services,
          contact: row.contact,
          website: row.website,
          category,
          returning,
          standing,
          updatedAt: new Date(),
        })
        .where(eq(schema.suppliers.id, existingRow.id))
        .returning(),
      `supplier ${row.name}`,
    );
  }
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

/** Upsert the per supplier × edition onboarding step-state map (idempotent on
 * the unique (supplier, edition) index). */
async function ensureSupplierOnboarding(
  db: Db,
  supplierId: string,
  editionId: string,
  steps: SupplierOnboardingSteps,
): Promise<void> {
  await db
    .insert(schema.supplierOnboarding)
    .values({ supplierId, editionId, steps })
    .onConflictDoUpdate({
      target: [
        schema.supplierOnboarding.supplierId,
        schema.supplierOnboarding.editionId,
      ],
      set: { steps, updatedAt: new Date() },
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
        set: { label: input.label, emoji: input.emoji, sort: input.sort, updatedAt: new Date() },
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

main().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exitCode = 1;
});
