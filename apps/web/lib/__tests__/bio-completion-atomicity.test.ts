import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { dbMock, uniqueViolation } from "@/test/db-mock";

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

process.env.PGCRYPTO_KEY = "test-pgcrypto-key-16+";

const { saveBio } = await import("../bio-store");

const USER = "aaaaaaaa-0000-0000-0000-000000000001";
const EDITION = "eeeeeeee-0000-0000-0000-000000000000";

// THE LOCKOUT THIS PINS.
//
// Finishing the bio writes three things: `burner_bios.completed_at`, the
// account's username, and the `required_actions` row that is the hard gate.
// They used to be three separate statements on the HTTP driver, which cannot
// roll back. So the first one committing and a later one failing — a lost
// username race, a dropped socket, a statement timeout — left the row saying
// COMPLETE and the gate saying PENDING.
//
// That pair is a trap with no exit. `/onboarding` sends a completed bio to
// `/profile`; `/profile` is gated, so `enforceGate` sends a pending action back
// to `/onboarding`. The burner gets a redirect loop on the one screen standing
// between them and every other page of a live product, and nothing they can do
// clears it — not signing out, not starting again.
//
// Two locks now. The writes are ONE TRANSACTION (here), and `/onboarding` only
// leaves for `/profile` once the gate has actually opened (below), so a row
// written before this fix lands on the flow instead of in the loop.

function source(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relative}`, import.meta.url)),
    "utf8",
  );
}

/** The minimum valid response map for the Burner Bio questionnaire. */
function responses(overrides: Record<string, unknown> = {}) {
  return { legalName: "Alice Hatter", ...overrides };
}

/** Queue for a completing save that carries a new handle. */
function queueFinalSave(usernameWrite: unknown = []) {
  dbMock.queue(
    /* isUsernameAvailable */ [],
    /* the prior-row probe */ [],
    /* the bio upsert */ [],
    /* the username write */ usernameWrite,
    /* completeRequiredAction */ [],
    /* ensureProfileKeypair probe */ [{ userId: USER }],
  );
}

describe("completing a bio is one transaction", () => {
  beforeEach(() => dbMock.reset());

  it("opens exactly one transaction and clears the gate inside it", async () => {
    queueFinalSave();

    expect(
      await saveBio({
        userId: USER,
        editionId: EDITION,
        rawResponses: responses({ username: "alice" }),
        final: true,
      }),
    ).toEqual({ ok: true });

    expect(dbMock.transactions, "one transaction for the whole save").toBe(1);

    // The stamp and the gate clear are the pair that must not come apart.
    const stamped = dbMock
      .writesTo(schema.burnerBios)
      .filter((w) => w.tx)
      .some((w) => {
        const values = w.arg("values") as Record<string, unknown> | undefined;
        return values?.completedAt instanceof Date;
      });
    expect(stamped, "`completed_at` is written inside the transaction").toBe(
      true,
    );

    const gate = dbMock.writesTo(schema.requiredActions);
    expect(gate, "the gate was cleared").toHaveLength(1);
    expect(
      gate[0]?.tx,
      "the gate clear rides the SAME transaction as the stamp",
    ).toBe(true);
  });

  it("stamps nothing when the username write loses the race", async () => {
    // The refusal the user sees is unchanged. What changed is that the bio row
    // does NOT keep a `completed_at` from the rolled-back attempt, and the gate
    // is NOT left pending against it.
    queueFinalSave(uniqueViolation("users_username_lower_idx"));

    expect(
      await saveBio({
        userId: USER,
        editionId: EDITION,
        rawResponses: responses({ username: "alice" }),
        final: true,
      }),
    ).toEqual({
      ok: false,
      errors: { username: "That username is already taken. Try another." },
    });

    // Every write it managed to issue was inside the transaction that threw, so
    // the database rolled all of them back — and the gate was never touched.
    for (const w of dbMock.writesTo(schema.burnerBios)) {
      expect(w.tx, "the upsert is inside the rolled-back transaction").toBe(
        true,
      );
    }
    expect(dbMock.writesTo(schema.requiredActions)).toHaveLength(0);
  });

  it("does not open a transaction for a save that never reaches a write", async () => {
    // A malformed handle is refused before anything is written — no pooled
    // socket, no transaction, same as before.
    expect(
      await saveBio({
        userId: USER,
        editionId: EDITION,
        rawResponses: responses({ username: "no spaces here" }),
        final: true,
      }),
    ).toMatchObject({ ok: false });
    expect(dbMock.transactions).toBe(0);
  });
});

// A SOURCE ASSERTION, because the db-mock cannot answer this one. `db()` and
// the `tx` handle are the same proxy, and `RecordedQuery.tx` is set by WHEN a
// chain was built rather than by which handle built it — so a `db().insert(…)`
// sitting inside the `withTransaction` callback records as `tx: true` exactly
// like the real thing, and the behavioural cases above stay green. In real
// drizzle that write lands on the stateless HTTP driver, outside the
// transaction, and survives the rollback — which is precisely the split that
// creates the lockout. The repo already uses source assertions for guarantees a
// mock cannot reach (decision-reason-invariant, deletion-guards).
describe("the completion writes cannot escape the transaction", () => {
  const bioStore = source("lib/bio-store.ts");

  it("issues every completion write through the `tx` handle", () => {
    const start = bioStore.indexOf("await withTransaction(async (tx) => {");
    expect(start, "the final save still wraps its writes").toBeGreaterThan(-1);
    const body = bioStore.slice(start, bioStore.indexOf("\n    });", start));

    expect(body).toContain("tx\n        .insert(schema.burnerBios)");
    expect(body).toContain("tx\n            .update(schema.users)");
    // The gate clear has to be handed the handle, or it opens its own.
    expect(body).toContain("completeRequiredAction(");
    expect(body).toMatch(/completeRequiredAction\([^)]*\btx,?\s*\)/s);

    expect(
      body,
      "a db() call inside the transaction escapes the rollback",
    ).not.toMatch(/\bdb\(\)/);
  });

  it("refuses a lost race by throwing, so the rollback actually happens", () => {
    // Returning `{ ok: false }` from inside the callback would COMMIT the bio
    // upsert that already ran — the invites-store pattern is safe there only
    // because it refuses before writing anything.
    expect(bioStore).toContain("throw new UsernameTaken()");
    expect(bioStore).toContain("if (error instanceof UsernameTaken)");
  });

  it("lets `completeRequiredAction` take a transaction handle", () => {
    const actions = source("lib/required-actions.ts");
    expect(actions).toContain("tx?: Tx,");
    expect(actions).toContain("await (tx ?? db())");
  });
});

describe("/onboarding does not bounce a burner it cannot release", () => {
  const page = source("app/(app)/onboarding/page.tsx");

  it("checks the gate before redirecting a completed bio to /profile", () => {
    // Unconditional, this line is one half of the redirect loop. `/profile` is
    // gated and sends a pending action straight back here.
    expect(page).not.toMatch(/if \(bio\?\.completedAt\) redirect\("\/profile"\)/);
    expect(page).toContain(
      'if (bio?.completedAt && (await pendingBlockingRoute(user.id)) === null)',
    );
  });
});
