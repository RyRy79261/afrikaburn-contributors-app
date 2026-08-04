import { describe, it, expect, beforeEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";

/**
 * The camp-category taxonomy was reserved to the System manager on 27 Jul 2026:
 * the catalog is edition-wide reference data every camp's registration renders
 * against, so a rename or a delete reaches every camp at once.
 *
 * THE `what` ARGUMENT IS THE POINT OF THESE TESTS. `requireSystemManager` takes
 * one solely so the refusal explains the rule that actually stopped you. A
 * refactor that passed the default would show someone who tried to rename a
 * category a sentence about managing departments and roles — a screen
 * explaining a different rule than the one that refused them, which is worse
 * than silence.
 */

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
  createPooledDb: () => ({ db, pool: { end: async () => {} } }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireSystemManager = vi.fn();
vi.mock("@/lib/session", () => ({
  requireSystemManager: (what?: string) => requireSystemManager(what),
}));

import {
  createCategory,
  deleteCategory,
  setGroupCategory,
  updateCategory,
} from "@/lib/actions/categories";

const EDITION_ID = "66666666-6666-4666-8666-666666666666";
const CATEGORY_ID = "77777777-7777-4777-8777-777777777777";
const GROUP_ID = "88888888-8888-4888-8888-888888888888";

beforeEach(() => {
  db = fakeDb();
  requireSystemManager.mockReset();
  requireSystemManager.mockResolvedValue({
    dbUserId: "user-1",
    orgGroupId: "org-1",
  });
});

describe("every category write is reserved to the System manager", () => {
  beforeEach(() => {
    requireSystemManager.mockRejectedValue(
      new Error(
        "Only a System manager may change the camp categories. Ask one of them.",
      ),
    );
  });

  it("names the RESERVED THING rather than the roles sentence", async () => {
    for (const run of [
      () => createCategory({ editionId: EDITION_ID, label: "Food" }),
      () => updateCategory({ categoryId: CATEGORY_ID, label: "Food" }),
      () => deleteCategory({ categoryId: CATEGORY_ID }),
      () =>
        setGroupCategory({
          groupId: GROUP_ID,
          categoryId: CATEGORY_ID,
          assigned: true,
        }),
    ]) {
      const result = await run();
      expect(result).toMatchObject({ ok: false });
      expect((result as { error: string }).error).toMatch(
        /change the camp categories/,
      );
    }

    // Every one of them ASKED for that wording — the argument is the feature.
    for (const call of requireSystemManager.mock.calls) {
      expect(call[0]).toBe("change the camp categories");
    }
    expect(db.calls).toEqual([]);
  });
});

describe("createCategory", () => {
  it("surfaces the core validator's refusal rather than a constraint error", async () => {
    // A duplicate label in the same edition is a thing a human did, and the
    // sentence that explains it comes from @quagga/core — not from Postgres.
    db.seed("camp_categories", [
      [{ id: "cat-existing", label: "Food" }],
      [{ max: 3 }],
      [{ id: "cat-new" }],
    ]);

    const result = await createCategory({ editionId: EDITION_ID, label: "food" });

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).not.toMatch(/constraint/i);
    expect(db.recorded("insert", "camp_categories")).toHaveLength(0);
  });

  it("appends to the end of the edition's list when no sort is given", async () => {
    db.seed("camp_categories", [[], [{ max: 3 }], [{ id: "cat-new" }]]);

    const result = await createCategory({
      editionId: EDITION_ID,
      label: "Sound",
      emoji: "🔊",
    });

    expect(result).toEqual({ ok: true });
    expect(db.inserted("camp_categories")).toMatchObject({
      editionId: EDITION_ID,
      label: "Sound",
      emoji: "🔊",
      sort: 4,
    });
  });

  it("starts at zero on an edition with no categories yet", async () => {
    db.seed("camp_categories", [[], [{ max: null }], [{ id: "cat-new" }]]);
    await createCategory({ editionId: EDITION_ID, label: "Sound" });
    expect(db.inserted("camp_categories")).toMatchObject({ sort: 0 });
  });

  it("audits the creation against the acting System manager", async () => {
    db.seed("camp_categories", [[], [{ max: null }], [{ id: "cat-new" }]]);
    await createCategory({ editionId: EDITION_ID, label: "Sound" });
    expect(db.inserted("audit_events")).toMatchObject({
      actorId: "user-1",
      action: "category.create",
      subject: "cat-new",
      meta: { editionId: EDITION_ID, label: "Sound" },
    });
  });
});

describe("updateCategory", () => {
  it("refuses a category that no longer exists", async () => {
    db.seed("camp_categories", [[]]);
    await expect(
      updateCategory({ categoryId: CATEGORY_ID, label: "Food" }),
    ).resolves.toEqual({ ok: false, error: "That category no longer exists." });
  });

  it("renames, keeping the existing sort when none is supplied", async () => {
    db.seed("camp_categories", [
      [{ id: CATEGORY_ID, editionId: EDITION_ID, sort: 7 }],
      [{ id: CATEGORY_ID, label: "Food" }],
    ]);

    const result = await updateCategory({
      categoryId: CATEGORY_ID,
      label: "Food and drink",
    });

    expect(result).toEqual({ ok: true });
    expect(db.recorded("update", "camp_categories")[0]?.values).toMatchObject({
      label: "Food and drink",
      sort: 7,
    });
    expect(db.inserted("audit_events")).toMatchObject({
      action: "category.update",
      subject: CATEGORY_ID,
    });
  });

  it("does not treat the category's OWN label as a duplicate of itself", async () => {
    // The dedupe read excludes the row being edited; without that, re-saving a
    // category with only its emoji changed would refuse.
    db.seed("camp_categories", [
      [{ id: CATEGORY_ID, editionId: EDITION_ID, sort: 0 }],
      [{ id: CATEGORY_ID, label: "Food" }],
    ]);

    await expect(
      updateCategory({ categoryId: CATEGORY_ID, label: "Food", emoji: "🍲" }),
    ).resolves.toEqual({ ok: true });
  });
});

describe("deleteCategory", () => {
  it("refuses a category that no longer exists", async () => {
    db.seed("camp_categories", [[]]);
    await expect(
      deleteCategory({ categoryId: CATEGORY_ID }),
    ).resolves.toEqual({ ok: false, error: "That category no longer exists." });
    expect(db.recorded("delete", "camp_categories")).toHaveLength(0);
  });

  it("records how many camps had picked it BEFORE deleting", async () => {
    // The link rows cascade away, so the count is unrecoverable a moment later
    // — which is exactly why it belongs in the audit meta.
    db.seed("camp_categories", [[{ label: "Food" }]]);
    db.seed("group_categories", [{ pickers: 12 }]);

    const result = await deleteCategory({ categoryId: CATEGORY_ID });

    expect(result).toEqual({ ok: true });
    expect(db.inserted("audit_events")).toMatchObject({
      action: "category.delete",
      subject: CATEGORY_ID,
      meta: { label: "Food", pickers: 12 },
    });
  });
});

describe("setGroupCategory", () => {
  it("refuses an unknown category", async () => {
    db.seed("camp_categories", []);
    await expect(
      setGroupCategory({
        groupId: GROUP_ID,
        categoryId: CATEGORY_ID,
        assigned: true,
      }),
    ).resolves.toEqual({ ok: false, error: "That category no longer exists." });
  });

  it("links on assign and unlinks on unassign, auditing which it was", async () => {
    db.seed("camp_categories", [{ id: CATEGORY_ID }]);
    await setGroupCategory({
      groupId: GROUP_ID,
      categoryId: CATEGORY_ID,
      assigned: true,
    });
    expect(db.inserted("group_categories")).toEqual({
      groupId: GROUP_ID,
      categoryId: CATEGORY_ID,
    });
    expect(db.inserted("audit_events")).toMatchObject({
      action: "category.assign",
      meta: { groupId: GROUP_ID, assigned: true },
    });

    db = fakeDb();
    db.seed("camp_categories", [{ id: CATEGORY_ID }]);
    await setGroupCategory({
      groupId: GROUP_ID,
      categoryId: CATEGORY_ID,
      assigned: false,
    });
    expect(db.recorded("delete", "group_categories")).toHaveLength(1);
    expect(db.recorded("insert", "group_categories")).toHaveLength(0);
    expect(db.inserted("audit_events")).toMatchObject({
      meta: { assigned: false },
    });
  });
});
