import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// The disappearing-messages sweep route (epic #69): runs ONLY for a caller
// holding CRON_SECRET or ACCOUNT_SWEEP_SECRET; any other GET is a status probe
// that deletes nothing and touches no database.

const stubs = vi.hoisted(() => ({ runs: 0, fail: false }));

vi.mock("@/lib/messages-store", () => ({
  sweepExpiredMessages: async () => {
    stubs.runs += 1;
    if (stubs.fail) throw new Error("db down");
    return { messagesDeleted: 4, reportsDeleted: 1 };
  },
}));

const route = await import("../../app/api/messages/expiry-sweep/route");

function request(method: string, token?: string): NextRequest {
  return new NextRequest("http://localhost/api/messages/expiry-sweep", {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  stubs.runs = 0;
  stubs.fail = false;
  process.env.DATABASE_URL = "postgres://test";
  process.env.CRON_SECRET = "cron-secret-value";
  delete process.env.ACCOUNT_SWEEP_SECRET;
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.CRON_SECRET;
  delete process.env.ACCOUNT_SWEEP_SECRET;
});

describe("messages expiry sweep route", () => {
  it("runs for Vercel Cron's bearer", async () => {
    const res = await route.GET(request("GET", "cron-secret-value"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      messagesDeleted: 4,
      reportsDeleted: 1,
    });
    expect(stubs.runs).toBe(1);
  });

  it("an unauthenticated GET deletes nothing", async () => {
    const res = await route.GET(request("GET"));
    expect(await res.json()).toMatchObject({ ok: true, enabled: true });
    expect(stubs.runs).toBe(0);
    const wrong = await route.GET(request("GET", "cron-secret-valuX"));
    expect(wrong.status).toBe(200);
    expect(stubs.runs).toBe(0);
  });

  it("a POST with the wrong token is refused", async () => {
    const res = await route.POST(request("POST", "nope"));
    expect(res.status).toBe(401);
    expect(stubs.runs).toBe(0);
  });

  it("is disabled when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await route.POST(request("POST", "cron-secret-value"));
    expect(res.status).toBe(503);
    expect((await route.GET(request("GET"))).status).toBe(200);
    expect(stubs.runs).toBe(0);
  });

  it("answers 500 when the sweep fails, and 503 without a database", async () => {
    stubs.fail = true;
    expect(
      (await route.POST(request("POST", "cron-secret-value"))).status,
    ).toBe(500);
    delete process.env.DATABASE_URL;
    expect(
      (await route.POST(request("POST", "cron-secret-value"))).status,
    ).toBe(503);
  });
});
