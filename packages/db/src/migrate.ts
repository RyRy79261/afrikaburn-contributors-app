/**
 * Deploy-safe migration runner (AGENTS.md hard rule 1).
 *
 * Applies the committed, append-only migrations in `packages/db/migrations/`
 * automatically at deploy time. Wired into every app's `build` script, so all
 * three Vercel projects run it on every push. Concurrency is made safe by a
 * Postgres session-level advisory lock rather than by nominating one owner app —
 * that lets an org-only or suppliers-only change deploy without artificially
 * touching web.
 *
 * ## Why the UNPOOLED connection is mandatory (and enforced, not just warned)
 *
 * Neon's *pooled* endpoint is PgBouncer in transaction-pooling mode. In that
 * mode a "session" is not pinned to one backend, so SESSION-scoped advisory
 * locks (`pg_advisory_lock`) DO NOT HOLD — you would get a lock that appears to
 * succeed and protects nothing, and the migration itself would run across
 * several backends. That is the exact race the lock exists to prevent, so a
 * silent fallback to a pooled URL would reintroduce the bug invisibly.
 *
 * Neon's Vercel integration sets `DATABASE_URL` to the POOLED (PgBouncer)
 * endpoint by default; `DATABASE_URL_UNPOOLED` (the direct endpoint) is a
 * separate var that must be added by hand and is easy to forget. So we do not
 * merely warn on fallback — we refuse to proceed when it would be unsafe:
 *
 *   - If the resolved connection host is a Neon *pooler* (`-pooler`/`pgbouncer`),
 *     we ABORT with a hard error regardless of environment. Advisory locks
 *     cannot serialise there, full stop. (Exempted only under NEON_LOCAL_PROXY,
 *     the dev proxy, which reroutes to a single local backend.)
 *   - On a PRODUCTION deploy (`VERCEL_ENV === "production"`) we additionally
 *     refuse to fall back to `DATABASE_URL` at all when `DATABASE_URL_UNPOOLED`
 *     is unset — because Neon's default makes that URL the pooled endpoint even
 *     when its host string does not obviously say so.
 *
 * Outside production, with a non-pooler host, we fall back to `DATABASE_URL`
 * with a loud warning (convenient for local dev / Neon Local).
 *
 * ## The advisory lock
 *
 * We check out ONE dedicated connection from the pool and keep it. The advisory
 * lock is taken on that same connection, and drizzle's migrator is run against
 * that same connection (drizzle's neon-serverless driver accepts a PoolClient).
 * A lock taken on a different connection than the migration protects nothing.
 *
 * Acquisition is BLOCKING (`pg_advisory_lock`) so a second/third concurrent
 * builder waits for the first to finish rather than failing — but the wait is
 * BOUNDED (see LOCK_TIMEOUT_MS) so a stuck/orphaned lock fails the build loudly
 * in a couple of minutes instead of hanging Vercel for its full build budget.
 *
 * Once the lock is held, drizzle's own `__drizzle_migrations` table makes the
 * second and third runs no-ops: the runner is idempotent and safe to run three
 * times concurrently.
 *
 * ## Env-less boot law (AGENTS.md rule 4) — but not in production
 *
 * With neither `DATABASE_URL_UNPOOLED` nor `DATABASE_URL` set (a fork, a preview
 * without DB env, CI), we print a clear skip line and exit 0 — the DB-less build
 * must still succeed. The ONE exception: a `VERCEL_ENV === "production"` deploy
 * with no database configured is a broken production build, not a legitimate
 * DB-less one, so we FAIL it loudly rather than shipping an app whose schema was
 * never migrated.
 *
 * ## Cleanup
 *
 * Session-level advisory locks are released automatically when the backend
 * connection closes, so ending the pool alone would free the lock. We are
 * nonetheless explicit: the `finally` block unlocks, releases the client, and
 * ends the pool, so a mid-migration failure never strands the lock.
 */
import { Pool } from "@neondatabase/serverless";
import { configureLocalProxy } from "./local-proxy";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connectionHost, planMigration } from "./migration-plan";

/**
 * Fixed application-specific advisory-lock key. Arbitrary but MUST be a stable
 * constant and IDENTICAL across all three apps and every deploy — that identity
 * is what serialises the concurrent builders. Do not change it.
 */
const MIGRATION_ADVISORY_LOCK_KEY = 42_97_2027;

/**
 * Bound on how long a builder waits for the advisory lock (milliseconds).
 *
 * Justification: applying 0000–0012 against a fresh Neon branch takes seconds,
 * so the legitimate case — a second builder waiting for the first to finish — is
 * well under two minutes. Two minutes is also far below Vercel's build ceiling,
 * so a stuck or orphaned lock fails the build loudly with minutes to spare
 * rather than consuming the entire build budget. Applied two ways for the
 * acquisition (`statement_timeout` guarantees the wait aborts even in the edge
 * case where `lock_timeout` does not apply to advisory-lock waits; `lock_timeout`
 * additionally bounds any lock wait a migration statement itself makes).
 * `statement_timeout` is lifted to 0 after the lock is held so a legitimately
 * long migration is never aborted.
 */
const LOCK_TIMEOUT_MS = 120_000;

/**
 * The pure planners now live in `./migration-plan`, so a reader that only wants
 * to know WHAT this runner would do (the org console's System panel) can ask
 * without importing drizzle's migrator or a module that opens pools. Re-exported
 * here because this is where every existing caller and test looks for them.
 */
export {
  connectionHost,
  isPoolerConnection,
  planMigration,
  type MigrationPlan,
} from "./migration-plan";

async function main(): Promise<void> {
  const plan = planMigration();

  if (plan.kind === "skip") {
    console.log(plan.reason);
    return; // exit 0 — preserves the env-less boot law (outside production)
  }

  const { connectionString, usingUnpooled } = plan;

  if (usingUnpooled) {
    console.log(
      "[migrate] using DATABASE_URL_UNPOOLED (Neon direct/unpooled endpoint — session advisory locks hold here).",
    );
  } else {
    console.log(
      "[migrate] WARNING: DATABASE_URL_UNPOOLED is not set — falling back to DATABASE_URL " +
        `(host ${connectionHost(connectionString) ?? "unknown"}, not a pooler, non-production). ` +
        "Set DATABASE_URL_UNPOOLED to the direct endpoint to make advisory-lock serialisation explicit.",
    );
  }

  // ONE shared definition with index.ts. A duplicated copy here is how the
  // local-proxy config drifted out of sync in the first place.
  configureLocalProxy();

  const pool = new Pool({ connectionString });
  // One dedicated connection: the advisory lock and the migration MUST share it.
  const client = await pool.connect();

  try {
    // Bound the lock acquisition. See LOCK_TIMEOUT_MS.
    await client.query(`SET lock_timeout = ${LOCK_TIMEOUT_MS}`);
    await client.query(`SET statement_timeout = ${LOCK_TIMEOUT_MS}`);

    console.log(
      `[migrate] acquiring advisory lock ${MIGRATION_ADVISORY_LOCK_KEY} ` +
        `(blocking, bounded to ${LOCK_TIMEOUT_MS}ms)...`,
    );
    await client.query("SELECT pg_advisory_lock($1)", [
      MIGRATION_ADVISORY_LOCK_KEY,
    ]);
    console.log("[migrate] advisory lock acquired.");

    // Don't time-bound the migration itself — only the wait for the lock.
    await client.query("SET statement_timeout = 0");

    // Run drizzle's migrator on the SAME connection that holds the lock.
    const db = drizzle(client);
    const migrationsFolder = fileURLToPath(
      new URL("../migrations", import.meta.url),
    );
    console.log(`[migrate] applying migrations from ${migrationsFolder} ...`);
    await migrate(db, { migrationsFolder });
    console.log("[migrate] migrations applied (up to date).");

    // BOOTSTRAP the reference data a brand-new database needs, on the same
    // locked connection so two concurrent deploys cannot both seed.
    //
    // Migrations create the tables; nothing created the rows the app cannot
    // start without — the active edition above all. A first deployment
    // therefore came up with a perfect schema and no edition, and every
    // DB-backed page fell through to "Preview mode", which read as an env-var
    // problem when the environment was correct. Seeding was a manual step that
    // nothing told you about.
    //
    // ONLY WHEN THERE IS NO EDITION. This is a bootstrap, not a sync: camp
    // categories and supplier records are editable in the org console, and
    // re-asserting canonical rows on every deploy would quietly revert an
    // organiser's edits or resurrect something they deleted. If the database
    // has an edition it has been seeded, and the deploy leaves it alone.
    const seeded = await client.query("SELECT 1 FROM editions LIMIT 1");
    if (seeded.rowCount === 0) {
      console.log("[migrate] no edition found — seeding reference data...");
      const { seedReferenceData } = await import("./seed");
      await seedReferenceData(drizzle(client, { schema }));
      console.log("[migrate] reference data seeded.");
    } else {
      console.log("[migrate] reference data present — not re-seeding.");
      // ONE EXCEPTION, and it is not a sync either: the two seeded ORG ROLES
      // (migration 0018). An ALREADY-SEEDED database skips the bootstrap above,
      // so a deployment that predates org roles v1 would come up with the new
      // tables EMPTY — and since org permissions now come from role rows, every
      // org_staff and engineer account would clear the console gate and resolve
      // nothing. That is a fail-closed lockout of the whole org team on the
      // deploy that introduces the feature.
      //
      // INSERT-IF-MISSING on the stable `key`, never an update: a System manager
      // who has re-righted the Engineer role keeps their edit, and a role they
      // deliberately emptied is not re-filled. This restores absence only.
      const { ensureSeededOrgRoles } = await import("./seed");
      const restored = await ensureSeededOrgRoles(drizzle(client, { schema }));
      console.log(
        restored === 0
          ? "[migrate] org roles present."
          : `[migrate] seeded ${restored} missing org role(s).`,
      );
    }
  } finally {
    // Explicit release even though session locks free on disconnect anyway.
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [
        MIGRATION_ADVISORY_LOCK_KEY,
      ]);
    } catch (err) {
      console.warn(
        "[migrate] advisory unlock failed — the lock releases on disconnect regardless.",
        err,
      );
    }
    client.release();
    await pool.end();
  }
}

// Only run when invoked directly (via `tsx src/migrate.ts` in the build), not
// when imported by a unit test of the pure planners above.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error("[migrate] failed:", err);
    process.exitCode = 1;
  });
}
