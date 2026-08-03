"use client";

import { useEffect } from "react";

import { installClientErrorCapture } from "../lib/client-errors";

/**
 * Mounts the recent-errors buffer. Renders nothing.
 *
 * It belongs in the ROOT layout of each app, above everything else, because the
 * errors worth having are the ones that happen before anybody thinks to open
 * the reporter. Mounting it next to the reporter itself would capture only what
 * went wrong after the person had already noticed.
 *
 * Nothing is transmitted by mounting this — see `../lib/client-errors.ts`.
 */
export function ClientErrorCapture(): null {
  useEffect(() => installClientErrorCapture(), []);
  return null;
}
