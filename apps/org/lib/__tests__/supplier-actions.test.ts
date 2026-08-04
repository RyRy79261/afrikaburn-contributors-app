import { describe, it, expect, beforeEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";
import { GOD, READER, SUPPLIERS_LEAD } from "./support/actors";

/**
 * THE SUPPLIER REPOSITORY, ITS DOCUMENT LIBRARY, AND AUDIT FINDING M17.
 *
 * `supplier_onboarding.steps` was only ever recomputed inside the SUPPLIER'S OWN
 * acknowledgement action. The org console could add, rebind or delete a document
 * and nothing recalculated anything — so the console kept reporting "signed" for
 * a document that had been withdrawn, and missed a newly added required document
 * nobody had signed. Two docstrings asserted a reconciliation no code performed.
 * At a depot that is a truck waved through on a signature for a document that
 * does not exist.
 *
 * `reconcileEditionSupplierSteps` takes its `tx` as a parameter, so it is the
 * cheapest real test in this workspace — and the regression it guards has
 * already happened once.
 */

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
  createPooledDb: () => ({ db, pool: { end: async () => {} } }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireOrgSession = vi.fn();
vi.mock("@/lib/session", () => ({
  requireOrgSession: (options?: unknown) => requireOrgSession(options),
}));

import type { OrgTx } from "@/lib/db";
import { reconcileEditionSupplierSteps } from "@/lib/supplier-step-reconcile";
import {
  addSupplier,
  addSupplierNote,
  deleteSupplier,
  fetchSupplierNotes,
  setSupplierOnboardingStep,
  setSupplierStanding,
} from "@/lib/actions/suppliers";
import {
  createSupplierDocument,
  deleteSupplierDocument,
  listSupplierDocuments,
  updateSupplierDocument,
} from "@/lib/actions/supplier-documents";

const SUPPLIER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const EDITION_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const DOC_ID = "12121212-1212-4212-8212-121212121212";

/** `agreement_signed` is a SELF-SERVICE step — the only kind a document may
 * bind to, because a supplier ticking a checkbox must never be able to confirm
 * that money arrived or that they attended a briefing. */
const SELF_SERVICE_STEP = "agreement_signed" as const;
/** `deposit_paid` is org-confirmed. Binding a document to it is the refusal. */
const ORG_CONFIRMED_STEP = "deposit_paid" as const;

beforeEach(() => {
  db = fakeDb();
  requireOrgSession.mockReset();
  requireOrgSession.mockResolvedValue({
    dbUserId: "user-1",
    orgGroupId: "org-1",
    actor: GOD,
  });
});

describe("setSupplierStanding", () => {
  it("refuses a caller without `update` in the suppliers domain", async () => {
    requireOrgSession.mockRejectedValue(new Error("Not authorised."));
    await expect(
      setSupplierStanding({ supplierId: SUPPLIER_ID, standing: "suspended" }),
    ).resolves.toEqual({ ok: false, error: "Not authorised." });
    expect(requireOrgSession).toHaveBeenCalledWith({
      capability: "update",
      domain: "suppliers",
    });
  });

  it("refuses a supplier that no longer exists", async () => {
    db.seed("suppliers", []);
    await expect(
      setSupplierStanding({ supplierId: SUPPLIER_ID, standing: "suspended" }),
    ).resolves.toEqual({ ok: false, error: "That supplier no longer exists." });
  });

  it("writes the standing, audits it, and tells a CLAIMED supplier", async () => {
    // A supplier only ever sees their own standing VALUE change — never the
    // org-internal notes that led to it.
    db.seed("suppliers", [{ name: "LosKop Catering", userId: "sup-user-1" }]);

    const result = await setSupplierStanding({
      supplierId: SUPPLIER_ID,
      standing: "suspended",
    });

    expect(result).toEqual({ ok: true });
    expect(db.recorded("update", "suppliers")[0]?.values).toMatchObject({
      standing: "suspended",
    });
    expect(db.inserted("audit_events")).toMatchObject({
      action: "supplier.standing",
      subject: SUPPLIER_ID,
      meta: { name: "LosKop Catering", standing: "suspended" },
    });
    const [notification] = db.inserted("notifications") as {
      userId: string;
      linkApp: string;
    }[];
    // Read in the SUPPLIERS app: /onboarding is a suppliers route, not a
    // console one, so a console link would be a guaranteed 404 for them.
    expect(notification).toMatchObject({
      userId: "sup-user-1",
      linkApp: "suppliers",
    });
  });

  it("notifies nobody for an UNCLAIMED listing", async () => {
    db.seed("suppliers", [{ name: "LosKop Catering", userId: null }]);
    await setSupplierStanding({ supplierId: SUPPLIER_ID, standing: "watch" });
    expect(db.recorded("insert", "notifications")).toHaveLength(0);
  });
});

describe("setSupplierOnboardingStep", () => {
  it("refuses an unknown supplier", async () => {
    db.seed("suppliers", []);
    await expect(
      setSupplierOnboardingStep({
        supplierId: SUPPLIER_ID,
        editionId: EDITION_ID,
        stepKey: ORG_CONFIRMED_STEP,
        status: "completed",
      }),
    ).resolves.toEqual({ ok: false, error: "That supplier no longer exists." });
  });

  it("surfaces the core module's refusal when the transition is not applicable", async () => {
    // Confirming a step that is already confirmed is a double-click, not a
    // decision — and it must not write a second audit row saying the org
    // confirmed it twice. The sentence comes from @quagga/core, which is the
    // only place the transition rules are written down.
    db.seed("suppliers", [{ name: "LosKop Catering", userId: null }]);
    db.seed("supplier_onboarding", [
      { steps: { [ORG_CONFIRMED_STEP]: "completed" } },
    ]);

    const result = await setSupplierOnboardingStep({
      supplierId: SUPPLIER_ID,
      editionId: EDITION_ID,
      stepKey: ORG_CONFIRMED_STEP,
      status: "completed",
    });

    expect(result).toEqual({
      ok: false,
      error: "Step is already in that state.",
    });
    expect(db.recorded("insert", "supplier_onboarding")).toHaveLength(0);
    expect(db.recorded("insert", "audit_events")).toHaveLength(0);
  });

  it("upserts the step map and tells the supplier when the ORG confirms one", async () => {
    db.seed("suppliers", [{ name: "LosKop Catering", userId: "sup-user-1" }]);
    db.seed("supplier_onboarding", [{ steps: {} }]);

    const result = await setSupplierOnboardingStep({
      supplierId: SUPPLIER_ID,
      editionId: EDITION_ID,
      stepKey: ORG_CONFIRMED_STEP,
      status: "completed",
    });

    expect(result).toEqual({ ok: true });
    expect(db.inserted("supplier_onboarding")).toMatchObject({
      supplierId: SUPPLIER_ID,
      editionId: EDITION_ID,
    });
    expect(db.inserted("audit_events")).toMatchObject({
      action: "supplier.onboarding",
      meta: { step: ORG_CONFIRMED_STEP, status: "completed" },
    });
    expect(db.recorded("insert", "notifications")).toHaveLength(1);
  });

  it("does NOT announce a self-service step the supplier drove themselves", async () => {
    // Telling somebody they completed the thing they just completed is noise,
    // and the hook exists to announce the ORG's half.
    db.seed("suppliers", [{ name: "LosKop Catering", userId: "sup-user-1" }]);
    db.seed("supplier_onboarding", [{ steps: {} }]);

    await setSupplierOnboardingStep({
      supplierId: SUPPLIER_ID,
      editionId: EDITION_ID,
      stepKey: SELF_SERVICE_STEP,
      status: "completed",
    });

    expect(db.recorded("insert", "notifications")).toHaveLength(0);
  });
});

describe("addSupplierNote / addSupplier / deleteSupplier", () => {
  it("names `create` for a note and refuses without it", async () => {
    requireOrgSession.mockRejectedValue(new Error("Not authorised."));
    await addSupplierNote({
      supplierId: SUPPLIER_ID,
      kind: "note",
      body: "Quoted",
    });
    expect(requireOrgSession).toHaveBeenCalledWith({
      capability: "create",
      domain: "suppliers",
    });
  });

  it("refuses an empty note body", async () => {
    const result = await addSupplierNote({
      supplierId: SUPPLIER_ID,
      kind: "note",
      body: "   ",
    });
    expect(result.ok).toBe(false);
    expect(db.calls).toEqual([]);
  });

  it("writes the note against its author and audits it", async () => {
    db.seed("suppliers", [{ name: "LosKop Catering" }]);
    db.seed("supplier_notes", [{ id: "note-1" }]);

    const result = await addSupplierNote({
      supplierId: SUPPLIER_ID,
      kind: "infraction",
      body: "Arrived without a permit.",
    });

    expect(result).toEqual({ ok: true });
    expect(db.inserted("supplier_notes")).toEqual({
      supplierId: SUPPLIER_ID,
      authorId: "user-1",
      kind: "infraction",
      body: "Arrived without a permit.",
    });
    expect(db.inserted("audit_events")).toMatchObject({
      action: "supplier.note",
      meta: { kind: "infraction", noteId: "note-1" },
    });
  });

  it("adds a supplier with blanks stored as null, not empty strings", async () => {
    db.seed("suppliers", [{ id: SUPPLIER_ID }]);

    await addSupplier({ name: "Dust Bunnies Hire", services: "", website: "" });

    expect(db.inserted("suppliers")).toEqual({
      name: "Dust Bunnies Hire",
      services: null,
      contact: null,
      website: null,
    });
  });

  it("REFUSES to delete a listing a supplier has claimed", async () => {
    // Deleting it would strand a person mid-onboarding and orphan their
    // uploaded documents. Suspending the account is what that control is for.
    db.seed("suppliers", [
      { id: SUPPLIER_ID, name: "LosKop Catering", userId: "sup-user-1" },
    ]);

    const result = await deleteSupplier({ supplierId: SUPPLIER_ID });

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/suspended instead/);
    expect(db.recorded("delete", "suppliers")).toHaveLength(0);
  });

  it("REFUSES to delete a supplier a camp declared, and says how many", async () => {
    // The declaration is a CAMP'S record that it named this supplier on its
    // registration; a cascade would erase somebody else's history from a page
    // nobody was looking at.
    db.seed("suppliers", [
      { id: SUPPLIER_ID, name: "LosKop Catering", userId: null },
    ]);
    db.seed("supplier_declarations", [
      { registrationId: "reg-1" },
      { registrationId: "reg-2" },
    ]);

    const result = await deleteSupplier({ supplierId: SUPPLIER_ID });

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(
      /2 camp registrations declared this supplier/,
    );
    expect(db.recorded("delete", "suppliers")).toHaveLength(0);
  });

  it("deletes an unclaimed, undeclared entry and records its NAME", async () => {
    // After the commit the id resolves to nothing, so a bare id in the audit
    // row would be unreadable a week later.
    db.seed("suppliers", [
      { id: SUPPLIER_ID, name: "Duplicate Catering", userId: null },
    ]);
    db.seed("supplier_declarations", []);

    const result = await deleteSupplier({ supplierId: SUPPLIER_ID });

    expect(result).toEqual({ ok: true });
    expect(db.recorded("delete", "suppliers")).toHaveLength(1);
    expect(db.inserted("audit_events")).toMatchObject({
      action: "supplier.delete",
      meta: { name: "Duplicate Catering" },
    });
  });

  it("asks for `delete` IN the suppliers domain, not an undomained refusal", async () => {
    db.seed("suppliers", [{ id: SUPPLIER_ID, name: "x", userId: null }]);
    db.seed("supplier_declarations", []);
    await deleteSupplier({ supplierId: SUPPLIER_ID });
    expect(requireOrgSession).toHaveBeenCalledWith({
      capability: "delete",
      domain: "suppliers",
    });
  });
});

describe("fetchSupplierNotes — a data-returning action re-checks authz itself", () => {
  it("passes the SESSION'S actor down, so the note authors stay behind the predicate", async () => {
    // A client-supplied actor would be no gate at all.
    requireOrgSession.mockResolvedValue({
      dbUserId: "user-1",
      orgGroupId: "org-1",
      actor: READER,
    });
    db.seed("supplier_notes", [
      {
        id: "note-1",
        kind: "note",
        body: "Quoted for 2027",
        createdAt: new Date("2026-11-01T00:00:00Z"),
        authorEmail: "buyer@example.com",
      },
    ]);

    const result = await fetchSupplierNotes({ supplierId: SUPPLIER_ID });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.notes[0]?.body).toBe("Quoted for 2027");
    expect(result.notes[0]?.authorEmail).toBeNull();
  });

  it("gives the author to a Suppliers lead — their own department", async () => {
    requireOrgSession.mockResolvedValue({
      dbUserId: "user-1",
      orgGroupId: "org-1",
      actor: SUPPLIERS_LEAD,
    });
    db.seed("supplier_notes", [
      {
        id: "note-1",
        kind: "note",
        body: "Quoted for 2027",
        createdAt: new Date("2026-11-01T00:00:00Z"),
        authorEmail: "buyer@example.com",
      },
    ]);

    const result = await fetchSupplierNotes({ supplierId: SUPPLIER_ID });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.notes[0]?.authorEmail).toBe("buyer@example.com");
  });

  it("returns a failed result rather than throwing at the caller", async () => {
    requireOrgSession.mockRejectedValue(new Error("Not authorised."));
    await expect(
      fetchSupplierNotes({ supplierId: SUPPLIER_ID }),
    ).resolves.toEqual({ ok: false, error: "Not authorised." });
  });
});

describe("supplier documents", () => {
  it("refuses a binding to an ORG-CONFIRMED step with the validator's reason", async () => {
    // The rule the validation exists for: a supplier ticking a checkbox must
    // never be able to confirm that money arrived.
    const result = await createSupplierDocument({
      editionId: EDITION_ID,
      title: "Deposit terms",
      sourceType: "link",
      url: "https://example.com/terms",
      requiredAck: true,
      stepKey: ORG_CONFIRMED_STEP,
    });

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(
      /confirmed by AfrikaBurn/,
    );
    expect(db.calls).toEqual([]);
  });

  it("refuses a bound document that does not require acknowledgement", async () => {
    // Otherwise nothing would ever complete the step.
    const result = await createSupplierDocument({
      editionId: EDITION_ID,
      title: "Agreement",
      sourceType: "link",
      url: "https://example.com/agreement",
      requiredAck: false,
      stepKey: SELF_SERVICE_STEP,
    });
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(
      /must require acknowledgement/,
    );
  });

  it("publishes an unbound document, appending it to the edition's list", async () => {
    db.seed("supplier_documents", [[{ max: 2 }], [{ id: DOC_ID }], []]);
    db.seed("supplier_onboarding", []);

    const result = await createSupplierDocument({
      editionId: EDITION_ID,
      title: "Site map",
      sourceType: "link",
      url: "https://example.com/map",
      requiredAck: false,
      stepKey: null,
    });

    expect(result).toEqual({ ok: true });
    expect(db.inserted("supplier_documents")).toMatchObject({
      editionId: EDITION_ID,
      title: "Site map",
      sort: 3,
      createdByUserId: "user-1",
    });
    expect(db.inserted("audit_events")).toMatchObject({
      action: "supplier_document.create",
      subject: DOC_ID,
    });
  });

  it("refuses to edit a document that no longer exists", async () => {
    db.seed("supplier_documents", [[]]);
    await expect(
      updateSupplierDocument({
        documentId: DOC_ID,
        title: "Agreement",
        sourceType: "link",
        url: "https://example.com/a",
        requiredAck: true,
        stepKey: SELF_SERVICE_STEP,
      }),
    ).resolves.toEqual({ ok: false, error: "That document no longer exists." });
  });

  it("REBINDS a document and reconciles BOTH steps, telling whoever moved backwards", async () => {
    // Rebinding away from a step can leave the OLD step with no evidence behind
    // it. Only `alsoConsider` puts a step with no documents left back into the
    // reconcile set — the exact case the reconciler used to skip (M17). And a
    // supplier whose checklist moved backwards must be TOLD: silently
    // un-ticking a step they had signed off leaves them staring at an
    // unexplained regression, and leaving it ticked leaves the console lying.
    db.seed("supplier_documents", [
      // The current row, then the (empty) document list the reconciler reads
      // back inside the same transaction.
      [{ id: DOC_ID, sort: 0, editionId: EDITION_ID, stepKey: SELF_SERVICE_STEP }],
      [],
    ]);
    db.seed("supplier_onboarding", [
      {
        supplierId: SUPPLIER_ID,
        steps: { [SELF_SERVICE_STEP]: "completed" },
        supplierName: "LosKop Catering",
        userId: "sup-user-1",
      },
    ]);
    db.seed("supplier_document_acks", []);

    const result = await updateSupplierDocument({
      documentId: DOC_ID,
      title: "Agreement",
      sourceType: "link",
      url: "https://example.com/a",
      requiredAck: true,
      // Unbound now — the step it used to carry has nothing behind it.
      stepKey: null,
    });

    expect(result).toEqual({ ok: true });
    expect(db.recorded("update", "supplier_onboarding")).toHaveLength(1);
    const [notified] = db.inserted("notifications") as { userId: string }[];
    expect(notified).toMatchObject({ userId: "sup-user-1" });
  });

  it("notifies NOBODY for an unclaimed listing whose step reopened", async () => {
    // An unclaimed catalogue row has no account to tell, and an insert of zero
    // rows is a write the fan-out must not attempt.
    db.seed("supplier_documents", [
      [{ id: DOC_ID, sort: 0, editionId: EDITION_ID, stepKey: SELF_SERVICE_STEP }],
      [],
    ]);
    db.seed("supplier_onboarding", [
      {
        supplierId: SUPPLIER_ID,
        steps: { [SELF_SERVICE_STEP]: "completed" },
        supplierName: "LosKop Catering",
        userId: null,
      },
    ]);
    db.seed("supplier_document_acks", []);

    await updateSupplierDocument({
      documentId: DOC_ID,
      title: "Agreement",
      sourceType: "link",
      url: "https://example.com/a",
      requiredAck: true,
      stepKey: null,
    });

    expect(db.recorded("insert", "notifications")).toHaveLength(0);
  });

  it("refuses an invalid binding on EDIT too, not only on create", async () => {
    const result = await updateSupplierDocument({
      documentId: DOC_ID,
      title: "Deposit terms",
      sourceType: "link",
      url: "https://example.com/terms",
      requiredAck: true,
      stepKey: ORG_CONFIRMED_STEP,
    });
    expect(result).toMatchObject({ ok: false });
    expect(db.calls).toEqual([]);
  });

  it("refuses to delete a document that is already gone", async () => {
    db.seed("supplier_documents", [[]]);
    await expect(
      deleteSupplierDocument({ documentId: DOC_ID }),
    ).resolves.toEqual({ ok: false, error: "That document no longer exists." });
  });

  it("captures the acknowledgement count BEFORE withdrawing a document", async () => {
    // The acks cascade away with it, so the audit row is the only place that
    // count survives.
    db.seed("supplier_documents", [
      [{ title: "Agreement", stepKey: SELF_SERVICE_STEP, editionId: EDITION_ID }],
      [],
    ]);
    db.seed("supplier_document_acks", [{ acks: 5 }]);
    db.seed("supplier_onboarding", []);

    const result = await deleteSupplierDocument({ documentId: DOC_ID });

    expect(result).toEqual({ ok: true });
    expect(db.inserted("audit_events")).toMatchObject({
      action: "supplier_document.delete",
      meta: {
        title: "Agreement",
        stepKey: SELF_SERVICE_STEP,
        acknowledgementsDiscarded: 5,
      },
    });
    expect(db.recorded("delete", "supplier_documents")).toHaveLength(1);
  });

  it("lists the edition's documents behind a `read` guard on its OWN domain", async () => {
    // The document library and the supplier repository are separate parts of
    // the console; an org may well give them to different departments.
    db.seed("supplier_documents", [
      {
        id: DOC_ID,
        title: "Agreement",
        sourceType: "link",
        url: "https://example.com/a",
        requiredAck: true,
        stepKey: SELF_SERVICE_STEP,
        sort: 0,
        ackCount: "7",
      },
    ]);

    const rows = await listSupplierDocuments(EDITION_ID);

    expect(requireOrgSession).toHaveBeenCalledWith({
      capability: "read",
      domain: "supplier_documents",
    });
    // The count comes back from Postgres as a string on some drivers; the
    // console renders a number.
    expect(rows[0]?.ackCount).toBe(7);
  });
});

/**
 * THE RECONCILER ITSELF. It takes its `tx` as a parameter, so it runs here with
 * no module mocking at all — the honest unit test of the thing that was missing.
 */
describe("reconcileEditionSupplierSteps", () => {
  const tx = () => db as unknown as OrgTx;

  function seedDocs(docs: Record<string, unknown>[]) {
    db.seed("supplier_documents", docs);
  }

  it("short-circuits an edition with no onboarding rows", async () => {
    seedDocs([]);
    db.seed("supplier_onboarding", []);

    const result = await reconcileEditionSupplierSteps(
      tx(),
      EDITION_ID,
      [],
      "user-1",
    );

    expect(result).toEqual({ changed: 0, reopened: [] });
    // And it did not go looking for acknowledgements it could not use.
    expect(db.recorded("select", "supplier_document_acks")).toHaveLength(0);
  });

  it("COMPLETES a step once every required document bound to it is acknowledged", async () => {
    seedDocs([
      {
        id: DOC_ID,
        title: "Agreement",
        sourceType: "link",
        url: "https://example.com/a",
        requiredAck: true,
        stepKey: SELF_SERVICE_STEP,
        sort: 0,
      },
    ]);
    db.seed("supplier_onboarding", [
      {
        supplierId: SUPPLIER_ID,
        steps: {},
        supplierName: "LosKop Catering",
        userId: "sup-user-1",
      },
    ]);
    db.seed("supplier_document_acks", [
      {
        supplierId: SUPPLIER_ID,
        documentId: DOC_ID,
        ackedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);

    const result = await reconcileEditionSupplierSteps(
      tx(),
      EDITION_ID,
      [],
      "user-1",
    );

    expect(result.changed).toBe(1);
    expect(result.reopened).toEqual([]);
    expect(db.inserted("audit_events")).toMatchObject({
      action: "supplier.onboarding_step",
      subject: SUPPLIER_ID,
      meta: {
        stepKey: SELF_SERVICE_STEP,
        status: "completed",
        cause: "document_change",
      },
    });
  });

  it("REOPENS a step whose last required document was withdrawn", async () => {
    // The M17 regression, stated directly: no document is bound to the step any
    // more, so `alsoConsider` is the only thing that puts it back in the
    // reconcile set — without it the stale `completed` survives forever.
    seedDocs([]);
    db.seed("supplier_onboarding", [
      {
        supplierId: SUPPLIER_ID,
        steps: { [SELF_SERVICE_STEP]: "completed" },
        supplierName: "LosKop Catering",
        userId: "sup-user-1",
      },
    ]);
    db.seed("supplier_document_acks", []);

    const result = await reconcileEditionSupplierSteps(
      tx(),
      EDITION_ID,
      [SELF_SERVICE_STEP],
      "user-1",
    );

    expect(result.changed).toBe(1);
    expect(result.reopened).toEqual([
      {
        supplierId: SUPPLIER_ID,
        userId: "sup-user-1",
        supplierName: "LosKop Catering",
        stepKey: SELF_SERVICE_STEP,
      },
    ]);
    expect(db.inserted("audit_events")).toMatchObject({
      action: "supplier.onboarding_step_reopened",
      meta: { stepKey: SELF_SERVICE_STEP, cause: "document_change" },
    });
  });

  it("leaves the step alone when nothing about it changed", async () => {
    // Without this, every document edit would rewrite every supplier's row and
    // fill the audit trail with events nobody caused.
    seedDocs([]);
    db.seed("supplier_onboarding", [
      {
        supplierId: SUPPLIER_ID,
        steps: {},
        supplierName: "LosKop Catering",
        userId: null,
      },
    ]);
    db.seed("supplier_document_acks", []);

    const result = await reconcileEditionSupplierSteps(
      tx(),
      EDITION_ID,
      [SELF_SERVICE_STEP],
      "user-1",
    );

    expect(result).toEqual({ changed: 0, reopened: [] });
    expect(db.recorded("update", "supplier_onboarding")).toHaveLength(0);
  });

  it("IGNORES an acknowledgement whose document no longer exists", async () => {
    // An ack of a withdrawn document is not evidence of anything. Deletes
    // cascade the rows away anyway; this guards the read-your-own-write window
    // and any historical orphan.
    seedDocs([]);
    db.seed("supplier_onboarding", [
      {
        supplierId: SUPPLIER_ID,
        steps: { [SELF_SERVICE_STEP]: "completed" },
        supplierName: "LosKop Catering",
        userId: null,
      },
    ]);
    db.seed("supplier_document_acks", [
      {
        supplierId: SUPPLIER_ID,
        documentId: "a-document-that-was-deleted",
        ackedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);

    const result = await reconcileEditionSupplierSteps(
      tx(),
      EDITION_ID,
      [SELF_SERVICE_STEP],
      "user-1",
    );

    expect(result.reopened).toHaveLength(1);
  });

  it("SWEEPS A SUPPLIER WHO NEVER TOUCHED THE CHANGED DOCUMENT", async () => {
    // Documents A and B both required and bound to the same step, and a
    // supplier who acked only B: their step is pending. The org deletes A. B is
    // now the only required document bound to that step and it IS acknowledged,
    // so the step should COMPLETE. That supplier never touched A, so an
    // ack-holders-only sweep would skip them and leave the step wrong in the
    // OTHER direction. The set of suppliers a document change can affect is not
    // the set who acknowledged it.
    seedDocs([
      {
        id: "doc-b",
        title: "B",
        sourceType: "link",
        url: "https://example.com/b",
        requiredAck: true,
        stepKey: SELF_SERVICE_STEP,
        sort: 1,
      },
    ]);
    db.seed("supplier_onboarding", [
      {
        supplierId: SUPPLIER_ID,
        steps: { [SELF_SERVICE_STEP]: "pending" },
        supplierName: "LosKop Catering",
        userId: null,
      },
    ]);
    db.seed("supplier_document_acks", [
      {
        supplierId: SUPPLIER_ID,
        documentId: "doc-b",
        ackedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);

    const result = await reconcileEditionSupplierSteps(
      tx(),
      EDITION_ID,
      // The step the DELETED document A used to carry.
      [SELF_SERVICE_STEP],
      "user-1",
    );

    expect(result.changed).toBe(1);
    expect(result.reopened).toEqual([]);
    expect(
      db.recorded("update", "supplier_onboarding")[0]?.values,
    ).toMatchObject({
      steps: { [SELF_SERVICE_STEP]: "completed" },
    });
  });
});
