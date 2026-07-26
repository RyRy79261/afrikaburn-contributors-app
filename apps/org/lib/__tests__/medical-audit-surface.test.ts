import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { MEDICAL_VIEW_AUDIT_ACTION } from "@quagga/core";

import {
  activityLabel,
  activityTone,
  isFeedAction,
  FEED_EXCLUDED_ACTIONS,
} from "../status-board-format";

// REGRESSION: the medical read path is fail-open on purpose — an emergency read
// is never blocked, never rate-limited, and its audit row is written in
// `after()` so a dropped instance or a DB blip yields a silent, unlogged
// disclosure. That trade is only defensible if the rows that DO land are read
// by a human. Before `/audit` they were not: the registration decision log
// filters `subject = registrationId` (medical rows carry a user id), and the
// overview feed was six unfiltered rows. "Enumeration stays detectable" was a
// claim with no reader behind it.
//
// These tests pin the reader down: the action renders as English, it is kept
// out of the six-row glance so a roster walk cannot evict every decision, and a
// module + page actually query and render it.

function source(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relative}`, import.meta.url)),
    "utf8",
  );
}

describe("REGRESSION: medical reads render as English, not a raw action key", () => {
  it("labels bio.medical.view for a human", () => {
    const label = activityLabel(MEDICAL_VIEW_AUDIT_ACTION);
    expect(label).not.toBe(MEDICAL_VIEW_AUDIT_ACTION);
    expect(label).not.toMatch(/\./); // no dotted key leaking into the UI
    expect(label.toLowerCase()).toContain("medical");
  });

  it("gives it an attention tone, not the neutral admin dot", () => {
    expect(activityTone(MEDICAL_VIEW_AUDIT_ACTION)).toBe("attention");
  });

  it("still falls back to the key for genuinely unknown actions", () => {
    expect(activityLabel("something.new")).toBe("something.new");
  });
});

describe("REGRESSION: medical reads cannot swamp the six-row activity feed", () => {
  it("excludes bio.medical.view from the glance feed", () => {
    expect(FEED_EXCLUDED_ACTIONS).toContain(MEDICAL_VIEW_AUDIT_ACTION);
    expect(isFeedAction(MEDICAL_VIEW_AUDIT_ACTION)).toBe(false);
  });

  it("keeps registration decisions in the feed", () => {
    for (const action of [
      "registration.approve",
      "registration.reject",
      "registration.request_changes",
      "registration.start_review",
      "review.comment",
    ]) {
      expect(isFeedAction(action)).toBe(true);
    }
  });

  it("excludes nothing else — the feed is a glance, not a redaction", () => {
    expect([...FEED_EXCLUDED_ACTIONS]).toEqual([MEDICAL_VIEW_AUDIT_ACTION]);
  });

  it("the feed query applies the exclusion in SQL, not in the component", () => {
    // A JS-side filter after `limit 6` would return fewer than six rows (or
    // none) during a burst — the eviction bug in a different costume.
    const statusBoard = source("lib/status-board.ts");
    expect(statusBoard).toMatch(/notInArray\(\s*schema\.auditEvents\.action/);
    expect(statusBoard).toMatch(/FEED_EXCLUDED_ACTIONS/);
  });
});

describe("REGRESSION: something actually READS the medical audit rows", () => {
  const reader = source("lib/medical-audit.ts");

  it("queries audit_events for the medical action", () => {
    expect(reader).toMatch(/MEDICAL_VIEW_AUDIT_ACTION/);
    expect(reader).toMatch(/schema\.auditEvents\.action/);
  });

  it("runs the rows through the enumeration detector", () => {
    expect(reader).toMatch(/summarizeMedicalAccess/);
  });

  it("a gated console page renders that log", () => {
    const page = source("app/(console)/audit/page.tsx");
    expect(page).toMatch(/guardConsole/);
    expect(page).toMatch(/getMedicalAccessLog/);
    expect(page).toMatch(/MedicalAccessPanel/);
  });

  it("the console surfaces the alert without needing that page to be visited", () => {
    const overview = source("app/(console)/page.tsx");
    expect(overview).toMatch(/getMedicalAccessGlance/);
    expect(overview).toMatch(/MedicalAccessStrip/);
  });

  it("the audit surfaces show who/whose/when but never the notes", () => {
    const panel = source("components/audit/medical-access-panel.tsx");
    expect(panel).not.toMatch(/medicalNotes/);
    expect(panel).not.toMatch(/decrypt/i);
  });
});
