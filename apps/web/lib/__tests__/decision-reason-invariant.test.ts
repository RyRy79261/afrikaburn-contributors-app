import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// REGRESSION: `registrations.decision_reason` holds the reviewer's words for the
// CURRENT state, and only two states carry any — `rejected` and
// `changes_requested`.
//
// Migration 0025 added the column and backfilled it from the audit trail,
// filtering on the audit ACTION and on nothing else. A camp that was asked for
// changes, fixed them and was APPROVED therefore had that old change-request
// written into the column, and the camp's own page rendered it inside the green
// banner:
//
//     Approved — you're registered
//     From the reviewer: your Leave No Trace section needs more detail
//
// A sentence AfrikaBurn was no longer saying, presented as if they were. This
// project is DEPLOYED — migrations run against real data on the next deploy — so
// that was live, not hypothetical. Migration 0027 corrected the rows.
//
// Three places have to keep the invariant, and this pins all three. They are
// source assertions because two of them are `server-only` modules that talk to a
// database, and the fourth guard (the migration) is SQL — its behaviour was
// verified by running it against a row in each state.

function source(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relative}`, import.meta.url)),
    "utf8",
  );
}

describe("decision_reason is only ever the CURRENT state's reason", () => {
  it("the camp's own transitions clear it", () => {
    // A camp moving itself out of `changes_requested` has acted on the feedback;
    // carrying it into `submitted` left the reviewer's request sitting under
    // "Submitted — awaiting review", reading as though they were still asking.
    // Same for a withdrawal and a reopen.
    const store = source("lib/registration-store.ts");
    expect(store).toContain("decisionReason: null");
  });

  it("the summary renders it ONLY on a rejection", () => {
    // Of the locked states the summary covers — submitted, under_review,
    // approved, rejected, withdrawn — only `rejected` carries a reason. An
    // unconditional render is what put a stale request under a green banner.
    const summary = source("components/registration/registration-summary.tsx");
    expect(summary).toContain('r.decisionReason && r.status === "rejected"');
  });

  it("the wizard's copy is already scoped to changes_requested", () => {
    // The other state that carries one. The wizard only ever renders for
    // `draft` | `changes_requested`, and the reason sits inside the
    // changes-requested banner rather than beside the form.
    const wizard = source("components/registration/registration-wizard.tsx");
    const bannerAt = wizard.indexOf('props.status === "changes_requested" &&');
    const reasonAt = wizard.indexOf("props.decisionReason ?");
    expect(bannerAt).toBeGreaterThan(-1);
    expect(reasonAt).toBeGreaterThan(bannerAt);
  });
});
