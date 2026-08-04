import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as DbModule from "@/lib/db";
import { installFakeDb, pgTimestamp, type FakeDb } from "@/test/fakes/db";
import { refusal, success } from "@/test/fakes/expect";
import type { SupplierSession } from "@/lib/session";

// Supplier-side document acknowledgement (lib/actions/documents.ts).
//
// THIS IS THE WRITE PATH WHOSE RECONCILIATION ONCE SILENTLY REVERTED AN ORG
// CONFIRMATION. AfrikaBurn marked "Deposit received"; the supplier ticked an
// unrelated document a moment later; the deposit dropped back to "Awaiting
// AfrikaBurn" with nothing in the audit trail naming it. The cause was the step
// map being seeded from `session.steps` — read before the transaction, on
// another connection — while the UPDATE persists the WHOLE seven-step map. The
// fix was reading it on the same transaction (`lockOnboardingSteps`), and
// nothing else currently pins that.
//
// The edition check is the server-side authz that stops a forged document id
// from another edition creating an acknowledgement.
//
// A note on what the fake proves. `ON CONFLICT DO NOTHING` really making a
// replay idempotent, and `FOR UPDATE` really serialising two writers, are
// Postgres behaviours no fake can demonstrate — they are asserted here as
// INTENT (the statement was issued, with these targets). `pnpm e2e:local` is
// where that half is proven.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSupplierSession: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof DbModule>("@/lib/db");
  const { fakeDb: current } = await import("@/test/fakes/db");
  return {
    ...actual,
    getDb: () => current().handle,
    // ONE handle plays both the HTTP db and the transaction, deliberately: it
    // is what lets a test assert the reconcile read and the ack write landed in
    // the same recorded sequence.
    withTransaction: async <T>(fn: (tx: never) => Promise<T>): Promise<T> =>
      fn(current().handle as never),
  };
});

const { revalidatePath } = await import("next/cache");
const { requireSupplierSession } = await import("@/lib/session");
const { setDocumentAcknowledgement } = await import("@/lib/actions/documents");

const DOC = "8f14e45f-ceea-467a-9a3e-4d2b1a7c0001";
const AGREEMENT = {
  id: DOC,
  title: "Supplier agreement",
  sourceType: "link",
  url: "https://example.com/agreement.pdf",
  requiredAck: true,
  stepKey: "agreement_signed",
  sort: 0,
};

const SESSION = {
  user: {
    id: "auth-alice",
    primaryEmail: "alice@example.com",
    displayName: "Alice Hatter",
    emailVerified: true,
  },
  dbUserId: "user-alice",
  supplier: { id: "sup-1", name: "Karoo Tents", standing: "good" },
  edition: { id: "ed-2027", name: "AfrikaBurn 2027", year: 2027 },
  steps: {},
  progress: { completed: 0, total: 7 },
} as unknown as SupplierSession;

let db: FakeDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = installFakeDb();
  vi.mocked(requireSupplierSession).mockResolvedValue(SESSION);
});

describe("authorisation", () => {
  it("refuses a document id belonging to another edition, before opening a transaction", async () => {
    db.rows("supplier_documents", []); // the edition check finds nothing

    const result = await setDocumentAcknowledgement({
      documentId: DOC,
      acknowledged: true,
    });

    expect(refusal(result)).toBe("That document isn't part of this edition.");
    expect(db.matching('insert into "supplier_document_acks"')).toEqual([]);
    // Fail fast, without opening a pool.
    expect(db.queries).toHaveLength(1);
  });

  it("refuses entirely without an ok supplier session", async () => {
    // The client never supplies a supplier id — it is re-resolved server-side
    // on every call.
    vi.mocked(requireSupplierSession).mockRejectedValue(
      new Error("Sign in as a registered supplier to do that."),
    );

    const result = await setDocumentAcknowledgement({
      documentId: DOC,
      acknowledged: true,
    });

    expect(refusal(result)).toBe("Sign in as a registered supplier to do that.");
    expect(db.queries).toEqual([]);
  });

  it("refuses a documentId that is not a uuid, at the boundary", async () => {
    const result = await setDocumentAcknowledgement({
      documentId: "../../etc/passwd",
      acknowledged: true,
    });

    expect(refusal(result)).toMatch(/uuid/i);
    expect(db.queries).toEqual([]);
  });
});

describe("acknowledging", () => {
  /** Arrange the reads a full acknowledgement makes, in the order it makes them. */
  function arrange(options: {
    documents?: Record<string, unknown>[];
    acks?: Record<string, unknown>[];
    stored?: Record<string, unknown>;
  }) {
    db.rows(
      "supplier_documents",
      [{ id: DOC }], // documentBelongsToEdition
      options.documents ?? [AGREEMENT], // loadDocumentsForReconcile
    );
    // The reconcile re-reads the acks as they now stand — including the one
    // just inserted, which is the whole reason it runs on the same handle.
    db.rows(
      "supplier_document_acks",
      options.acks ?? [{ documentId: DOC, ackedAt: pgTimestamp(new Date()) }],
    );
    db.rows("supplier_onboarding", [{ steps: options.stored ?? {} }]);
    db.rows("audit_events", []);
  }

  it("inserts with onConflictDoNothing on (supplier, document), so a replay is idempotent", async () => {
    arrange({});

    success(
      await setDocumentAcknowledgement({ documentId: DOC, acknowledged: true }),
    );

    const insert = db.matching('insert into "supplier_document_acks"')[0]!;
    expect(insert.sql).toContain('on conflict ("supplier_id","document_id") do nothing');
    expect(insert.params).toEqual(["sup-1", DOC]);
  });

  it("reads the documents AND the step map on the SAME handle as the write", async () => {
    // The reconcile must see this transaction's own uncommitted ack; a separate
    // HTTP connection could not. And the step map must be re-read here rather
    // than carried on the session — see the header.
    arrange({});

    success(
      await setDocumentAcknowledgement({ documentId: DOC, acknowledged: true }),
    );

    const order = db.queries.map((q) => `${q.method}:${q.table}`);
    expect(order).toEqual([
      "all:supplier_documents", // edition authz
      "execute:supplier_document_acks", // the ack itself
      "all:supplier_documents", // reconcile: the catalog…
      "all:supplier_document_acks", // …and the acks as they now stand
      "all:supplier_onboarding", // the locked step map
      "execute:supplier_onboarding", // the reconciled write
      "execute:audit_events", // step completed
      "execute:audit_events", // the ack itself
    ]);
    expect(db.matching('select "steps" from "supplier_onboarding"')[0]!.sql).toContain(
      "for update",
    );
  });

  it("completes the bound step and audits it, alongside the document_ack row", async () => {
    arrange({});

    success(
      await setDocumentAcknowledgement({ documentId: DOC, acknowledged: true }),
    );

    const write = db.matching('update "supplier_onboarding" set "steps"')[0]!;
    expect(JSON.parse(String(write.params[0]))).toEqual({
      agreement_signed: "completed",
    });

    const audits = db.matching('insert into "audit_events"');
    expect(audits).toHaveLength(2);
    // One row per completed step…
    expect(String(audits[0]!.params.at(-1))).toContain('"step":"agreement_signed"');
    expect(String(audits[0]!.params.at(-1))).toContain('"via":"document_ack"');
    // …plus one carrying both lists and the edition year.
    const ack = JSON.parse(String(audits[1]!.params.at(-1)));
    expect(ack).toMatchObject({
      documentId: DOC,
      acknowledged: true,
      stepsCompleted: ["agreement_signed"],
      stepsReverted: [],
      edition: 2027,
    });
  });

  it("does NOT republish the step map when nothing completed or reverted", async () => {
    // The map is one jsonb column holding all seven steps. Writing it when
    // nothing changed is the shape of the bug that reverted the deposit.
    arrange({
      documents: [{ ...AGREEMENT, requiredAck: false, stepKey: null }],
    });

    success(
      await setDocumentAcknowledgement({ documentId: DOC, acknowledged: true }),
    );

    expect(db.matching('update "supplier_onboarding" set "steps"')).toEqual([]);
    // The document_ack audit row is still written — it happened.
    expect(db.matching('insert into "audit_events"')).toHaveLength(1);
  });

  it("preserves the org's confirmations, reading them from the transaction not the session", async () => {
    // THE REGRESSION, stated directly: the org has just marked the deposit
    // received, and the session carried a copy from before that. Only the
    // transaction-read map may reach the UPDATE.
    vi.mocked(requireSupplierSession).mockResolvedValue({
      ...SESSION,
      steps: { deposit_paid: "pending" },
    } as unknown as SupplierSession);
    arrange({ stored: { deposit_paid: "completed" } });

    success(
      await setDocumentAcknowledgement({ documentId: DOC, acknowledged: true }),
    );

    const write = db.matching('update "supplier_onboarding" set "steps"')[0]!;
    expect(JSON.parse(String(write.params[0]))).toEqual({
      deposit_paid: "completed",
      agreement_signed: "completed",
    });
  });
});

describe("withdrawing", () => {
  it("deletes the ack row scoped to THIS supplier, and reverts the step", async () => {
    db.rows("supplier_documents", [{ id: DOC }], [AGREEMENT]);
    db.rows("supplier_document_acks", []); // withdrawn, so none remain
    db.rows("supplier_onboarding", [{ steps: { agreement_signed: "completed" } }]);
    db.rows("audit_events", []);

    success(
      await setDocumentAcknowledgement({ documentId: DOC, acknowledged: false }),
    );

    const del = db.matching('delete from "supplier_document_acks"')[0]!;
    expect(del.sql).toContain('"supplier_document_acks"."supplier_id" = ');
    expect(del.params).toEqual(["sup-1", DOC]);

    // A step that stayed green after its evidence was withdrawn would be a lie
    // in the org's console.
    const write = db.matching('update "supplier_onboarding" set "steps"')[0]!;
    expect(JSON.parse(String(write.params[0]))).toEqual({
      agreement_signed: "pending",
    });
    const audits = db.matching('insert into "audit_events"');
    expect(String(audits[0]!.params.at(-1))).toContain(
      '"via":"document_ack_withdrawn"',
    );
  });

  it("keeps an ack that is still on file for another required document", async () => {
    const depotMap = {
      ...AGREEMENT,
      id: "8f14e45f-ceea-467a-9a3e-4d2b1a7c0002",
      title: "Depot map",
    };
    db.rows("supplier_documents", [{ id: DOC }], [AGREEMENT, depotMap]);
    db.rows("supplier_document_acks", [
      { documentId: depotMap.id, ackedAt: pgTimestamp(new Date()) },
    ]);
    db.rows("supplier_onboarding", [{ steps: {} }]);
    db.rows("audit_events", []);

    success(
      await setDocumentAcknowledgement({ documentId: DOC, acknowledged: false }),
    );

    // One of two required documents acknowledged is not a completed step.
    expect(db.matching('update "supplier_onboarding" set "steps"')).toEqual([]);
  });
});

describe("after a successful write", () => {
  it("revalidates the onboarding page", async () => {
    db.rows("supplier_documents", [{ id: DOC }], []);
    db.rows("supplier_document_acks", []);
    db.rows("supplier_onboarding", [{ steps: {} }]);
    db.rows("audit_events", []);

    success(
      await setDocumentAcknowledgement({ documentId: DOC, acknowledged: true }),
    );

    expect(revalidatePath).toHaveBeenCalledWith("/onboarding");
  });
});
