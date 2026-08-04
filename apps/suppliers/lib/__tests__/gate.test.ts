import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * THE PORTAL DOOR. Every gated page in this app opens with
 *
 *   const guard = await guardPortal();
 *   if (!guard.ok) return guard.node;
 *
 * so `guardPortal` decides, once, whether a request sees supplier data or a
 * gate screen. `session.test`-style suites already prove `resolveSupplierSession`
 * classifies a caller correctly; this file proves the GUARD acts on that
 * classification — that only `kind: "ok"` becomes `{ ok: true }`, and that the
 * three refusals return a node rather than a session with a missing field.
 *
 * It also pins the shape of what `ok` hands back. `guardPortal` strips `kind`
 * with a rest spread, and a page that received it would read `session.supplier`
 * off the result. Dropping the wrong key there is a silent data bug, not a
 * crash, so it is asserted rather than assumed.
 *
 * Mirrors apps/org/lib/__tests__/console-gate.test.ts, which guards the same
 * seam on the console side.
 */

const resolveSupplierSession = vi.fn();
vi.mock("@/lib/session", () => ({
  resolveSupplierSession: () => resolveSupplierSession(),
}));

import { guardPortal } from "@/lib/gate";

const SUPPLIER = {
  id: "sup-1",
  name: "Karoo Water Co",
  code: "KWC-001",
  status: "active",
};

beforeEach(() => {
  resolveSupplierSession.mockReset();
});

describe("guardPortal", () => {
  it("lets a resolved supplier through, without the discriminant", async () => {
    resolveSupplierSession.mockResolvedValue({
      kind: "ok",
      user: { id: "auth-1", primaryEmail: "ops@karoowater.example" },
      dbUserId: "user-1",
      supplier: SUPPLIER,
    });

    const guard = await guardPortal();

    expect(guard.ok).toBe(true);
    if (!guard.ok) throw new Error("unreachable — asserted above");

    // The page reads these off the session; losing one is silent, not a crash.
    expect(guard.session.supplier).toEqual(SUPPLIER);
    expect(guard.session.dbUserId).toBe("user-1");
    // `kind` is the state machine's discriminant, not part of the session.
    expect(guard.session).not.toHaveProperty("kind");
  });

  it.each([
    ["unauthenticated", { kind: "unauthenticated" }],
    ["not_ready", { kind: "not_ready", user: { id: "auth-1" } }],
    ["unlinked", { kind: "unlinked", user: { id: "auth-1" }, dbUserId: "u1" }],
  ])(
    "refuses a %s caller with a gate node, not a session",
    async (_, state) => {
      resolveSupplierSession.mockResolvedValue(state);

      const guard = await guardPortal();

      expect(guard.ok).toBe(false);
      if (guard.ok) throw new Error("unreachable — asserted above");
      expect(guard.node).toBeTruthy();
      // No session leaks out alongside the refusal.
      expect(guard).not.toHaveProperty("session");
    },
  );

  it("hands back a GateScreen element, not some other node", async () => {
    resolveSupplierSession.mockResolvedValue({ kind: "unauthenticated" });

    const guard = await guardPortal();
    if (guard.ok) throw new Error("unreachable");

    // Asserted at the element, not by rendering it. Two of the three refusal
    // screens reach for `useRouter`, which is not mounted outside Next — so a
    // render here would prove the router harness works, not that the guard
    // does. What the gate screens LOOK like is the personas' job; what
    // `guardPortal` hands them is this file's.
    const el = guard.node as ReactElement;
    expect(typeof el.type).toBe("function");
  });

  it("passes the refusing state through to the screen, not a generic one", async () => {
    // The gate screen's copy differs per state — "sign in" vs "we are still
    // setting your account up" vs "no supplier is linked to this account".
    // Handing GateScreen the wrong state is how a supplier gets told to sign in
    // while already signed in.
    resolveSupplierSession.mockResolvedValue({
      kind: "unlinked",
      user: { id: "auth-1" },
      dbUserId: "u1",
    });

    const guard = await guardPortal();
    if (guard.ok) throw new Error("unreachable");

    const el = guard.node as ReactElement<{ state: { kind: string } }>;
    expect(el.props.state.kind).toBe("unlinked");
  });
});
