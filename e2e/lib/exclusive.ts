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
// worker PROCESSES. The lock has to be one the operating system holds.
//
// THE LOCK IS A LISTENING SOCKET on 127.0.0.1, not a file. The kernel lets one
// process listen on an address:port, and it closes that socket the instant the
// process dies, however it dies. So there is no lock file to go stale, no owner
// pid to trust (a reused pid cannot make a dead holder look alive), no metadata
// read that can fail, and no "reclaim a stale lock" step for two waiters to race
// — the three ways a file lock gets this wrong. The first version WAS a file
// lock (mkdir + owner pid) and had all three; `proper-lockfile`, the usual
// package, was measured to share the third (two waiters both holding after
// reclaiming one orphaned lock), and has not been released since 2021.
//
// A port someone ELSE is listening on must not read as "our lock, held": the
// holder answers every connection with a banner naming the lock, and a waiter
// that hears anything else fails loudly, naming the port and the override.

import { createConnection, createServer, type Server } from "node:net";

/** Every piece of deployment-wide state a spec is allowed to lock. */
export type DeploymentLock = "department-domains";

/**
 * One port per lock, from a base nothing in this stack uses — and BELOW every
 * common ephemeral range (Linux 32768+, this repo's WSL hosts 44620+, macOS and
 * Windows 49152+). Inside that range an unrelated outgoing connection can sit
 * on the port; it blocks our bind but answers no connect, and the first version
 * of this lock (on 47830) measured exactly that as a waiter that never got in.
 */
const LOCK_OFFSETS: Record<DeploymentLock, number> = {
  "department-domains": 0,
};
const DEFAULT_BASE_PORT = 29_830;
const HOST = "127.0.0.1";
const POLL_MS = 200;
/** How long a waiter gives the holder to answer before calling the port foreign. */
const BANNER_TIMEOUT_MS = 2_000;
/**
 * "Cannot bind, yet nobody is listening" is a holder releasing between our bind
 * and our connect — once. Seen this many times IN A ROW, it is a non-listening
 * socket squatting on the port, and waiting longer would never end.
 */
const MAX_CONSECUTIVE_GONE = 10;

function lockPort(name: DeploymentLock, basePort?: number): number {
  const base =
    basePort ?? Number(process.env.E2E_LOCK_BASE_PORT ?? DEFAULT_BASE_PORT);
  return base + LOCK_OFFSETS[name];
}

function banner(name: DeploymentLock): string {
  return `quagga-e2e-lock:${name}\n`;
}

function listen(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off("listening", onListening);
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve(true);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: HOST, port, exclusive: true });
  });
}

type Holder = "ours" | "gone" | "foreign";

/** Who is on the port we could not bind: our holder, nobody (any more), or a stranger. */
function identifyHolder(name: DeploymentLock, port: number): Promise<Holder> {
  return new Promise((resolve) => {
    const expected = banner(name);
    let received = "";
    const socket = createConnection({ host: HOST, port });
    const settle = (holder: Holder): void => {
      socket.destroy();
      resolve(holder);
    };
    socket.setTimeout(BANNER_TIMEOUT_MS, () => settle("foreign"));
    socket.on("data", (chunk) => {
      received += chunk.toString("utf8");
      if (received.length >= expected.length) {
        settle(received.startsWith(expected) ? "ours" : "foreign");
      }
    });
    socket.on("end", () =>
      // Closed before a full banner: a holder shutting down mid-handshake looks
      // exactly like this, and so does a stranger. Only an empty close is ours.
      settle(received === "" ? "gone" : "foreign"),
    );
    socket.on("error", (error: NodeJS.ErrnoException) =>
      // Refused/reset: the holder released between our bind and our connect.
      settle(
        error.code === "ECONNREFUSED" || error.code === "ECONNRESET"
          ? "gone"
          : "foreign",
      ),
    );
  });
}

/**
 * Wait for, then take, the named lock. Returns its release. Waiting counts
 * against the test's own timeout, which is the right bound: a holder that never
 * lets go fails the waiter loudly instead of hanging the run.
 */
export async function acquireDeploymentLock(
  name: DeploymentLock,
  /** Tests of the lock itself run on their own ports, clear of the real one. */
  options: { basePort?: number } = {},
): Promise<() => Promise<void>> {
  const port = lockPort(name, options.basePort);
  let consecutiveGone = 0;
  for (;;) {
    const server = createServer((socket) => socket.end(banner(name)));
    if (await listen(server, port)) {
      // A lock must never be the thing keeping a finished worker alive.
      server.unref();
      return () =>
        new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const holder = await identifyHolder(name, port);
    consecutiveGone = holder === "gone" ? consecutiveGone + 1 : 0;
    if (holder === "foreign" || consecutiveGone >= MAX_CONSECUTIVE_GONE) {
      throw new Error(
        `Port ${HOST}:${port} (lock "${name}") is in use by something other ` +
          `than an e2e worker. Free it, or move the lock with E2E_LOCK_BASE_PORT.`,
      );
    }
    // Quickly back to the bind after "gone" (the holder just let go), but not
    // in a tight loop: ten "gone"s must span real time to mean "squatter".
    await new Promise((resolve) =>
      setTimeout(resolve, holder === "gone" ? POLL_MS / 4 : POLL_MS),
    );
  }
}
