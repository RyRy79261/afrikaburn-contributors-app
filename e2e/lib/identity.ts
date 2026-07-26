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

/**
 * Random once per PROCESS, mixed into every generated name.
 *
 * Without it the only cross-run variation was a 4-hex-char suffix (65k values):
 * the worker slot is stable and the counter restarts at 1 every run, so run two
 * against the same database regenerates run one's names. Camp names must be
 * exactly unique — `checkCampName` refuses an exact normalized match — so a
 * repeat surfaced as "A camp of this kind already uses that name", inside a
 * factory, in a test about something else entirely.
 */
const RUN_ID = randomBytes(16).toString("hex").slice(0, 6);

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
  return `${slug}-w${workerSlot()}-${counter}-${RUN_ID}${token()}@${SYNTHETIC_DOMAIN}`;
}

/** A unique display/business name, for camps, suppliers, people. */
export function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix} ${workerSlot()}-${counter}-${RUN_ID}${token(4)}`;
}

/**
 * A unique USERNAME — the account handle, which has real rules
 * (@quagga/core `username.ts`): 3–20 chars, must start with a letter, only
 * `[a-z0-9_]`, no doubled or trailing underscore, and globally unique.
 *
 * `uniqueName` cannot be reused here: it emits spaces, capitals and hyphens,
 * every one of which the field rejects. Usernames are also unique ACROSS the
 * whole database rather than per-camp, so the worker/counter/run entropy matters
 * more here than anywhere else — a collision would surface as "That username is
 * already taken" inside a factory, in a test about something else entirely.
 *
 * The 20-char cap is tight, so the prefix is truncated rather than the entropy.
 */
export function uniqueUsername(prefix = "dusty"): string {
  counter += 1;
  const suffix = `${workerSlot()}${counter}${RUN_ID}${token(3)}`;
  const stem = prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, Math.max(1, 19 - suffix.length));
  // Guaranteed to start with a letter: the stem is letter-initial by
  // construction here, and a digits-only prefix would break the rule.
  const head = /^[a-z]/.test(stem) ? stem : `u${stem}`;
  return `${head}_${suffix}`.slice(0, 20);
}

/** A unique camp name (fictional per AGENTS.md — never a real business). */
export function uniqueCampName(): string {
  return uniqueName("Dust Bunnies");
}

/** A unique fictional supplier business name. */
export function uniqueSupplierName(): string {
  return uniqueName("LosKop Logistics");
}
