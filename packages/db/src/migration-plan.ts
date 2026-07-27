/**
 * WHAT the deploy-time migration runner would do, resolved purely from env.
 *
 * Split out of `migrate.ts` (which owns the DOING) so it can be read by
 * something other than the build. The org console's System panel asks exactly
 * this question — "is this deployment set up to migrate safely?" — and it must
 * be able to ask without importing drizzle's migrator, `node:url`, or a module
 * whose whole purpose is to open a pool and take a lock.
 *
 * Nothing here does I/O or touches a connection: it parses connection strings
 * and returns a decision. `migrate.ts` re-exports all of it, so its own tests
 * and every existing import keep working unchanged.
 *
 * The full rationale for the pooled-endpoint refusal lives in `migrate.ts`'s
 * header (session advisory locks do not hold on PgBouncer transaction pooling).
 */

/** Hostname of a Postgres connection string, or null if it does not parse. */
export function connectionHost(connectionString: string): string | null {
  try {
    return new URL(connectionString).hostname;
  } catch {
    return null;
  }
}

/**
 * True when the connection targets a Neon PgBouncer *pooler* endpoint, where
 * session-scoped advisory locks do not hold. Detects the `-pooler` host suffix,
 * a `pgbouncer` host, and the `pgbouncer=true` query flag.
 */
export function isPoolerConnection(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    if (/-pooler\./i.test(url.hostname) || /pgbouncer/i.test(url.hostname)) {
      return true;
    }
    return url.searchParams.get("pgbouncer") === "true";
  } catch {
    return false;
  }
}

/**
 * Decision of what to migrate against, resolved purely from env. Throws a hard
 * error for any configuration that would let the advisory lock silently fail to
 * serialise (a pooled endpoint, or a production deploy without the unpooled URL /
 * without any DB). Kept pure and exported so it can be unit-tested without a DB —
 * and so a console can render the same verdict the build would reach.
 */
export type MigrationPlan =
  | { kind: "skip"; reason: string }
  | { kind: "run"; connectionString: string; usingUnpooled: boolean };

/**
 * The env shape this reads. Deliberately looser than `NodeJS.ProcessEnv`, which
 * Next's types augment to make `NODE_ENV` REQUIRED — that would force every
 * caller and every test to supply a variable this function does not consult.
 * `process.env` satisfies it.
 */
export type MigrationEnv = Readonly<Record<string, string | undefined>>;

export function planMigration(env: MigrationEnv = process.env): MigrationPlan {
  const unpooled = env.DATABASE_URL_UNPOOLED;
  const pooled = env.DATABASE_URL;
  const connectionString = unpooled ?? pooled;
  const isProductionDeploy = env.VERCEL_ENV === "production";
  // Preview and production alike: a pooled fallback breaks the lock in both.
  const isVercelDeploy = Boolean(env.VERCEL || env.VERCEL_ENV);
  const neonLocal = env.NEON_LOCAL_PROXY === "1";

  if (!connectionString) {
    if (isProductionDeploy) {
      throw new Error(
        "[migrate] PRODUCTION DEPLOY with no database configured (DATABASE_URL_UNPOOLED and " +
          "DATABASE_URL both unset). Refusing to complete a production build that would silently " +
          "apply no migrations. Set DATABASE_URL_UNPOOLED to Neon's direct/unpooled endpoint.",
      );
    }
    return {
      kind: "skip",
      reason:
        "[migrate] no database configured (DATABASE_URL_UNPOOLED and DATABASE_URL both unset) — skipping migrations.",
    };
  }

  // Neon Local reroutes to a single local backend; the pooler/production guards
  // (which exist to catch PgBouncer transaction-pooling) do not apply there.
  if (!neonLocal) {
    if (isPoolerConnection(connectionString)) {
      throw new Error(
        "[migrate] refusing to run advisory-locked migrations against a POOLED (PgBouncer) endpoint " +
          `(host ${connectionHost(connectionString) ?? "unknown"}). Session-scoped advisory locks do NOT ` +
          "hold on a transaction-pooling endpoint, so the concurrent Vercel builders would not serialise. " +
          "Set DATABASE_URL_UNPOOLED to Neon's direct/unpooled endpoint.",
      );
    }
    // ANY Vercel deploy, not just production. This guard used to read
    // `isProductionDeploy`, and that gap is not hypothetical — it double-seeded
    // the real database. A preview build with DATABASE_URL_UNPOOLED unset fell
    // through to DATABASE_URL, which Neon's integration points at the POOLED
    // endpoint; `isPoolerConnection` cannot always tell (the host string does
    // not reliably say "pooler"), so the advisory lock was taken on a
    // transaction-pooling connection where it does not hold. Two builders then
    // each held a lock that protected nothing, both saw an empty `editions`,
    // and both seeded — 40 suppliers where there should have been 20.
    //
    // The hazard was never specific to production; only the guard was.
    if (!unpooled && isVercelDeploy) {
      throw new Error(
        "[migrate] DEPLOY without DATABASE_URL_UNPOOLED. Refusing to fall back to DATABASE_URL: " +
          "Neon's Vercel integration sets DATABASE_URL to the POOLED endpoint by default, where session " +
          "advisory locks do not hold — concurrent builders would not serialise and could both migrate " +
          "and seed. Add DATABASE_URL_UNPOOLED (Neon's direct/unpooled endpoint) to THIS environment.",
      );
    }
  }

  return {
    kind: "run",
    connectionString,
    usingUnpooled: Boolean(unpooled),
  };
}
