import { describe, it, expect } from "vitest";
import { fieldErrorFor, describedByForGroup } from "../field-errors";

// THE REGRESSION THESE EXIST FOR.
//
// `fieldError` lived as a closure inside `bio-flow.tsx` and was gutted to
// `ids.map((id) => id).filter(() => false)` — always empty, so it returned
// `undefined` for every field and no inline refusal rendered at all. That
// shipped in one commit on this branch.
//
// Nothing in the unit suite noticed, because `apps/web/vitest.config.ts` is
// `environment: "node"` including only `lib/**`, so the component's tests were
// SOURCE assertions: they checked a `fieldError(...)` call existed and that
// `found.join(" · ")` appeared in the file. Both were still true of the gutted
// version. The persona suite caught it — on the single field that spec types
// into — which is luck, not coverage.
//
// These run the function. A gutted implementation cannot pass them.

const REFUSED = {
  "onsite.name": "This question is required",
  "onsite.phone": "Enter a valid phone number",
  medicalNotes: "Max 1000 characters",
};

describe("fieldErrorFor", () => {
  it("returns the message for a refused key", () => {
    expect(fieldErrorFor(REFUSED, "medicalNotes")).toBe("Max 1000 characters");
  });

  it("returns undefined when nothing it owns was refused", () => {
    // Must be undefined, not "" — `<Field error="">` would render an empty
    // message element and suppress the help text.
    expect(fieldErrorFor(REFUSED, "homeCity")).toBeUndefined();
    expect(fieldErrorFor({}, "medicalNotes")).toBeUndefined();
    expect(fieldErrorFor(REFUSED)).toBeUndefined();
  });

  it("speaks for BOTH halves of a shared field", () => {
    // The half that is missed is the half the person does not fix.
    expect(fieldErrorFor(REFUSED, "onsite.name", "onsite.phone")).toBe(
      "This question is required · Enter a valid phone number",
    );
  });

  it("reports the one refused half of a shared field on its own", () => {
    expect(fieldErrorFor(REFUSED, "offsite.name", "onsite.phone")).toBe(
      "Enter a valid phone number",
    );
  });

  it("keeps the order the caller asked for", () => {
    // The Field lists name then phone; the message should read the same way.
    expect(fieldErrorFor(REFUSED, "onsite.phone", "onsite.name")).toBe(
      "Enter a valid phone number · This question is required",
    );
  });

  it("ignores keys present but empty", () => {
    // A cleared error is not an error. `filter(Boolean)`, not `in`.
    expect(fieldErrorFor({ homeCity: "" }, "homeCity")).toBeUndefined();
  });
});

describe("describedByForGroup", () => {
  it("names the field's ERROR element when any of its answers was refused", () => {
    expect(
      describedByForGroup(REFUSED, "onsite.name", "onsite.name", "onsite.phone"),
    ).toBe("onsite.name-error");
  });

  it("names it when only the SECOND half was refused", () => {
    // The case that made this necessary: the phone has no message element of
    // its own, so it has to point at the field's.
    expect(
      describedByForGroup(
        { "onsite.phone": "Enter a valid phone number" },
        "onsite.name",
        "onsite.name",
        "onsite.phone",
      ),
    ).toBe("onsite.name-error");
  });

  it("names the HELP element when nothing it owns was refused", () => {
    expect(
      describedByForGroup({}, "onsite.name", "onsite.name", "onsite.phone"),
    ).toBe("onsite.name-help");
  });

  it("never names a key that has no element", () => {
    // `onsite.phone-error` is not rendered by anything. Pointing at it is worse
    // than pointing at nothing: neither help nor error gets announced.
    const id = describedByForGroup(
      REFUSED,
      "onsite.name",
      "onsite.name",
      "onsite.phone",
    );
    expect(id).not.toContain("onsite.phone");
  });

  it("ignores an empty message the same way the error slot does", () => {
    expect(describedByForGroup({ "id.type": "" }, "id.number", "id.type")).toBe(
      "id.number-help",
    );
  });
});
