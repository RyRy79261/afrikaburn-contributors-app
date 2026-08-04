import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as DbModule from "@/lib/db";
import { installFakeDb, pgTimestamp, type FakeDb } from "@/test/fakes/db";

// The read side of the supplier Documents panel (lib/documents.ts).
//
// THE LOAD-BEARING DISTINCTION IS WHICH LOADERS SWALLOW ERRORS AND WHICH MUST
// NOT. The two panel loaders swallow, because a failed read must leave the
// onboarding page rendering. `requiredDocumentsBoundToStep` guards a WRITE, and
// a swallowed failure there fails OPEN: returning "nothing is bound" is
// precisely the bypass it exists to close, letting a supplier tick a step whose
// document they never opened. `loadDocumentsForReconcile` is the same — a write
// path reconciling against an empty document list would wrongly revert every
// completed step.
//
// Nothing today would notice a well-meaning try/catch being added to either.

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof DbModule>("@/lib/db");
  const { fakeDb: current } = await import("@/test/fakes/db");
  return { ...actual, getDb: () => current().handle };
});

const {
  listEditionDocuments,
  listSupplierAcks,
  loadSupplierDocumentsPanel,
  loadDocumentsForReconcile,
  requiredDocumentsBoundToStep,
  documentBelongsToEdition,
} = await import("@/lib/documents");

const EDITION = "ed-2027";
const SUPPLIER = "sup-1";
const ACKED_AT = new Date("2026-07-14T09:00:00.000Z");

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    title: "Supplier agreement",
    sourceType: "link",
    url: "https://example.com/agreement.pdf",
    requiredAck: true,
    stepKey: "agreement_signed",
    sort: 0,
    ...overrides,
  };
}

let db: FakeDb;

beforeEach(() => {
  db = installFakeDb();
  vi.stubEnv("DATABASE_URL", "postgres://stub/does-not-connect");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("listEditionDocuments", () => {
  it("narrows an unrecognised stepKey to null rather than crashing the panel", async () => {
    // `step_key` is plain text (mirroring the jsonb step map's keys), so a
    // future catalog change can leave a value here that this build has never
    // heard of. Unbound is the honest reading; a throw takes out onboarding.
    db.rows("supplier_documents", [
      document({ stepKey: "some_step_from_2029" }),
      document({ id: "doc-2", stepKey: null }),
    ]);

    const docs = await listEditionDocuments(EDITION);

    expect(docs.map((d) => d.stepKey)).toEqual(["some_step_from_2029", null]);
  });

  it("reads in catalog sort order, scoped to the edition", async () => {
    db.rows("supplier_documents", []);

    await listEditionDocuments(EDITION);

    const q = db.queries[0]!;
    expect(q.sql).toContain('"supplier_documents"."edition_id" = ');
    expect(q.params).toContain(EDITION);
    expect(q.sql).toContain('order by "supplier_documents"."sort" asc');
  });

  it("swallows a query failure and returns an empty list", async () => {
    db.rows("supplier_documents", new Error("connection reset"));

    expect(await listEditionDocuments(EDITION)).toEqual([]);
  });
});

describe("listSupplierAcks", () => {
  it("drops acks for documents outside the passed id set", async () => {
    // Acks are read by supplier, not by document, so a row for a document from
    // another edition (or a deleted one) comes back and must not be counted
    // towards this edition's progress.
    db.rows("supplier_document_acks", [
      { documentId: "doc-1", ackedAt: pgTimestamp(ACKED_AT) },
      {
        documentId: "doc-from-another-edition",
        ackedAt: pgTimestamp(ACKED_AT),
      },
    ]);

    const acks = await listSupplierAcks(SUPPLIER, ["doc-1"]);

    expect(acks.map((a) => a.documentId)).toEqual(["doc-1"]);
  });

  it("short-circuits on an empty id list without querying at all", async () => {
    expect(await listSupplierAcks(SUPPLIER, [])).toEqual([]);
    expect(db.queries).toEqual([]);
  });

  it("swallows a query failure and returns an empty list", async () => {
    db.rows("supplier_document_acks", new Error("connection reset"));

    expect(await listSupplierAcks(SUPPLIER, ["doc-1"])).toEqual([]);
  });
});

describe("loadSupplierDocumentsPanel", () => {
  it("returns the EMPTY panel for an edition with no documents", async () => {
    // This is how the onboarding page decides not to render the panel at all —
    // no empty card, no dead heading. It must also not go looking for acks.
    db.rows("supplier_documents", []);

    const panel = await loadSupplierDocumentsPanel(SUPPLIER, EDITION);

    expect(panel.views).toEqual([]);
    expect(panel.progress.required).toBe(0);
    expect(panel.progress.allAcknowledged).toBe(true);
    expect(db.against("supplier_document_acks")).toEqual([]);
  });

  it("joins the edition's documents to this supplier's acknowledgements", async () => {
    db.rows("supplier_documents", [
      document(),
      document({ id: "doc-2", title: "Depot map", requiredAck: false }),
    ]);
    db.rows("supplier_document_acks", [
      { documentId: "doc-1", ackedAt: pgTimestamp(ACKED_AT) },
    ]);

    const panel = await loadSupplierDocumentsPanel(SUPPLIER, EDITION);

    expect(panel.views).toHaveLength(2);
    expect(panel.progress).toMatchObject({
      acked: 1,
      required: 1,
      allAcknowledged: true,
    });
  });
});

describe("the write-path loaders, which must NOT swallow", () => {
  /** Run `fn` and hand back whatever it threw (drizzle wraps the driver's error). */
  async function thrownBy(fn: () => Promise<unknown>): Promise<unknown> {
    return fn().then(
      () => {
        throw new Error(
          "expected the query failure to propagate, but it did not",
        );
      },
      (err: unknown) => err,
    );
  }

  it("loadDocumentsForReconcile lets a thrown query propagate", async () => {
    // Reconciling against a silently-empty document list would revert every
    // completed step — a supplier's signed agreement quietly coming undone.
    db.rows("supplier_documents", new Error("connection reset"));

    const err = await thrownBy(() =>
      loadDocumentsForReconcile(SUPPLIER, EDITION),
    );

    expect((err as Error).cause).toMatchObject({ message: "connection reset" });
  });

  it("requiredDocumentsBoundToStep lets a thrown query propagate", async () => {
    // Failing OPEN here — answering "nothing is bound" — is exactly the bypass
    // this guard exists to close.
    db.rows("supplier_documents", new Error("connection reset"));

    const err = await thrownBy(() =>
      requiredDocumentsBoundToStep(EDITION, "agreement_signed"),
    );

    expect((err as Error).cause).toMatchObject({ message: "connection reset" });
  });

  it("loadDocumentsForReconcile drops acks for documents outside the edition", async () => {
    db.rows("supplier_documents", [document()]);
    db.rows("supplier_document_acks", [
      { documentId: "doc-1", ackedAt: pgTimestamp(ACKED_AT) },
      { documentId: "doc-elsewhere", ackedAt: pgTimestamp(ACKED_AT) },
    ]);

    const { documents, acks } = await loadDocumentsForReconcile(
      SUPPLIER,
      EDITION,
    );

    expect(documents).toHaveLength(1);
    expect(acks.map((a) => a.documentId)).toEqual(["doc-1"]);
  });

  it("requiredDocumentsBoundToStep filters to requiredAck AND the given step", async () => {
    db.rows("supplier_documents", [document()]);

    await requiredDocumentsBoundToStep(EDITION, "agreement_signed");

    const q = db.queries[0]!;
    expect(q.sql).toContain('"supplier_documents"."step_key" = ');
    expect(q.sql).toContain('"supplier_documents"."required_ack" = ');
    expect(q.params).toEqual([EDITION, "agreement_signed", true]);
    expect(q.sql).toContain('order by "supplier_documents"."sort" asc');
  });
});

describe("documentBelongsToEdition", () => {
  it("is false for an id from another edition", async () => {
    // Server-side authz: a forged document id must not create an ack row.
    db.rows("supplier_documents", []);

    expect(await documentBelongsToEdition("doc-elsewhere", EDITION)).toBe(
      false,
    );
  });

  it("is true for one of the supplier's own edition's documents", async () => {
    db.rows("supplier_documents", [{ id: "doc-1" }]);

    expect(await documentBelongsToEdition("doc-1", EDITION)).toBe(true);
    expect(db.queries[0]!.params).toEqual(["doc-1", EDITION, 1]);
  });
});

describe("with no database configured", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
  });

  it("the panel loaders degrade to empty without querying", async () => {
    expect(await listEditionDocuments(EDITION)).toEqual([]);
    expect(await listSupplierAcks(SUPPLIER, ["doc-1"])).toEqual([]);
    expect((await loadSupplierDocumentsPanel(SUPPLIER, EDITION)).views).toEqual(
      [],
    );
    expect(db.queries).toEqual([]);
  });
});
