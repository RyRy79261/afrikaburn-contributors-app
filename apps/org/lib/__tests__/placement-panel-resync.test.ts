import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// REGRESSION: the placement inputs kept the text that was typed, not the text
// that was stored.
//
// `assignPlacement` normalizes — `mah-1` is saved as `MAH1`. The panel's drafts
// initialize once from props, so after a save the boxes still read `mah-1`: a
// reviewer looking at a value that is not in the database, with `dirty` still
// true against no remaining change and the Save button still lit. Two guards
// hold it now, and this pins both.
//
// WHY A SOURCE ASSERTION AND NOT A COMPONENT TEST. The review asked for a
// Vitest component test. `apps/org/vitest.config.ts` is `environment: "node"`
// with `include: ["lib/**/__tests__/**/*.test.ts"]`, and the workspace carries
// neither jsdom nor @testing-library — so a test mounting `PlacementPanel`
// would not be collected, and making it collectable means adding two dev
// dependencies and reopening that config's coverage scope. That is a decision
// for whoever owns this workspace, not a side effect of a review fix. Until
// then this catches the regression that actually happened — someone deleting
// the adoption — and `apps/org/lib/__tests__/placement-actions.test.ts` still
// covers the normalization itself on the action side.
//
// The behavioural half belongs in the org-staff persona suite, where a real
// browser can type `mah-1`, save, and read `MAH1` back out of the input. That
// spec now exists: "a camp code saves in its stored form, and the form
// settles" in e2e/specs/org-staff/registration-review.spec.ts.

function source(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relative}`, import.meta.url)),
    "utf8",
  );
}

describe("PlacementPanel shows what was stored, not what was typed", () => {
  const panel = source("components/registration/placement-panel.tsx");

  it("adopts the values the action returns after a successful save", () => {
    // The action's own result is the source — not the typed drafts, and not a
    // re-read that would race `router.refresh()`.
    expect(panel).toContain("setCodeDraft(result.campCode ?? \"\")");
    expect(panel).toContain("setErfDraft(result.erf ?? \"\")");

    // …and it happens on the success path, after the `!result.ok` bail.
    const save = panel.slice(panel.indexOf("function save()"));
    const bail = save.indexOf("if (!result.ok)");
    const adopt = save.indexOf("setCodeDraft(result.campCode");
    expect(bail, "the failure path still returns early").toBeGreaterThan(-1);
    expect(adopt, "adoption happens after the failure bail").toBeGreaterThan(bail);
  });

  it("resyncs the drafts when the persisted values change underneath", () => {
    // The second guard: another reviewer's save, or our own arriving via
    // `router.refresh()`, updates the props and the drafts must follow.
    const effect = panel.slice(panel.indexOf("useEffect("));
    expect(effect).toContain("setCodeDraft(campCode ?? \"\")");
    expect(effect).toContain("setErfDraft(erf ?? \"\")");
    expect(
      effect.slice(0, effect.indexOf("}, [") + 40),
      "the effect depends on both persisted values",
    ).toContain("[campCode, erf]");
  });

  it("still derives `dirty` from the drafts against the persisted values", () => {
    // If this comparison ever moves to a snapshot taken at mount, the Save
    // button goes back to staying lit after a normalizing save.
    expect(panel).toContain(
      'const dirty = codeDraft !== (campCode ?? "") || erfDraft !== (erf ?? "");',
    );
  });
});
