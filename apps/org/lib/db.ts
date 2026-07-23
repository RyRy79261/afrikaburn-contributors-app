import "server-only";

import { createHttpDb, schema } from "@quagga/db";
import type { Database } from "@quagga/db";

/**
 * Stateless HTTP Drizzle client for the console's route handlers, server
 * components, and server actions. `@quagga/db`'s HTTP driver has no
 * transactions; the console's multi-row writes (transition + audit + review)
 * are applied sequentially — acceptable for the MVP's review volume. See the
 * handoff note on moving decision writes to the pooled driver if atomicity
 * ever matters.
 */
export function getDb(): Database {
  return createHttpDb();
}

export { schema };
