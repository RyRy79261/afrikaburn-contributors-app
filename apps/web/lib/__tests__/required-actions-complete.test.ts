import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { schema } from "@quagga/db";
import { boundStrings, dbMock } from "@/test/db-mock";

// completeRequiredAction must never turn a WAIVED action into a completed one.
// Archiving a camp member waives their pending questionnaires from that camp
// (CDB-036); if an answer still reached the completion write, the camp's
// results would show a former member as having taken part.

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());
vi.mock("../edition", () => ({ getActiveEdition: async () => null }));

const { completeRequiredAction } = await import("../required-actions");

// From the real pg enum, not a string typed here.
const WAIVED = schema.requiredActionStatusEnum.enumValues.find(
  (v) => v === "waived",
)!;

beforeEach(() => dbMock.reset());

describe("completeRequiredAction", () => {
  it("completes only this user's action in this edition", async () => {
    await completeRequiredAction("u1", "ed-2027", "questionnaire:a1");
    const write = dbMock.onlyQuery("update");
    expect(write.arg("update")).toBe(schema.requiredActions);
    expect(write.arg("set")).toMatchObject({ status: "completed" });
    expect(boundStrings(write)).toEqual(
      expect.arrayContaining(["u1", "ed-2027", "questionnaire:a1"]),
    );
  });

  it("never flips a WAIVED action to completed", async () => {
    await completeRequiredAction("u1", "ed-2027", "questionnaire:a1");
    // Rendered by the real Postgres dialect: `boundStrings` would also see the
    // enum's own value list on the column, so it cannot tell a guard from none.
    const where = dbMock.onlyQuery("update").arg("where") as SQL;
    const rendered = new PgDialect().sqlToQuery(where);
    const guard = rendered.sql.match(/"status" <> \$(\d+)/);
    expect(guard).not.toBeNull();
    expect(rendered.params[Number(guard![1]) - 1]).toBe(WAIVED);
  });
});
