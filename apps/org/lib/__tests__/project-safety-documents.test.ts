import { describe, it, expect, beforeEach, vi } from "vitest";

import { fakeDb, type FakeDb } from "./support/fake-db";
import {
  CAMPS_LEAD,
  GOD,
  NO_ROLES,
  PERSONAL_READER,
  READER,
  SUPPLIERS_LEAD,
} from "./support/actors";

import type * as QuaggaDb from "@quagga/db";

let db: FakeDb;
vi.mock("@quagga/db", async (importOriginal) => ({
  ...(await importOriginal<typeof QuaggaDb>()),
  createHttpDb: () => db,
}));

import { getReviewSafetyDocuments } from "@/lib/project-registration";

// SAFETY DOCUMENTS ON THE REVIEW PAGE (CREATIVE-017). Private to the project's
// lead/admin and to org staff who read personal information in the
// registrations domain. Paired, per the console's rule: the rows are SEEDED, a
// granted actor receives them, a refused actor gets `null` AND no query ran —
// so dropping the guard turns the refused half red.

const TODAY = "2027-01-15";
const DOCS = [
  {
    title: "Structural sign-off",
    url: "https://blob.example/structural.pdf",
    expiresOn: "2027-12-31",
    editionEndDate: "2027-05-02",
  },
  {
    title: "Fire cert",
    url: "https://blob.example/fire.pdf",
    expiresOn: "2027-04-28",
    editionEndDate: "2027-05-02",
  },
  {
    title: "Old roadworthy",
    url: "https://blob.example/rw.pdf",
    expiresOn: "2026-11-30",
    editionEndDate: "2027-05-02",
  },
];

beforeEach(() => {
  db = fakeDb({ rows: { registration_safety_documents: DOCS } });
});

describe("getReviewSafetyDocuments", () => {
  it.each([
    ["the System manager", GOD],
    ["an org-wide personal-information reader", PERSONAL_READER],
    ["the department that owns registrations", CAMPS_LEAD],
  ])("returns them, with validity, to %s", async (_label, actor) => {
    const docs = await getReviewSafetyDocuments("reg-1", actor, TODAY);
    expect(docs).toEqual([
      {
        title: "Structural sign-off",
        url: "https://blob.example/structural.pdf",
        expiresOn: "2027-12-31",
        validity: "valid",
      },
      {
        title: "Fire cert",
        url: "https://blob.example/fire.pdf",
        expiresOn: "2027-04-28",
        validity: "expires_during_event",
      },
      {
        title: "Old roadworthy",
        url: "https://blob.example/rw.pdf",
        expiresOn: "2026-11-30",
        validity: "expired",
      },
    ]);
  });

  it.each([
    ["a plain console reader", READER],
    ["a Suppliers lead (personal information elsewhere only)", SUPPLIERS_LEAD],
    ["an account with the door and no roles", NO_ROLES],
  ])("withholds them from %s — before any query", async (_label, actor) => {
    expect(await getReviewSafetyDocuments("reg-1", actor, TODAY)).toBeNull();
    expect(db.recorded("select", "registration_safety_documents")).toHaveLength(
      0,
    );
  });
});
