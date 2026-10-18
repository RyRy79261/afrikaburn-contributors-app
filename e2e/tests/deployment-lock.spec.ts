// tests/deployment-lock.spec.ts — the cross-worker lock (lib/exclusive.ts) is
// load-bearing for every spec that moves department domain ownership, so its
// three classic failure modes are pinned here with REAL processes, because a
// lock between worker processes cannot be proven inside one:
//
//   1. A dead holder whose pid now belongs to a live process must not look
//      alive forever (pid reuse).
//   2. A live holder must never be reclaimed, even if lock metadata on disk is
//      unreadable and old.
//   3. Two waiters recovering from one dead holder must never both hold it.
//
// Each was a defect in the first, file-based version, and each test below was
// run against that version and went red (see the PR). No browser is launched:
// no test here asks for a page.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { test, expect } from "../fixtures";
import { acquireDeploymentLock } from "../lib/exclusive";

const LIB_URL = pathToFileURL(
  path.join(import.meta.dirname, "..", "lib", "exclusive.ts"),
).href;
/**
 * A PRIVATE temp directory per test, exported to this worker and its children
 * as TMPDIR. A file lock keeps its state under `os.tmpdir()`; the current lock
 * is a socket and writes nothing there. The directory exists so these tests can
 * plant the leftovers a crashed file-lock run leaves (and prove they cannot
 * wedge or fool the lock) without two parallel tests sharing one leftover.
 */
let privateTmp = "";
const fileLockDir = (): string =>
  path.join(privateTmp, "quagga-e2e-department-domains.lock");

/** Ports clear of the real lock and of every other concurrently running copy. */
function basePort(slot: number): number {
  return 29_900 + test.info().parallelIndex * 10 + slot;
}

type Event = { kind: "acquired" | "released"; at: number; id: string };

/**
 * A separate process that takes the lock, reports, holds for `holdMs` (or until
 * killed when omitted), and releases.
 */
function contender(
  port: number,
  id: string,
  events: Event[],
  holdMs?: number,
): { child: ChildProcess; acquired: Promise<void>; exited: Promise<void> } {
  const script = `
    const { acquireDeploymentLock } = await import(${JSON.stringify(LIB_URL)});
    const release = await acquireDeploymentLock("department-domains", { basePort: ${port} });
    process.stdout.write("acquired " + Date.now() + "\\n");
    ${
      holdMs === undefined
        ? "setInterval(() => {}, 1000);"
        : `await new Promise((r) => setTimeout(r, ${holdMs}));
           process.stdout.write("released " + Date.now() + "\\n");
           await release();`
    }
  `;
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "--input-type=module",
      "-e",
      script,
    ],
    {
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env, TMPDIR: privateTmp },
    },
  );
  let signalAcquired: () => void = () => {};
  const acquired = new Promise<void>((resolve) => (signalAcquired = resolve));
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    for (const line of chunk.split("\n").filter(Boolean)) {
      const [kind, at] = line.split(" ");
      if (kind !== "acquired" && kind !== "released") continue;
      events.push({ kind, at: Number(at), id });
      if (kind === "acquired") signalAcquired();
    }
  });
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  return { child, acquired, exited };
}

/** Resolves true if `promise` settles within `ms`, false otherwise. */
async function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const result = await Promise.race([promise.then(() => true), timeout]);
  clearTimeout(timer);
  return result;
}

/** Enough contention that the old file lock's reclaim race reliably showed. */
const ROUNDS = 5;
const WAITERS = 12;

test.describe("deployment lock · cross-worker exclusion", () => {
  let savedTmp: string | undefined;
  test.beforeEach(async () => {
    privateTmp = await mkdtemp(path.join(tmpdir(), "quagga-lock-test-"));
    savedTmp = process.env.TMPDIR;
    process.env.TMPDIR = privateTmp;
  });
  test.afterEach(async () => {
    if (savedTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = savedTmp;
    await rm(privateTmp, { recursive: true, force: true });
  });

  test("a dead holder whose pid is reused by a live process does not hold the lock", async () => {
    // The leftover of a crashed file-lock holder whose pid now belongs to a
    // LIVE, unrelated process (this test's own runner stands in for it).
    await mkdir(fileLockDir(), { recursive: true });
    await writeFile(path.join(fileLockDir(), "owner"), String(process.pid));

    const acquiring = acquireDeploymentLock("department-domains", {
      basePort: basePort(0),
    });
    expect(await within(acquiring, 5_000)).toBe(true);
    await (
      await acquiring
    )();

    // And the real crash, end to end: a holder SIGKILLed mid-hold frees the
    // lock at once — no staleness window to wait out.
    const events: Event[] = [];
    const holder = contender(basePort(0), "holder", events);
    await holder.acquired;
    holder.child.kill("SIGKILL");
    await holder.exited;
    const after = acquireDeploymentLock("department-domains", {
      basePort: basePort(0),
    });
    expect(await within(after, 1_000)).toBe(true);
    await (
      await after
    )();
  });

  test("a live holder is never reclaimed, even beside unreadable, old lock metadata", async () => {
    const events: Event[] = [];
    const holder = contender(basePort(1), "holder", events);
    await holder.acquired;
    try {
      // Whatever a file lock would have left on disk is now unreadable (the
      // owner record is a directory: EISDIR) and older than any grace period.
      await rm(fileLockDir(), { recursive: true, force: true });
      await mkdir(path.join(fileLockDir(), "owner"), { recursive: true });
      const old = new Date(Date.now() - 60 * 60_000);
      await utimes(fileLockDir(), old, old);

      const stolen = acquireDeploymentLock("department-domains", {
        basePort: basePort(1),
      });
      // Assert the holder is still alive FIRST, so "not acquired" below cannot
      // be satisfied by a holder that quietly died.
      expect(holder.child.exitCode).toBeNull();
      expect(await within(stolen, 3_000)).toBe(false);

      // …and the waiter is merely waiting: it gets the lock once the holder goes.
      holder.child.kill("SIGKILL");
      expect(await within(stolen, 2_000)).toBe(true);
      await (
        await stolen
      )();
    } finally {
      holder.child.kill("SIGKILL");
    }
  });

  test("waiters recovering from one dead holder never hold the lock at the same time", async () => {
    test.setTimeout(120_000);
    for (let round = 0; round < ROUNDS; round++) {
      const events: Event[] = [];
      const holder = contender(basePort(2), "holder", events);
      await holder.acquired;
      const waiters = Array.from({ length: WAITERS }, (_, i) =>
        contender(basePort(2), `w${i}`, events, 100),
      );
      // Let every waiter reach its polling loop, THEN kill the holder, so they
      // all discover the dead holder together — the reclaim race's best case.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      holder.child.kill("SIGKILL");
      await holder.exited;
      await Promise.all(waiters.map((w) => w.exited));

      // Every waiter got a turn…
      const turns = events.filter(
        (e) => e.kind === "acquired" && e.id !== "holder",
      );
      expect(turns).toHaveLength(WAITERS);
      // …and no two turns overlapped: sorted by acquisition, each starts no
      // earlier than the previous one released.
      const spans = turns
        .map((t) => ({
          id: t.id,
          from: t.at,
          to:
            events.find((e) => e.kind === "released" && e.id === t.id)?.at ??
            Infinity,
        }))
        .sort((a, b) => a.from - b.from);
      for (let i = 1; i < spans.length; i++) {
        expect(
          spans[i]!.from,
          `round ${round}: ${spans[i]!.id} acquired while ${spans[i - 1]!.id} held it`,
        ).toBeGreaterThanOrEqual(spans[i - 1]!.to);
      }
    }
  });

  test("a port held by something else fails loudly instead of waiting forever", async () => {
    const stranger = createServer((socket) =>
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"),
    );
    await new Promise<void>((resolve) =>
      stranger.listen({ host: "127.0.0.1", port: basePort(3) }, resolve),
    );
    try {
      await expect(
        acquireDeploymentLock("department-domains", { basePort: basePort(3) }),
      ).rejects.toThrow(/E2E_LOCK_BASE_PORT/);
    } finally {
      await new Promise<void>((resolve) => stranger.close(() => resolve()));
    }
  });

  test("a port squatted by a non-listening socket fails loudly instead of waiting forever", async () => {
    // Measured: with the lock at 47830 — inside this host's ephemeral range
    // (44620-48715 on WSL) — a waiter spun until its test timed out. The cause
    // is a CLIENT socket on the port without SO_REUSEADDR, which is what the
    // kernel's ephemeral autobind produces: bind is refused AND connect is
    // refused, so the waiter read "holder just left" forever. The lock now sits
    // below every common ephemeral range; this pins the loud failure for the
    // case that remains (something explicitly bound there).
    //
    // Node cannot make that socket — libuv sets SO_REUSEADDR on every bind, and
    // Linux then lets our listen through — so a python3 child holds it.
    const python = spawnSync("python3", ["--version"]);
    test.skip(python.status !== 0, "python3 not available to hold the port");
    const squatter = spawn(
      "python3",
      [
        "-I",
        "-c",
        [
          "import socket, sys, time",
          "srv = socket.socket(); srv.bind(('127.0.0.1', 0)); srv.listen()",
          "c = socket.socket()",
          `c.bind(('127.0.0.1', ${basePort(4)})); c.connect(srv.getsockname())`,
          "print('ready', flush=True)",
          "time.sleep(60)",
        ].join("\n"),
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    await new Promise<void>((resolve) =>
      squatter.stdout?.once("data", () => resolve()),
    );
    try {
      const acquiring = acquireDeploymentLock("department-domains", {
        basePort: basePort(4),
      });
      await expect(acquiring).rejects.toThrow(/E2E_LOCK_BASE_PORT/);
    } finally {
      squatter.kill("SIGKILL");
    }
  });
});
