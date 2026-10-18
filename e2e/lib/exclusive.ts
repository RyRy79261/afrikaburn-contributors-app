// e2e/lib/exclusive.ts — a lock across Playwright WORKERS, for the few tests
// that must mutate deployment-wide state.
//
// "Every spec creates its own data" (fixtures.ts) holds for accounts, camps and
// registrations. It cannot hold for a value the product makes a SINGLETON. The
// case that forced this: `org_department_domains.domain` is the primary key, so
// a domain has at most one owner, and claiming it TAKES it from whoever held it.
// Two tests that each give their own fresh department "the supplier repository"
// are therefore not isolated at all — measured 18 Oct 2026, mobile-360,
// `--repeat-each=12`, 2 workers: one department claimed `suppliers` and 152 ms
// later a parallel test's department took it (audit row `takenFrom:
// ["suppliers"]`), so the first test's delete-confirm no longer said the domain
// "goes back to being owned by nobody", and it failed.
//
// `test.describe.configure({ mode: "serial" })` does not fix that: it orders
// tests inside ONE describe, but `--repeat-each`, the two projects
// (desktop + mobile-360 in one run) and any other file all execute in other
// worker PROCESSES. So the lock is an OS-level one: an atomic `mkdir` in the
// temp directory, which every worker on this machine sees.
//
// A worker that dies holding it must not wedge the run, so the lock records its
// owner's pid and a waiter that finds the owner gone takes it over.

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Every piece of deployment-wide state a spec is allowed to lock. */
export type DeploymentLock = "department-domains";

const POLL_MS = 200;
/** An owner file not yet written by a just-created lock is not "stale". */
const OWNERLESS_GRACE_MS = 10_000;

function lockDir(name: DeploymentLock): string {
  return path.join(tmpdir(), `quagga-e2e-${name}.lock`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, it just is not ours to signal.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function isStale(dir: string): Promise<boolean> {
  try {
    const owner = Number(await readFile(path.join(dir, "owner"), "utf8"));
    if (Number.isInteger(owner) && owner > 0) return !isAlive(owner);
  } catch {
    // No owner file yet — fall through to the age check.
  }
  try {
    return Date.now() - (await stat(dir)).mtimeMs > OWNERLESS_GRACE_MS;
  } catch {
    return false; // Released between our checks; just retry.
  }
}

/**
 * Wait for, then take, the named lock. Returns its release. Waiting counts
 * against the test's own timeout, which is the right bound: a lock that is never
 * released fails the waiter loudly instead of hanging the run.
 */
export async function acquireDeploymentLock(
  name: DeploymentLock,
): Promise<() => Promise<void>> {
  const dir = lockDir(name);
  for (;;) {
    try {
      await mkdir(dir);
      await writeFile(path.join(dir, "owner"), String(process.pid));
      return async () => {
        await rm(dir, { recursive: true, force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (await isStale(dir)) {
      await rm(dir, { recursive: true, force: true });
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
