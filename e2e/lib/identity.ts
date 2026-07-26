// e2e/lib/identity.ts — unique-per-worker identity generation.
//
// Parallel workers must NEVER collide on an email, or one worker's sign-up
// poisons another's (a duplicate-email path is enumeration-safe and looks like
// success, so a collision fails silently and confusingly). Every address is
// namespaced by the Playwright worker index + a monotonic counter + a short
// random suffix, so even reruns inside one worker never repeat.

import { randomBytes } from "node:crypto";

/**
 * The domain synthetic (non-mail) test addresses live under. `.test` is a
 * reserved TLD (RFC 6761) that can never resolve or receive mail — deliberate,
 * so a synthetic address can never accidentally reach a real inbox. Use these
 * ONLY for flows that do not need to read email (verification off, or asserting
 * a pre-verify state). For flows that read a link, use a mail.tm mailbox
 * (lib/mail.ts).
 */
const SYNTHETIC_DOMAIN =
  process.env.E2E_SYNTHETIC_EMAIL_DOMAIN ?? "e2e.quagga.test";

/** A NIST-compliant test password (≥15 chars, no composition rules required). */
export const TEST_PASSWORD = "correct-horse-battery-staple-e2e";

/** A deliberately-too-short password for negative password-length assertions. */
export const TOO_SHORT_PASSWORD = "short";

/** The Playwright worker slot, stable within a worker for the whole run. */
function workerSlot(): number {
  const raw = process.env.TEST_WORKER_INDEX;
  const n = raw === undefined ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

let counter = 0;

/** A short, filename-safe random token. */
function token(len = 6): string {
  return randomBytes(16).toString("hex").slice(0, len);
}

/**
 * A unique synthetic email for this worker. `label` becomes the local-part
 * prefix so a failing run reads clearly (e.g. `burner-w0-3-a1b2c3@e2e.quagga.test`).
 * NOT deliverable — do not use where a real link must be read.
 */
export function uniqueEmail(label = "burner"): string {
  counter += 1;
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug}-w${workerSlot()}-${counter}-${token()}@${SYNTHETIC_DOMAIN}`;
}

/** A unique display/business name, for camps, suppliers, people. */
export function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix} ${workerSlot()}-${counter}-${token(4)}`;
}

/** A unique camp name (fictional per AGENTS.md — never a real business). */
export function uniqueCampName(): string {
  return uniqueName("Dust Bunnies");
}

/** A unique fictional supplier business name. */
export function uniqueSupplierName(): string {
  return uniqueName("LosKop Logistics");
}
