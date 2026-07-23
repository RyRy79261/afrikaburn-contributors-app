import "server-only";

import { createHttpDb, schema } from "@quagga/db";
import { isDatabaseConfigured } from "./config";

/** The stateless HTTP Drizzle client (no transactions) — for route handlers and
 * server components/actions. A fresh client per call is cheap and correct for
 * the serverless HTTP driver. */
export function db() {
  return createHttpDb();
}

export { schema, isDatabaseConfigured };

/** Guard for DB-backed surfaces: when unconfigured, callers render a graceful
 * "preview mode" state instead of throwing (build-spec §Hard constraints 4). */
export function requireDb(): boolean {
  return isDatabaseConfigured();
}
