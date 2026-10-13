import { beforeEach, describe, expect, it, vi } from "vitest";

// The two receipt routes (docs/camp-budget-spec.md): POST attaches a receipt
// to a money record; GET is the only way one leaves the private blob store.
// Executed for real with the session, the store and the blob helpers stubbed.
// What this pins: every refusal on GET is the same 404; the bytes are sniffed
// (an SVG labelled image/png is refused); no token = a graceful 501; a camp
// the caller is not in = 404 with nothing stored; a PDF is a download.

const USER = "aaaaaaaa-0000-4000-8000-000000000009";
const CAMP = "11111111-0000-4000-8000-00000000000a";
const EDITION = "eeeeeeee-0000-4000-8000-000000000000";
const CLAIM = "33333333-0000-4000-8000-000000000001";
const KEY = `camp-receipts/${CAMP}/receipt-rnd.pdf`;

const stubs = vi.hoisted(() => ({
  viewer: null as { id: string } | null,
  gate: null as string | null,
  member: true,
  token: true,
  allowed: null as null | { groupId: string; key: string; contentType: string },
  stored: null as null | { contentType: string; body: Uint8Array },
  attached: [] as unknown[],
  attachResult: { ok: true } as { ok: true } | { ok: false; error: string },
  resolved: [] as unknown[],
}));

vi.mock("@/lib/config", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/session", () => ({
  getCurrentCampUser: async () => stubs.viewer,
  pendingBlockingRoute: async () => stubs.gate,
}));
vi.mock("@/lib/edition", () => ({
  getActiveEdition: async () => ({ id: EDITION, year: 2027 }),
}));
vi.mock("@/lib/camp-receipt-blob", () => ({
  isReceiptStorageConfigured: () => stubs.token,
  readReceiptBlob: async () => {
    if (!stubs.stored) return null;
    const body = stubs.stored.body;
    return {
      statusCode: 200,
      stream: new Blob([new Uint8Array(body)]).stream(),
      blob: { contentType: stubs.stored.contentType, size: body.length },
    };
  },
}));
vi.mock("@/lib/camp-money-store", () => ({
  loadMoneyAccess: async (slug: string) =>
    stubs.member && slug === "mad-hatters"
      ? { camp: { id: CAMP, slug }, isMoneyPerson: false }
      : null,
  attachReceipt: async (input: unknown) => {
    stubs.attached.push(input);
    return stubs.attachResult;
  },
  resolveReceiptForViewer: async (input: unknown) => {
    stubs.resolved.push(input);
    return stubs.allowed;
  },
}));

const serve = await import("../../app/api/money/receipts/[kind]/[id]/route");
const upload = await import("../../app/api/money/receipts/route");

const PDF = new TextEncoder().encode("%PDF-1.7\nhello");
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

function get(kind: string, id: string) {
  return serve.GET(
    new Request(`http://localhost/api/money/receipts/${kind}/${id}`),
    { params: Promise.resolve({ kind, id }) },
  );
}

function post(
  bytes: Uint8Array,
  type: string,
  fields: Record<string, string> = {},
  origin?: string,
) {
  const form = new FormData();
  form.append("slug", fields.slug ?? "mad-hatters");
  form.append("kind", fields.kind ?? "claim");
  form.append("id", fields.id ?? CLAIM);
  form.append("file", new File([new Uint8Array(bytes)], "slip", { type }));
  return upload.POST(
    new Request("http://localhost/api/money/receipts", {
      method: "POST",
      body: form,
      headers: origin ? { origin } : {},
    }),
  );
}

beforeEach(() => {
  stubs.viewer = { id: USER };
  stubs.gate = null;
  stubs.member = true;
  stubs.token = true;
  stubs.allowed = null;
  stubs.stored = null;
  stubs.attached = [];
  stubs.attachResult = { ok: true };
  stubs.resolved = [];
});

describe("GET a receipt — one 404 for every refusal", () => {
  it("not signed in, not allowed, a bad kind and a bad id all read the same", async () => {
    stubs.viewer = null;
    const responses = [await get("claim", CLAIM)];
    stubs.viewer = { id: USER };
    responses.push(await get("claim", CLAIM)); // resolver says no
    responses.push(await get("budget", CLAIM));
    responses.push(await get("claim", "not-a-uuid"));
    for (const r of responses) {
      expect(r.status).toBe(404);
      expect(await r.text()).toBe("Not found");
      expect(r.headers.get("cache-control")).toBe("private, no-store");
    }
    // Only the one well-formed, signed-in request reached the resolver, and
    // it asked as the session user.
    expect(stubs.resolved).toEqual([
      { viewerUserId: USER, kind: "claim", id: CLAIM },
    ]);
  });

  it("no blob token: 404, nothing resolved", async () => {
    stubs.token = false;
    expect((await get("claim", CLAIM)).status).toBe(404);
    expect(stubs.resolved).toHaveLength(0);
  });

  it("a stored type that no longer matches the record is refused", async () => {
    stubs.allowed = { groupId: CAMP, key: KEY, contentType: "application/pdf" };
    stubs.stored = { contentType: "text/html", body: PDF };
    expect((await get("claim", CLAIM)).status).toBe(404);
  });

  it("a PDF is served as a download, sandboxed and never cached", async () => {
    stubs.allowed = { groupId: CAMP, key: KEY, contentType: "application/pdf" };
    stubs.stored = { contentType: "application/pdf", body: PDF };
    const r = await get("claim", CLAIM);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toBe(
      'attachment; filename="receipt.pdf"',
    );
    expect(r.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PDF);
  });

  it("a photo opens inline", async () => {
    stubs.allowed = { groupId: CAMP, key: KEY, contentType: "image/png" };
    stubs.stored = { contentType: "image/png", body: PNG };
    const r = await get("entry", CLAIM);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toBe("inline");
  });
});

describe("POST a receipt", () => {
  it("attaches a sniffed PDF as the session user, to the resolved camp", async () => {
    const r = await post(PDF, "application/pdf");
    expect(r.status).toBe(200);
    expect(stubs.attached).toHaveLength(1);
    expect(stubs.attached[0]).toMatchObject({
      actorUserId: USER,
      groupId: CAMP,
      editionId: EDITION,
      kind: "claim",
      id: CLAIM,
    });
  });

  it("refuses an SVG however it is labelled, before anything is stored", async () => {
    const r = await post(SVG, "image/png");
    expect(r.status).toBe(415);
    expect(stubs.attached).toHaveLength(0);
  });

  it("refuses a file over 4 MB", async () => {
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    big.set(PDF);
    const r = await post(big, "application/pdf");
    expect(r.status).toBe(413);
    expect(stubs.attached).toHaveLength(0);
  });

  it("without a blob token: a graceful 501 with a message", async () => {
    stubs.token = false;
    const r = await post(PDF, "application/pdf");
    expect(r.status).toBe(501);
    expect((await r.json()).error).toMatch(/aren't configured/);
    expect(stubs.attached).toHaveLength(0);
  });

  it("a camp the caller is not in reads like one that does not exist", async () => {
    stubs.member = false;
    const notMine = await post(PDF, "application/pdf");
    stubs.member = true;
    const missing = await post(PDF, "application/pdf", { slug: "nowhere" });
    expect(notMine.status).toBe(404);
    expect(await notMine.json()).toEqual(await missing.json());
    expect(stubs.attached).toHaveLength(0);
  });

  it("refuses a cross-site post, a signed-out caller and a gated one", async () => {
    expect(
      (await post(PDF, "application/pdf", {}, "https://evil.example")).status,
    ).toBe(403);
    stubs.viewer = null;
    expect((await post(PDF, "application/pdf")).status).toBe(401);
    stubs.viewer = { id: USER };
    stubs.gate = "/onboarding";
    expect((await post(PDF, "application/pdf")).status).toBe(403);
    expect(stubs.attached).toHaveLength(0);
  });

  it("passes the store's refusal on (someone else's claim)", async () => {
    stubs.attachResult = { ok: false, error: "That isn't your claim." };
    const r = await post(PDF, "application/pdf");
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("That isn't your claim.");
  });
});
