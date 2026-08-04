// A Next server that writes its coverage before it dies. Test-only.
//
// WHY THIS EXISTS
//
// Vitest measures only what runs inside the vitest process. The persona suite
// drives real browsers against a Next server in a SEPARATE process, so every
// server action, query and RSC the personas exercise is invisible to it —
// which is why `apps/org` reads 14% while its queries are covered heavily.
//
// `NODE_V8_COVERAGE=<dir>` makes Node write V8 coverage for a process, but only
// when that process exits through Node's normal exit path. Measured 4 Aug 2026:
// `next dev` under `NODE_V8_COVERAGE`, sent SIGTERM, wrote **zero files**. The
// obvious design — set the variable, kill the server, collect the JSON — fails
// silently and reports nothing, which is indistinguishable from "the e2e suite
// covers nothing".
//
// `v8.takeCoverage()` writes the accumulated coverage ON DEMAND. Something
// inside the server process has to call it, and the test runner is outside, so
// the call needs a trigger the runner can pull.
//
// WHAT THIS DELIBERATELY IS NOT
//
// It is NOT an HTTP route. The first design was a `/api/__coverage__` endpoint
// gated on an env var, and that puts a test-only surface into three PUBLIC
// apps — present in the deployed bundle whether or not it answers. This file
// keeps the hook outside the apps entirely: it lives in `scripts/`, runs only
// when `scripts/e2e-local.sh` chooses it, and ships in nothing. The three apps
// are byte-identical to what they would be without coverage.
//
// USAGE
//
//   NODE_V8_COVERAGE=<dir> node scripts/e2e-coverage-server.mjs <app-dir> <port>
//
// SIGTERM then writes the coverage and exits 0.

import { createServer } from "node:http";
import { takeCoverage } from "node:v8";
import { createRequire } from "node:module";
import path from "node:path";

const [appDir, portArg] = process.argv.slice(2);
if (!appDir || !portArg) {
  console.error(
    "usage: node scripts/e2e-coverage-server.mjs <app-dir> <port>\n" +
      "  e.g. node scripts/e2e-coverage-server.mjs apps/web 3000",
  );
  process.exit(2);
}
const port = Number(portArg);
const dir = path.resolve(appDir);

if (!process.env.NODE_V8_COVERAGE) {
  // Loud, not silent. Running this without the variable produces a working
  // server and no coverage, which would read as "the personas cover nothing".
  console.error(
    "[e2e-coverage] NODE_V8_COVERAGE is not set — refusing to start.\n" +
      "  Without it this collects nothing and the run would report 0%.",
  );
  process.exit(2);
}

// RESOLVED FROM THE APP, NOT FROM HERE. `next` is a dependency of each app
// workspace and not of the repo root, so a bare `import next from "next"` in
// this file fails with ERR_MODULE_NOT_FOUND — which is exactly what it did on
// the first run.
const requireFromApp = createRequire(path.join(dir, "package.json"));
const next = requireFromApp("next");

// RUN AS THE APP. Next compiles `next.config.ts` to a temporary CJS file and
// resolves that file's relative requires — ours pulls in
// `../../config/security-headers.mjs` — against the WORKING DIRECTORY. Started
// from the repo root, that lookup fails and the server dies before listening.
process.chdir(dir);

const app = next({ dev: false, dir });
await app.prepare();
const handle = app.getRequestHandler();

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error("[e2e-coverage] request failed", error);
    res.statusCode = 500;
    res.end("internal error");
  });
});

/**
 * Write the coverage, then leave.
 *
 * `takeCoverage()` is synchronous and flushes to `NODE_V8_COVERAGE`. It runs
 * BEFORE the server close callback rather than after, so a slow or stuck
 * connection cannot cost us the whole run's data — the numbers matter more
 * than a graceful last request.
 */
function shutdown(signal) {
  return () => {
    try {
      takeCoverage();
      console.log(`[e2e-coverage] coverage written on ${signal}`);
    } catch (error) {
      console.error("[e2e-coverage] takeCoverage failed", error);
    }
    server.close(() => process.exit(0));
    // A connection Playwright left open must not hold the process forever.
    setTimeout(() => process.exit(0), 3_000).unref();
  };
}

process.on("SIGTERM", shutdown("SIGTERM"));
process.on("SIGINT", shutdown("SIGINT"));

server.listen(port, () => {
  console.log(`[e2e-coverage] ${appDir} listening on :${port}`);
});
