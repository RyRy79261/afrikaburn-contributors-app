import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  clearClientErrors,
  collectEnvironment,
  installClientErrorCapture,
  recentClientErrors,
} from "../../lib/client-errors";

// What this buffer holds ends up in a PUBLIC GitHub issue if somebody files a
// report. The caps and the omissions below are the point of the module, not
// housekeeping.

let teardown: () => void = () => {};

beforeEach(() => {
  clearClientErrors();
  teardown = installClientErrorCapture();
});

afterEach(() => {
  teardown();
  clearClientErrors();
});

describe("installClientErrorCapture", () => {
  it("captures console.error, which is where React reports render failures", () => {
    console.error("Hydration failed because the server HTML did not match");
    const [entry] = recentClientErrors();
    expect(entry?.source).toBe("console.error");
    expect(entry?.message).toContain("Hydration failed");
  });

  it("still passes console.error through to the console", () => {
    // Swallowing what a developer would otherwise see in devtools would be a
    // much worse bug than the one being reported.
    const seen: unknown[][] = [];
    // Uninstall FIRST, so `original` is the real console.error and not this
    // suite's own wrapper — restoring a wrapper at the end would leave it
    // installed for every later test.
    teardown();
    const original = console.error;
    console.error = (...args: unknown[]) => {
      seen.push(args);
    };
    teardown = installClientErrorCapture();

    console.error("boom", 42);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toBe("boom");

    teardown();
    console.error = original;
    teardown = () => {};
  });

  it("captures an unhandled rejection", () => {
    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), {
        reason: new Error("network down"),
      }),
    );
    const [entry] = recentClientErrors();
    expect(entry?.source).toBe("unhandledrejection");
    expect(entry?.message).toContain("network down");
  });

  it("keeps only the most recent errors", () => {
    // The ones immediately before somebody reaches for the reporter are the
    // ones worth having, so the buffer drops the oldest rather than the newest.
    for (let i = 0; i < 30; i++) console.error(`error ${i}`);
    const entries = recentClientErrors();
    expect(entries).toHaveLength(20);
    expect(entries[0]?.message).toContain("error 10");
    expect(entries.at(-1)?.message).toContain("error 29");
  });

  it("truncates an enormous message rather than refusing it", () => {
    // The server's schema caps at 2000; a client that sent more would have its
    // whole report rejected for one runaway error.
    console.error("x".repeat(50_000));
    expect(recentClientErrors()[0]?.message.length).toBe(2_000);
  });

  it("records the path but never the query string", () => {
    // Query strings on this product carry invite codes and search terms, and
    // this value is published.
    window.history.replaceState({}, "", "/camps/karoo-kombuis?invite=SECRET123");
    console.error("something broke");
    const [entry] = recentClientErrors();
    expect(entry?.route).toBe("/camps/karoo-kombuis");
    expect(entry?.route).not.toContain("SECRET123");
  });

  it("does not throw when the logged value cannot be serialised", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => console.error(circular)).not.toThrow();
    expect(recentClientErrors()).toHaveLength(1);
  });

  it("is idempotent", () => {
    const second = installClientErrorCapture();
    console.error("once");
    // Installed twice would record the same error twice and, worse, leak the
    // original console.error on teardown.
    expect(recentClientErrors()).toHaveLength(1);
    second();
  });
});

describe("collectEnvironment", () => {
  it("describes the device and nothing about the person", () => {
    const fields = collectEnvironment();
    const labels = fields.map((f) => f.label);
    expect(labels).toContain("User agent");
    expect(labels).toContain("Viewport");
    // No identity of any kind: this list is published verbatim.
    expect(labels).not.toContain("Email");
    expect(labels).not.toContain("User");
    expect(labels).not.toContain("Account");
  });

  it("stays within the schema's caps even with extra fields", () => {
    const fields = collectEnvironment(
      Array.from({ length: 40 }, (_, i) => ({
        label: `extra ${i}`,
        value: "y".repeat(2_000),
      })),
    );
    expect(fields.length).toBeLessThanOrEqual(25);
    for (const field of fields) {
      expect(field.value.length).toBeLessThanOrEqual(500);
    }
  });
});
