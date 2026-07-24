import "server-only";

import { createHttpDb, schema } from "@quagga/db";
import type { Database } from "@quagga/db";

/**
 * Stateless HTTP Drizzle client for the portal's route handlers, server
 * components, and server actions. `@quagga/db`'s HTTP driver has no
 * transactions; the portal's writes (link supplier, ensure onboarding row,
 * apply a step transition) are single-row and applied sequentially — acceptable
 * for the MVP's supplier volume.
 */
export function getDb(): Database {
  return createHttpDb();
}

export { schema };
