import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { GroupKind } from "@quagga/types";
import { dbMock } from "@/test/db-mock";

// The two photo routes, executed for real against the db mock with the session
// and the blob provider stubbed. These are the regression tests the epic asks
// for at the HTTP boundary: the proxy refuses a stranger a camp_mates photo,
// and the upload refuses an SVG however it is labelled.

vi.mock("@/lib/db", async () =>
  (await import("@/test/db-mock")).dbModuleMock(),
);

const stubs = vi.hoisted(() => ({
  viewer: null as { id: string } | null,
  gate: null as string | null,
  puts: [] as { pathname: string; options: Record<string, unknown> }[],
  dels: [] as string[],
  delFails: false,
  stored: null as null | { contentType: string; body: Uint8Array },
}));

vi.mock("@/lib/session", () => ({
  getCurrentCampUser: async () => stubs.viewer,
  pendingBlockingRoute: async () => stubs.gate,
}));

vi.mock("@/lib/edition", () => ({
  getActiveEdition: async () => ({
    id: "eeeeeeee-0000-4000-8000-000000000000",
    name: "AfrikaBurn 2027",
    year: 2027,
    startDate: "2027-04-26",
    endDate: "2027-05-02",
    isActive: true,
  }),
}));

vi.mock("@vercel/blob", () => ({
  put: async (
    pathname: string,
    _body: unknown,
    options: Record<string, unknown>,
  ) => {
    stubs.puts.push({ pathname, options });
    // What addRandomSuffix does: a suffix before the extension.
    return { pathname: pathname.replace(/\.(\w+)$/, "-rnd.$1") };
  },
  del: async (key: string) => {
    if (stubs.delFails) throw new Error("blob store unreachable");
    stubs.dels.push(key);
  },
  get: async () => {
    if (!stubs.stored) return null;
    const body = stubs.stored.body;
    return {
      statusCode: 200,
      stream: new Blob([new Uint8Array(body)]).stream(),
      headers: new Headers(),
      blob: {
        contentType: stubs.stored.contentType,
        size: body.length,
      },
    };
  },
}));

const proxy = await import("../../app/api/avatar/[userId]/route");
const own = await import("../../app/api/avatar/route");

const THEME_CAMP = GroupKind.enum.theme_camp;
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const REN = "aaaaaaaa-0000-4000-8000-000000000002";
const JABU = "aaaaaaaa-0000-4000-8000-000000000003";
const CAMP_A = "11111111-0000-4000-8000-00000000000a";
const CAMP_B = "11111111-0000-4000-8000-00000000000b";
const KEY = `avatars/${ALICE}/photo-rnd.png`;

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
]);
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

function bio(flags: Record<string, unknown>) {
  return {
    userId: ALICE,
    legalName: null,
    homeCity: null,
    bio: null,
    skills: [],
    attendedYears: [],
    firstTime: false,
    contactEmail: null,
    about: null,
    campHistory: null,
    volunteeringInterests: null,
    rangerTraining: null,
    rangerCurious: null,
    greenDotTraining: null,
    privacyFlags: flags,
    contactable: "nobody",
    listedInCampPeople: false,
    // Confirmed this edition — an unconfirmed bio shows its photo to nobody
    // but its owner (campmates-store.test.ts covers that case).
    completedAt: new Date("2027-01-10T00:00:00Z"),
  };
}

function getPhoto(userId: string) {
  return proxy.GET(new Request(`http://localhost/api/avatar/${userId}`), {
    params: Promise.resolve({ userId }),
  });
}

function uploadRequest(bytes: Uint8Array, type: string, name = "me.png") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type }));
  return new Request("http://localhost/api/avatar", {
    method: "POST",
    body: form,
  });
}

function deleteRequest(origin?: string) {
  return new Request("http://localhost/api/avatar", {
    method: "DELETE",
    headers: origin ? { origin } : {},
  });
}

beforeEach(() => {
  dbMock.reset();
  stubs.viewer = null;
  stubs.gate = null;
  stubs.puts = [];
  stubs.dels = [];
  stubs.delFails = false;
  stubs.stored = { contentType: "image/png", body: PNG };
  vi.stubEnv("DATABASE_URL", "postgres://test/quagga");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/avatar/[userId] — the photo proxy", () => {
  it("REFUSES a stranger a camp_mates photo (404, nothing streamed)", async () => {
    stubs.viewer = { id: JABU };
    dbMock.queue(
      [{ avatarKey: KEY, sanitizedAt: null }],
      [
        { userId: JABU, groupId: CAMP_B, groupKind: THEME_CAMP },
        { userId: ALICE, groupId: CAMP_A, groupKind: THEME_CAMP },
      ],
      [bio({ avatar: "camp_mates" })],
    );
    const res = await getPhoto(ALICE);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).not.toMatch(/^image\//);
  });

  it("serves the camp-mate, with per-viewer cache and sniff hardening", async () => {
    stubs.viewer = { id: REN };
    dbMock.queue(
      [{ avatarKey: KEY, sanitizedAt: null }],
      [
        { userId: REN, groupId: CAMP_A, groupKind: THEME_CAMP },
        { userId: ALICE, groupId: CAMP_A, groupKind: THEME_CAMP },
      ],
      [bio({ avatar: "camp_mates" })],
    );
    const res = await getPhoto(ALICE);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("refuses a signed-out request without touching the database", async () => {
    const res = await getPhoto(ALICE);
    expect(res.status).toBe(404);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("refuses a malformed id", async () => {
    stubs.viewer = { id: REN };
    expect((await getPhoto("not-a-uuid")).status).toBe(404);
  });

  it("never serves a stored blob whose type is not an allowed raster (e.g. SVG)", async () => {
    stubs.viewer = { id: ALICE };
    stubs.stored = { contentType: "image/svg+xml", body: SVG };
    dbMock.queue([{ avatarKey: KEY, sanitizedAt: null }], [bio({})]);
    expect((await getPhoto(ALICE)).status).toBe(404);
  });

  it("is a 404 when photo storage is not configured (env-less boot)", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    stubs.viewer = { id: ALICE };
    expect((await getPhoto(ALICE)).status).toBe(404);
  });
});

describe("POST /api/avatar — upload your own photo", () => {
  it("REFUSES an SVG even when it claims to be a PNG (415, nothing stored)", async () => {
    stubs.viewer = { id: ALICE };
    for (const type of ["image/png", "image/svg+xml", ""]) {
      const res = await own.POST(uploadRequest(SVG, type, "me.png"));
      expect(res.status).toBe(415);
    }
    expect(stubs.puts).toHaveLength(0);
    expect(dbMock.writesTo(schema.users)).toHaveLength(0);
  });

  it("stores a real PNG PRIVATELY with the sniffed type, and points the account at it", async () => {
    stubs.viewer = { id: ALICE };
    dbMock.queue([{ avatarKey: null }]);
    const res = await own.POST(uploadRequest(PNG, "application/octet-stream"));
    expect(res.status).toBe(200);
    expect(stubs.puts).toHaveLength(1);
    expect(stubs.puts[0]!.pathname.startsWith(`avatars/${ALICE}/`)).toBe(true);
    expect(stubs.puts[0]!.options.access).toBe("private");
    expect(stubs.puts[0]!.options.contentType).toBe("image/png");
    const set = dbMock.writesTo(schema.users)[0]!.arg("set") as Record<
      string,
      unknown
    >;
    expect(String(set.avatarKey).startsWith(`avatars/${ALICE}/`)).toBe(true);
  });

  it("deletes the photo it replaced", async () => {
    stubs.viewer = { id: ALICE };
    dbMock.queue([{ avatarKey: `avatars/${ALICE}/old.png` }]);
    await own.POST(uploadRequest(PNG, "image/png"));
    expect(stubs.dels).toEqual([`avatars/${ALICE}/old.png`]);
  });

  it("refuses an oversize photo (413)", async () => {
    stubs.viewer = { id: ALICE };
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await own.POST(uploadRequest(big, "image/png"))).status).toBe(413);
    expect(stubs.puts).toHaveLength(0);
  });

  it("refuses the signed-out (401), the gated (403) and the unconfigured (501)", async () => {
    expect((await own.POST(uploadRequest(PNG, "image/png"))).status).toBe(401);
    stubs.viewer = { id: ALICE };
    stubs.gate = "/onboarding";
    expect((await own.POST(uploadRequest(PNG, "image/png"))).status).toBe(403);
    stubs.gate = null;
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect((await own.POST(uploadRequest(PNG, "image/png"))).status).toBe(501);
    expect(stubs.puts).toHaveLength(0);
  });
});

describe("DELETE /api/avatar — remove your own photo", () => {
  it("deletes the blob, then clears the key", async () => {
    stubs.viewer = { id: ALICE };
    dbMock.queue([{ avatarKey: KEY }]);
    const res = await own.DELETE(deleteRequest());
    expect(res.status).toBe(200);
    expect(stubs.dels).toEqual([KEY]);
    const set = dbMock.writesTo(schema.users)[0]!.arg("set") as Record<
      string,
      unknown
    >;
    expect(set.avatarKey).toBeNull();
  });

  it("keeps the key when the blob could not be deleted — never 'removed' while the file exists", async () => {
    stubs.viewer = { id: ALICE };
    stubs.delFails = true;
    dbMock.queue([{ avatarKey: KEY }]);
    const res = await own.DELETE(deleteRequest());
    expect(res.status).toBe(500);
    expect(dbMock.writesTo(schema.users)).toHaveLength(0);
  });

  it("refuses a cross-site request before reading the session (CSRF)", async () => {
    stubs.viewer = { id: ALICE };
    dbMock.queue([{ avatarKey: KEY }]);
    const res = await own.DELETE(deleteRequest("https://evil.example"));
    expect(res.status).toBe(403);
    expect(stubs.dels).toEqual([]);
    expect(dbMock.queries).toHaveLength(0);

    const form = new FormData();
    form.append("file", new File([new Uint8Array(PNG)], "me.png"));
    const post = await own.POST(
      new Request("http://localhost/api/avatar", {
        method: "POST",
        body: form,
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(post.status).toBe(403);
    expect(stubs.puts).toHaveLength(0);

    // Same-origin is fine.
    const ok = await own.DELETE(deleteRequest("http://localhost"));
    expect(ok.status).toBe(200);
  });

  it("never deletes a key outside the member's own prefix", async () => {
    stubs.viewer = { id: ALICE };
    dbMock.queue([{ avatarKey: `avatars/${REN}/theirs.png` }]);
    await own.DELETE(deleteRequest());
    expect(stubs.dels).toEqual([]);
  });
});
