import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The receipt store (lib/camp-receipt-blob.ts): private blobs under each
// camp's own prefix. What this pins: every receipt is written PRIVATE with
// the sniffed type, and no read or delete ever reaches a key outside the
// camp it was asked for — a corrupted key must not touch another camp's file.

const CAMP_A = "11111111-0000-4000-8000-00000000000a";
const CAMP_B = "11111111-0000-4000-8000-00000000000b";

const stubs = vi.hoisted(() => ({
  puts: [] as { pathname: string; options: Record<string, unknown> }[],
  dels: [] as string[],
  gets: [] as string[],
  delFails: false,
  getStatus: 200,
}));

vi.mock("@vercel/blob", () => ({
  put: async (
    pathname: string,
    _b: unknown,
    options: Record<string, unknown>,
  ) => {
    stubs.puts.push({ pathname, options });
    return { pathname: pathname.replace(/\.(\w+)$/, "-rnd.$1") };
  },
  del: async (key: string) => {
    if (stubs.delFails) throw new Error("blob store unreachable");
    stubs.dels.push(key);
  },
  get: async (key: string) => {
    stubs.gets.push(key);
    return { statusCode: stubs.getStatus, stream: null, blob: {} };
  },
}));

const blob = await import("../camp-receipt-blob");

beforeEach(() => {
  stubs.puts = [];
  stubs.dels = [];
  stubs.gets = [];
  stubs.delFails = false;
  stubs.getStatus = 200;
});
afterEach(() => vi.unstubAllEnvs());

describe("camp receipt blobs", () => {
  it("is configured only with a blob token", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(blob.isReceiptStorageConfigured()).toBe(false);
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "token");
    expect(blob.isReceiptStorageConfigured()).toBe(true);
  });

  it("stores a receipt PRIVATE, under the camp's prefix, with the sniffed type", async () => {
    const key = await blob.putReceiptBlob(
      CAMP_A,
      new Uint8Array([1, 2, 3]),
      "application/pdf",
    );
    expect(key).toBe(`camp-receipts/${CAMP_A}/receipt-rnd.pdf`);
    expect(stubs.puts).toEqual([
      {
        pathname: `camp-receipts/${CAMP_A}/receipt.pdf`,
        options: {
          access: "private",
          addRandomSuffix: true,
          contentType: "application/pdf",
        },
      },
    ]);
  });

  it("deletes only a key under the camp it was asked for", async () => {
    const mine = `camp-receipts/${CAMP_A}/receipt-x.pdf`;
    await blob.deleteReceiptBlob(CAMP_B, mine);
    await blob.deleteReceiptBlob(CAMP_A, null);
    await blob.deleteReceiptBlob(CAMP_A, `camp-receipts/${CAMP_A}/../x`);
    expect(stubs.dels).toEqual([]);
    await blob.deleteReceiptBlob(CAMP_A, mine);
    expect(stubs.dels).toEqual([mine]);
  });

  it("the quiet delete swallows a failure (logged, never thrown)", async () => {
    stubs.delFails = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      blob.deleteReceiptBlobQuietly(
        CAMP_A,
        `camp-receipts/${CAMP_A}/receipt-x.pdf`,
      ),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("reads only a key under the camp, and answers null for a missing blob", async () => {
    expect(
      await blob.readReceiptBlob(CAMP_B, `camp-receipts/${CAMP_A}/r.pdf`),
    ).toBeNull();
    expect(stubs.gets).toEqual([]);
    expect(
      await blob.readReceiptBlob(CAMP_A, `camp-receipts/${CAMP_A}/r.pdf`),
    ).not.toBeNull();
    stubs.getStatus = 304;
    expect(
      await blob.readReceiptBlob(CAMP_A, `camp-receipts/${CAMP_A}/r.pdf`),
    ).toBeNull();
  });
});
