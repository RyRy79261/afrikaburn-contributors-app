import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { getActiveEdition } from "@/lib/queries";
import {
  deriveSystemStatus,
  redactSecrets,
  type DatabaseProbe,
  type SystemStatus,
} from "@/lib/system-status";

// The server half of `/system`: read the real environment, make one real query,
// hand both to the pure deriver.
//
// It probes rather than infers. "DATABASE_URL is set" and "the database answers"
// are different claims, and the second is the one someone is asking about when
// they say the app is broken — a status page that only re-read its own config
// would report a green database while every page 500s.
//
// Never throws. This is the page an engineer opens when something is already
// wrong, so a failure to probe has to become a rendered "unreachable", never an
// error boundary. A status page that goes down with the thing it monitors is
// worth nothing.

/** How long a probe may hang before we call it unreachable, in milliseconds. */
const PROBE_TIMEOUT_MS = 5_000;

async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  // A dead database does not refuse a connection, it stops answering — and an
  // unbounded await would hang this render until the platform killed it, which
  // reads as "the console is broken too".
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${label} did not answer within ${PROBE_TIMEOUT_MS}ms.`,
              ),
            ),
          PROBE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * One round trip, timed, plus the active edition — which is the honest answer to
 * "has this database ever been seeded?" and costs one more indexed read.
 */
export async function probeDatabase(): Promise<DatabaseProbe> {
  if (!process.env.DATABASE_URL) return { kind: "not_configured" };

  const startedAt = Date.now();
  try {
    const db = getDb();
    await withTimeout(db.execute(sql`select 1`), "The database");
    const latencyMs = Date.now() - startedAt;
    // The edition read is separate on purpose: a connection that works but has
    // no reference data is a real, distinct state (a migrated-but-unseeded
    // deployment), and collapsing it into "connected" hides the actual fault.
    const edition = await withTimeout(getActiveEdition(), "The editions table");
    return {
      kind: "ok",
      latencyMs,
      edition: edition ? { name: edition.name, year: edition.year } : null,
    };
  } catch (err) {
    return {
      kind: "unreachable",
      // Redacted here as well as in the deriver. A driver error quotes the
      // connection string it failed on, and belt-and-braces on a credential is
      // cheap.
      message: redactSecrets(
        err instanceof Error ? err.message : String(err),
        process.env,
      ),
    };
  }
}

/** The whole System panel report: real env, real probe, pure derivation. */
export async function getSystemStatus(): Promise<SystemStatus> {
  const probe = await probeDatabase();
  return deriveSystemStatus(process.env, probe);
}
