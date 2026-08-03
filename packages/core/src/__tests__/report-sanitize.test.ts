import { describe, it, expect } from "vitest";

import {
  describeRedactions,
  sanitizeReportText,
} from "../report-sanitize";

// The in-app reporter files PUBLIC GitHub issues. Anything that survives this
// function is world-readable the instant the issue exists, indexed, and kept in
// an edit history that outlives any later redaction.
//
// The person filing is usually looking at OTHER PEOPLE — a camp lead reporting
// a roster bug is on a screen full of members' phone numbers, emergency
// contacts and medical notes.

const clean = (s: string) => sanitizeReportText(s).text;

describe("sanitizeReportText", () => {
  it("removes an email address", () => {
    expect(clean("contact alice@example.com about it")).toBe(
      "contact [email] about it",
    );
  });

  describe("phone numbers", () => {
    it("removes a South African number written with SPACES", () => {
      // THE GAP THAT PROMPTED THIS REVIEW. The ported version matched
      // `0821234567` and `082-123-4567` but not `082 123 4567` — which is how
      // South Africans write them, and this product's users are almost entirely
      // South African. It would have shipped straight through.
      expect(clean("call her on 082 123 4567")).toBe("call her on [phone]");
    });

    it("removes the other South African forms", () => {
      expect(clean("082-123-4567")).toBe("[phone]");
      expect(clean("0821234567")).toBe("[phone]");
    });

    it("removes an international number", () => {
      expect(clean("+27 82 123 4567")).toBe("[phone]");
      expect(clean("+49-123-4567890")).toBe("[phone]");
    });
  });

  it("removes a South African ID number without shredding it into a phone", () => {
    // 13 digits. If the phone rule ran first this would escape as "[phone]3" —
    // wrong, and still leaking three digits of a national identifier.
    const out = clean("id 8001015009087 on file");
    expect(out).toBe("id [id-number] on file");
    expect(out).not.toMatch(/\d/);
  });

  it("removes card numbers and dates", () => {
    expect(clean("4111 1111 1111 1111")).toBe("[card]");
    expect(clean("born 1980-01-01")).toBe("born [date]");
    expect(clean("born 01/01/1980")).toBe("born [date]");
  });

  it("removes UUIDs, which are how this schema names people and camps", () => {
    expect(clean("user 3f7c1e2a-9b4d-4f8e-a1c2-5d6e7f8a9b0c failed")).toBe(
      "user [id] failed",
    );
  });

  it("removes our own reference codes", () => {
    expect(clean("member MAH-M017")).toBe("member [ref]");
    expect(clean("supplier SUP-2027-0416")).toBe("supplier [ref]");
  });

  describe("structured data — the real risk", () => {
    it("removes a serialised object wholesale", () => {
      // No pattern can catch a NAME or a free-text medical note. The structure
      // carrying them is what gets removed, so nothing inside has to be
      // recognised individually.
      const out = clean(
        'failed to render {"name":"Alice Hatter","medical":"epileptic, carries meds"}',
      );
      expect(out).toBe("failed to render [structured data removed]");
      expect(out).not.toMatch(/Alice/);
      expect(out).not.toMatch(/epileptic/);
    });

    it("removes an array of members", () => {
      const out = clean('roster ["Alice","Ren","Jabu"] did not load');
      expect(out).not.toMatch(/Alice|Ren|Jabu/);
    });

    it("catches the realistic case: a payload inside a stack trace", () => {
      const stack = [
        "TypeError: Cannot read properties of undefined",
        '    at RosterCard (roster.tsx:42) payload={"userId":"3f7c1e2a-9b4d-4f8e-a1c2-5d6e7f8a9b0c","phone":"082 123 4567","emergency":"Ren 083 999 1111"}',
        "    at renderWithHooks (react-dom.js:1)",
      ].join("\n");
      const out = clean(stack);
      expect(out).not.toMatch(/082|083|3f7c1e2a/);
      expect(out).not.toMatch(/Ren/);
      // …while keeping what makes it diagnostic.
      expect(out).toMatch(/TypeError/);
      expect(out).toMatch(/roster\.tsx:42/);
    });
  });

  describe("markup", () => {
    it("strips tags, including unterminated ones", () => {
      expect(clean("hello <b>world</b>")).toBe("hello world");
      // `<script` with no closing bracket: a naive regex leaves it behind.
      expect(clean("bad <script")).toBe("bad");
    });

    it("does not backtrack pathologically on repeated angle brackets", () => {
      const started = Date.now();
      clean("<".repeat(20_000));
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });

  it("keeps newlines, because stack traces need them", () => {
    expect(clean("line one\nline two")).toBe("line one\nline two");
  });

  it("truncates to the cap", () => {
    expect(sanitizeReportText("x".repeat(500), 100).text).toHaveLength(100);
  });

  it("handles empty and non-string input without throwing", () => {
    expect(sanitizeReportText("")).toEqual({ text: "", redacted: [] });
    expect(sanitizeReportText(null as never)).toEqual({ text: "", redacted: [] });
  });

  it("is deterministic across repeated calls", () => {
    // The rules carry /g and are module-level, so a stateful `lastIndex` would
    // make the SECOND call skip matches. That failure is intermittent and would
    // leak a real phone number on an unlucky report.
    const input = "call 082 123 4567 or mail a@b.com";
    const first = clean(input);
    const second = clean(input);
    const third = clean(input);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(first).not.toMatch(/082|a@b/);
  });

  it("reports what it removed", () => {
    const { redacted } = sanitizeReportText("a@b.com 082 123 4567");
    expect(redacted).toContain("email");
    expect(redacted).toContain("phone");
  });
});

describe("describeRedactions", () => {
  it("never claims the report is anonymised", () => {
    const note = describeRedactions(["email", "phone"]);
    expect(note).toMatch(/email addresses/);
    expect(note).toMatch(/fails open/);
    expect(note.toLowerCase()).not.toMatch(/anonymi[sz]ed/);
  });

  it("is honest when it found nothing", () => {
    // "We found nothing" must not read as "there is nothing".
    const note = describeRedactions([]);
    expect(note).toMatch(/not a guarantee/i);
  });
});
