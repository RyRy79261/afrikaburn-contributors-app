import { describe, it, expect } from "vitest";
import {
  ID_RETENTION_GRACE_DAYS,
  idRetentionExpiresAt,
  isIdRetentionExpired,
  bioHasIdData,
  buildIdPurgePatch,
  identifyPurgeableIdBios,
  type RetentionEdition,
  type RetentionBio,
} from "../id-retention";

const edition2027: RetentionEdition = { id: "ed-2027", endDate: "2027-05-02" };
const edition2028: RetentionEdition = { id: "ed-2028", endDate: "2028-05-01" };

describe("idRetentionExpiresAt", () => {
  it("is the end of the end-date day plus the grace window", () => {
    const at = idRetentionExpiresAt(edition2027);
    // 2027-05-02 end of day (UTC) + 30 days = 2027-06-01T23:59:59.999Z
    expect(at.toISOString()).toBe("2027-06-01T23:59:59.999Z");
  });

  it("honours a custom grace period", () => {
    const at = idRetentionExpiresAt(edition2027, 0);
    expect(at.toISOString()).toBe("2027-05-02T23:59:59.999Z");
  });
});

describe("isIdRetentionExpired", () => {
  it("is false on the edition's final day", () => {
    expect(
      isIdRetentionExpired(edition2027, new Date("2027-05-02T12:00:00Z")),
    ).toBe(false);
  });

  it("is false during the grace window", () => {
    expect(
      isIdRetentionExpired(edition2027, new Date("2027-05-20T00:00:00Z")),
    ).toBe(false);
  });

  it("is true once the grace window has fully elapsed", () => {
    expect(
      isIdRetentionExpired(edition2027, new Date("2027-06-02T00:00:00Z")),
    ).toBe(true);
  });

  it("uses the default grace of 30 days", () => {
    expect(ID_RETENTION_GRACE_DAYS).toBe(30);
    // 29 days after end: still retained; 31 days after: expired.
    expect(
      isIdRetentionExpired(edition2027, new Date("2027-05-31T12:00:00Z")),
    ).toBe(false);
    expect(
      isIdRetentionExpired(edition2027, new Date("2027-06-03T00:00:00Z")),
    ).toBe(true);
  });

  it("never purges on a malformed end date", () => {
    expect(
      isIdRetentionExpired(
        { id: "bad", endDate: "not-a-date" },
        new Date("2999-01-01T00:00:00Z"),
      ),
    ).toBe(false);
  });
});

describe("bioHasIdData", () => {
  it("is true when either encrypted ID column is set", () => {
    expect(
      bioHasIdData({
        id: "b",
        editionId: "e",
        saIdEncrypted: "cipher",
        passportEncrypted: null,
      }),
    ).toBe(true);
    expect(
      bioHasIdData({
        id: "b",
        editionId: "e",
        saIdEncrypted: null,
        passportEncrypted: "cipher",
      }),
    ).toBe(true);
  });

  it("is false when both are null", () => {
    expect(
      bioHasIdData({
        id: "b",
        editionId: "e",
        saIdEncrypted: null,
        passportEncrypted: null,
      }),
    ).toBe(false);
  });
});

describe("buildIdPurgePatch", () => {
  it("nulls both encrypted ID columns and nothing else", () => {
    expect(buildIdPurgePatch()).toEqual({
      saIdEncrypted: null,
      passportEncrypted: null,
    });
  });
});

describe("identifyPurgeableIdBios", () => {
  const bios: RetentionBio[] = [
    // Expired edition, has SA ID → purgeable.
    {
      id: "bio-a",
      editionId: "ed-2027",
      saIdEncrypted: "cipher",
      passportEncrypted: null,
    },
    // Expired edition, but no ID data → not purgeable.
    {
      id: "bio-b",
      editionId: "ed-2027",
      saIdEncrypted: null,
      passportEncrypted: null,
    },
    // Current (not yet expired) edition, has passport → retained.
    {
      id: "bio-c",
      editionId: "ed-2028",
      saIdEncrypted: null,
      passportEncrypted: "cipher",
    },
    // Unknown edition (not in the editions list), has ID data → left alone.
    {
      id: "bio-d",
      editionId: "ed-unknown",
      saIdEncrypted: "cipher",
      passportEncrypted: null,
    },
  ];

  it("returns only bios of expired editions that still hold ID data", () => {
    const result = identifyPurgeableIdBios({
      // After 2027 grace, before 2028 grace.
      now: new Date("2027-07-01T00:00:00Z"),
      editions: [edition2027, edition2028],
      bios,
    });
    expect(result).toEqual([{ bioId: "bio-a", editionId: "ed-2027" }]);
  });

  it("purges nothing while every edition is still within retention", () => {
    const result = identifyPurgeableIdBios({
      now: new Date("2027-05-10T00:00:00Z"),
      editions: [edition2027, edition2028],
      bios,
    });
    expect(result).toEqual([]);
  });

  it("never purges bios of an edition it was not given", () => {
    const result = identifyPurgeableIdBios({
      now: new Date("2999-01-01T00:00:00Z"),
      editions: [], // no editions supplied at all
      bios,
    });
    expect(result).toEqual([]);
  });
});
